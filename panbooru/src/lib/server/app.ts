import { randomBytes, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { once } from 'node:events';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { createServer } from 'node:http';
import { join } from 'node:path';
import {
	applyEnvCredentials,
	ensureBootstrap,
	dispatch,
	type AppServices
} from '#lib/server/auth/dispatch.ts';
import { RateLimiter } from '#lib/server/auth/rate-limit.ts';
import { openDatabase } from '#lib/server/db/index.ts';
import { runOriginalPass } from '#lib/server/library/worker.ts';

export type StartAppOptions = {
	dataDir?: string;
	secretPath?: string;
	fixtureOrigin?: string;
	now?: () => number;
	log?: (line: string) => void;
	secureCookie?: boolean;
	allowHosts?: readonly string[];
	lookup?: (hostname: string) => readonly string[] | Promise<readonly string[]>;
	fetchUpstream?: (input: URL) => Promise<Response>;
};

export type RunningApp = {
	origin: string;
	fetch: (path: string, init?: RequestInit) => Promise<Response>;
	close: () => Promise<void>;
};

export function readConfig(options: StartAppOptions = {}) {
	const dataDir = options.dataDir ?? process.env.PANBOORU_DATA_DIR;
	if (!dataDir) {
		throw new Error('PANBOORU_DATA_DIR is required');
	}
	return {
		dataDir,
		secretPath: options.secretPath ?? process.env.PANBOORU_SECRET_PATH,
		fixtureOrigin: options.fixtureOrigin ?? process.env.PANBOORU_FIXTURE_ORIGIN
	};
}

export function healthResponse() {
	return Response.json(
		{ data: { ok: true }, requestId: randomUUID() },
		{ headers: { 'cache-control': 'private, no-store' } }
	);
}

export function createServices(options: StartAppOptions = {}): AppServices {
	const config = readConfig(options);
	if (config.secretPath && !existsSync(config.secretPath)) {
		mkdirSync(dirname(config.secretPath), { recursive: true });
		writeFileSync(config.secretPath, randomBytes(32), { mode: 0o600 });
	}
	for (const directory of ['media/originals', 'media/derivatives', 'cache', 'tmp']) {
		mkdirSync(join(config.dataDir, directory), { recursive: true });
	}
	const fixtureOrigin = config.fixtureOrigin;
	return {
		db: openDatabase(config.dataDir),
		dataDir: config.dataDir,
		secretPath: config.secretPath,
		fixtureOrigin,
		now: options.now ?? (() => Date.now()),
		log: options.log ?? (() => {}),
		limiter: new RateLimiter(),
		secureCookie: options.secureCookie ?? false,
		allowHosts:
			options.allowHosts ??
			(process.env.PANBOORU_MEDIA_HOSTS ?? '')
				.split(',')
				.map((host) => host.trim())
				.filter(Boolean),
		lookup:
			options.lookup ??
			(fixtureOrigin
				? () => ['93.184.216.34']
				: async (hostname: string) => {
						const answers = await lookup(hostname, { all: true, verbatim: true });
						return answers.map((answer) => answer.address);
					}),
		fetchUpstream:
			options.fetchUpstream ??
			(fixtureOrigin
				? async (input) => {
						const rewritten = new URL(input.pathname + input.search, fixtureOrigin);
						return fetch(rewritten);
					}
				: (input) => fetch(input)),
		media: new Map()
	};
}

export function startOriginalWorker(services: AppServices) {
	void runOriginalPass({
		db: services.db,
		dataDir: services.dataDir,
		now: services.now(),
		fetchFile: (url) => services.fetchUpstream(new URL(url))
	}).catch((error: unknown) => {
		services.log(error instanceof Error ? error.message : 'original worker failed');
	});
}

let processServices: AppServices | undefined;

let preparing: Promise<void> | undefined;

export function prepareProcessServices() {
	if (!preparing) {
		preparing = (async () => {
			const services = createServices();
			ensureBootstrap(services);
			await applyEnvCredentials(services);
			processServices = services;
			startOriginalWorker(services);
		})();
	}
	return preparing;
}

export function getProcessServices() {
	if (!processServices) throw new Error('services are not ready');
	return processServices;
}

async function toRequest(request: IncomingMessage, origin: string) {
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(Buffer.from(chunk));
	const method = request.method ?? 'GET';
	const headers = new Headers();
	for (const [key, value] of Object.entries(request.headers)) {
		if (value === undefined) continue;
		if (Array.isArray(value)) {
			for (const item of value) headers.append(key, item);
		} else {
			headers.set(key, value);
		}
	}
	return new Request(new URL(request.url ?? '/', origin), {
		method,
		headers,
		body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks)
	});
}

function writeResponse(
	response: import('node:http').ServerResponse,
	result: Response,
	bytes: Buffer
) {
	const headers: [string, string][] = [];
	result.headers.forEach((value, key) => {
		if (key !== 'set-cookie') headers.push([key, value]);
	});
	for (const setCookie of result.headers.getSetCookie()) headers.push(['set-cookie', setCookie]);
	response.writeHead(result.status, headers);
	response.end(bytes);
}

export async function startApp(options: StartAppOptions = {}): Promise<RunningApp> {
	const services = createServices(options);
	ensureBootstrap(services);
	await applyEnvCredentials(services);
	startOriginalWorker(services);

	const server = createServer(async (request, response) => {
		const origin = `http://${request.headers.host ?? '127.0.0.1'}`;
		const webRequest = await toRequest(request, origin);
		const url = new URL(webRequest.url);
		const result =
			request.method === 'GET' && url.pathname === '/health'
				? healthResponse()
				: ((await dispatch(webRequest, services)) ??
					Response.json(
						{ code: 'NOT_FOUND', message: 'Not found', retryable: false, requestId: randomUUID() },
						{ status: 404 }
					));
		writeResponse(response, result, Buffer.from(await result.arrayBuffer()));
	});

	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('app failed to bind');
	}
	const origin = `http://127.0.0.1:${address.port}`;
	return {
		origin,
		fetch: (path, init) => fetch(new URL(path, origin), init),
		close: () =>
			new Promise((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			})
	};
}
