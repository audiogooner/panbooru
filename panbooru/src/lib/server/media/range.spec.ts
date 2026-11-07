import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { startApp, type RunningApp } from '#lib/server/app.ts';

const password = 'correct-horse-battery';
const approvedHost = 'cdn.fixture.test';
const jpeg = Buffer.from('jpeg-bytes');

type UpstreamMode = 'honor' | 'ignore';

async function startFixture(mode: UpstreamMode) {
	const ranges: string[] = [];
	let imageRequests = 0;
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? '/', 'http://127.0.0.1');
		if (url.pathname.startsWith('/images/')) {
			imageRequests += 1;
			const requested = request.headers.range;
			if (requested) ranges.push(requested);
			writeMedia(request, response, mode);
			return;
		}
		response.writeHead(200, { 'content-type': 'application/json' });
		response.end(
			JSON.stringify({
				post: [
					{
						id: 10,
						tags: 'landscape sunset',
						file_url: `https://${approvedHost}/images/a.jpg`,
						preview_url: `https://${approvedHost}/images/a.jpg`,
						width: 100,
						height: 50,
						rating: 'general'
					}
				]
			})
		);
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('fixture failed to bind');
	return {
		origin: `http://127.0.0.1:${address.port}`,
		ranges,
		imageRequests: () => imageRequests,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			})
	};
}

function writeMedia(request: IncomingMessage, response: ServerResponse, mode: UpstreamMode) {
	const total = jpeg.length;
	const requested = request.headers.range;
	if (mode === 'honor' && requested) {
		const match = /^bytes=(\d+)-(\d+)$/.exec(requested);
		const start = match ? Number(match[1]) : Number.NaN;
		const end = match ? Number(match[2]) : Number.NaN;
		if (!match || start > end || start >= total) {
			response.writeHead(416, { 'content-range': `bytes */${total}` });
			response.end();
			return;
		}
		const last = Math.min(end, total - 1);
		const slice = jpeg.subarray(start, last + 1);
		response.writeHead(206, {
			'content-type': 'image/jpeg',
			'content-length': String(slice.length),
			'content-range': `bytes ${start}-${last}/${total}`
		});
		if (request.method === 'HEAD') response.end();
		else response.end(slice);
		return;
	}
	response.writeHead(200, {
		'content-type': 'image/jpeg',
		'content-length': String(total)
	});
	if (request.method === 'HEAD') response.end();
	else response.end(jpeg);
}

describe('authenticated media ranges', () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		while (cleanups.length) await cleanups.pop()?.();
	});

	async function boot(mode: UpstreamMode) {
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-range-'));
		const fixture = await startFixture(mode);
		const app = await startApp({
			dataDir,
			secretPath: join(dataDir, 'secrets', 'master.key'),
			fixtureOrigin: fixture.origin,
			allowHosts: [approvedHost],
			lookup: () => ['93.184.216.34'],
			fetchUpstream: async (input, init) => {
				const headers = new Headers(init?.headers);
				return fetch(new URL(`${input.pathname}${input.search}`, fixture.origin), {
					method: init?.method,
					headers,
					redirect: init?.redirect
				});
			}
		});
		cleanups.push(async () => {
			await app.close();
			await fixture.close();
			await rm(dataDir, { recursive: true, force: true });
		});
		const token = (await readFile(join(dataDir, 'bootstrap.token'), 'utf8')).trim();
		const setup = await app.fetch('/api/setup/owner', {
			method: 'POST',
			headers: { origin: app.origin, 'content-type': 'application/json' },
			body: JSON.stringify({ token, password })
		});
		const cookie = (setup.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
		const found = await app.fetch('/api/source/gelbooru/search', {
			method: 'POST',
			headers: { origin: app.origin, cookie, 'content-type': 'application/json' },
			body: JSON.stringify({ query: 'sunset' })
		});
		const payload = (await found.json()) as { data: { posts: Array<{ mediaRef: string }> } };
		return { app, fixture, cookie, ref: payload.data.posts[0]?.mediaRef ?? '' };
	}

	function media(app: RunningApp, ref: string, cookie: string, range?: string) {
		const headers = new Headers({ cookie });
		if (range) headers.set('range', range);
		return app.fetch(`/api/media/${ref}`, { headers });
	}

	it('returns the four requested bytes with a content range', async () => {
		const { app, fixture, cookie, ref } = await boot('honor');
		const response = await media(app, ref, cookie, 'bytes=0-3');
		expect(response.status).toBe(206);
		expect(response.headers.get('content-range')).toBe('bytes 0-3/10');
		expect(Buffer.from(await response.arrayBuffer())).toEqual(jpeg.subarray(0, 4));
		expect(fixture.ranges).toContain('bytes=0-3');
	});

	it('returns 416 and an empty body when the range starts past the end', async () => {
		const { app, cookie, ref } = await boot('honor');
		const response = await media(app, ref, cookie, 'bytes=10-12');
		expect(response.status).toBe(416);
		expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.alloc(0));
	});

	it('returns the full jpeg when no range is requested', async () => {
		const { app, cookie, ref } = await boot('honor');
		const response = await media(app, ref, cookie);
		expect(response.status).toBe(200);
		expect(Buffer.from(await response.arrayBuffer())).toEqual(jpeg);
	});

	it('returns the upstream 200 when the origin ignores range', async () => {
		const { app, cookie, ref } = await boot('ignore');
		const response = await media(app, ref, cookie, 'bytes=0-3');
		expect(response.status).toBe(200);
		expect(Buffer.from(await response.arrayBuffer())).toEqual(jpeg);
	});

	it('keeps HEAD empty and reports the length', async () => {
		const { app, cookie, ref } = await boot('honor');
		const response = await app.fetch(`/api/media/${ref}`, { method: 'HEAD', headers: { cookie } });
		expect(response.status).toBe(200);
		expect(response.headers.get('content-length')).toBe(String(jpeg.length));
		expect(await response.text()).toBe('');
	});

	it('requires a session for a range request', async () => {
		const { app, fixture, ref } = await boot('honor');
		const before = fixture.imageRequests();
		const response = await app.fetch(`/api/media/${ref}`, { headers: { range: 'bytes=0-3' } });
		expect(response.status).toBe(401);
		expect(fixture.imageRequests()).toBe(before);
	});

	it('does not honor more than one byte range', async () => {
		const { app, fixture, cookie, ref } = await boot('honor');
		const response = await media(app, ref, cookie, 'bytes=0-1,8-9');
		expect(response.status).toBe(200);
		expect(Buffer.from(await response.arrayBuffer())).toEqual(jpeg);
		expect(fixture.ranges).not.toContain('bytes=0-1,8-9');
	});
});
