import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { createServer } from 'node:http';
import { ensureBootstrap, dispatch, type AppServices } from '#lib/server/auth/dispatch.ts';
import { RateLimiter } from '#lib/server/auth/rate-limit.ts';
import { openDatabase } from '#lib/server/db/index.ts';

export type StartAppOptions = {
	dataDir?: string;
	secretPath?: string;
	fixtureOrigin?: string;
	now?: () => number;
	log?: (line: string) => void;
	secureCookie?: boolean;
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
	void config.secretPath;
	void config.fixtureOrigin;
	return {
		db: openDatabase(config.dataDir),
		dataDir: config.dataDir,
		now: options.now ?? (() => Date.now()),
		log: options.log ?? (() => {}),
		limiter: new RateLimiter(),
		secureCookie: options.secureCookie ?? false
	};
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
