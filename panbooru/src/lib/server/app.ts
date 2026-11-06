import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';

export type StartAppOptions = {
	dataDir?: string;
	secretPath?: string;
	fixtureOrigin?: string;
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
	return Response.json({
		data: { ok: true },
		requestId: randomUUID()
	});
}

export async function startApp(options: StartAppOptions = {}): Promise<RunningApp> {
	const config = readConfig(options);
	void config.secretPath;
	void config.fixtureOrigin;

	const server = createServer(async (request, response) => {
		const url = new URL(request.url ?? '/', 'http://127.0.0.1');
		const result =
			request.method === 'GET' && url.pathname === '/health'
				? healthResponse()
				: Response.json(
						{
							code: 'NOT_FOUND',
							message: 'Not found',
							retryable: false,
							requestId: randomUUID()
						},
						{ status: 404 }
					);
		const bytes = Buffer.from(await result.arrayBuffer());
		response.writeHead(result.status, Object.fromEntries(result.headers));
		response.end(bytes);
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
