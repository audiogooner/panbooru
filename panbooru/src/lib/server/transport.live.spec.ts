import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDotEnv, startApp, type RunningApp } from '#lib/server/app.ts';
import { checkDestination } from '#lib/server/media/policy.ts';

const password = 'correct-horse-battery';

type LivePost = { mediaRef: string; tags: string[] };

describe('live gelbooru transport', () => {
	const cleanups: Array<() => Promise<void>> = [];
	const previous = {
		user: process.env.PANBOORU_GELBOORU_USER_ID,
		key: process.env.PANBOORU_GELBOORU_API_KEY
	};

	afterEach(async () => {
		if (previous.user === undefined) delete process.env.PANBOORU_GELBOORU_USER_ID;
		else process.env.PANBOORU_GELBOORU_USER_ID = previous.user;
		if (previous.key === undefined) delete process.env.PANBOORU_GELBOORU_API_KEY;
		else process.env.PANBOORU_GELBOORU_API_KEY = previous.key;
		while (cleanups.length) await cleanups.pop()?.();
	});

	it('proves image and video ranges through the authenticated proxy', async () => {
		loadDotEnv();
		const userId = process.env.PANBOORU_GELBOORU_USER_ID?.trim() ?? '';
		const apiKey = process.env.PANBOORU_GELBOORU_API_KEY?.trim() ?? '';
		if (!userId || !apiKey) {
			throw new Error('PANBOORU_GELBOORU_USER_ID and PANBOORU_GELBOORU_API_KEY are required');
		}

		const logs: string[] = [];
		const allowHosts: string[] = [];
		const mediaUrls: string[] = [];
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-live-'));
		const app = await startApp({
			dataDir,
			secretPath: join(dataDir, 'secrets', 'master.key'),
			allowHosts,
			log: (line) => logs.push(line),
			fetchUpstream: async (input, init) => {
				const response = await fetch(input, {
					method: init?.method,
					headers: init?.headers,
					redirect: init?.redirect
				});
				const type = response.headers.get('content-type') ?? '';
				if (type.includes('json')) {
					const json = (await response
						.clone()
						.json()
						.catch(() => null)) as {
						post?: unknown;
					} | null;
					collectMedia(json?.post, allowHosts, mediaUrls);
				}
				return response;
			}
		});
		cleanups.push(async () => {
			await app.close();
			await rm(dataDir, { recursive: true, force: true });
		});

		const cookie = await ownerCookie(app, dataDir);
		const stills = await search(app, cookie, 'rating:general score:>1 -video -animated');
		const videos = await search(app, cookie, 'video');
		expect(stills.length).toBeGreaterThan(0);
		expect(videos.length).toBeGreaterThan(0);

		const logged = logs.join('\n');
		expect(logged.includes(`api_key=${apiKey}`)).toBe(false);
		expect(logged.includes(`user_id=${userId}`)).toBe(false);
		expect(logged.includes('api_key=REDACTED')).toBe(true);

		const still = await app.fetch(`/api/media/${stills[0]?.mediaRef}`, {
			headers: { cookie, range: 'bytes=0-3' }
		});
		expect(still.status).toBe(206);
		expect(still.headers.get('content-type') ?? '').toMatch(/^image\//);
		expect(still.headers.get('content-range') ?? '').toMatch(/^bytes 0-3\//);
		expect((await still.arrayBuffer()).byteLength).toBe(4);

		const types = new Map<string, string>();
		for (const post of videos) {
			const ranged = await app.fetch(`/api/media/${post.mediaRef}`, {
				headers: { cookie, range: 'bytes=0-3' }
			});
			const type =
				(ranged.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
			if (!type.startsWith('video/')) {
				await ranged.arrayBuffer();
				continue;
			}
			if (!types.has(type)) {
				expect(ranged.status).toBe(206);
				expect((await ranged.arrayBuffer()).byteLength).toBe(4);
				types.set(type, post.mediaRef);
			} else {
				await ranged.arrayBuffer();
			}
		}
		expect(types.size).toBeGreaterThan(0);
		for (const ref of types.values()) {
			const past = await app.fetch(`/api/media/${ref}`, {
				headers: { cookie, range: 'bytes=999999999999-999999999999' }
			});
			expect(past.status).toBe(416);
			expect((await past.arrayBuffer()).byteLength).toBe(0);
		}

		const anonymous = await app.fetch(`/api/media/${stills[0]?.mediaRef}`, {
			headers: { range: 'bytes=0-3' }
		});
		expect(anonymous.status).toBe(401);

		expect(allowHosts.length).toBeGreaterThan(0);
		expect(
			checkDestination('https://not-in-payload.example/images/aa/bb/file.jpg', {
				allowHosts,
				lookup: () => ['93.184.216.34']
			}).ok
		).toBe(false);
		const fileUrl = mediaUrls.find((url) => new URL(url).pathname.startsWith('/images/'));
		const previewUrl = mediaUrls.find((url) => new URL(url).pathname.startsWith('/thumbnails/'));
		expect(fileUrl).toBeTruthy();
		expect(previewUrl).toBeTruthy();
		expect(
			checkDestination(fileUrl ?? '', { allowHosts, lookup: () => ['93.184.216.34'] }).ok
		).toBe(true);
		expect(
			checkDestination(previewUrl ?? '', { allowHosts, lookup: () => ['93.184.216.34'] }).ok
		).toBe(true);
	}, 90_000);
});

describe('media referer', () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		while (cleanups.length) await cleanups.pop()?.();
	});

	it('sends the Gelbooru referer and does not forward the browser referer', async () => {
		const recorded: Headers[] = [];
		const server = createServer((request, response) => {
			const url = new URL(request.url ?? '/', 'http://127.0.0.1');
			if (url.pathname.startsWith('/images/')) {
				recorded.push(new Headers(request.headers as HeadersInit));
				response.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': '10' });
				response.end('jpeg-bytes');
				return;
			}
			response.writeHead(200, { 'content-type': 'application/json' });
			response.end(
				JSON.stringify({
					post: [
						{
							id: 10,
							tags: 'landscape sunset',
							file_url: 'https://cdn.fixture.test/images/a.jpg',
							preview_url: 'https://cdn.fixture.test/images/a.jpg',
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
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-referer-'));
		const app = await startApp({
			dataDir,
			secretPath: join(dataDir, 'secrets', 'master.key'),
			fixtureOrigin: `http://127.0.0.1:${address.port}`,
			allowHosts: ['cdn.fixture.test'],
			lookup: () => ['93.184.216.34'],
			fetchUpstream: async (input, init) => {
				if (input.pathname.startsWith('/images/')) recorded.push(new Headers(init?.headers));
				return fetch(
					new URL(`${input.pathname}${input.search}`, `http://127.0.0.1:${address.port}`),
					{
						method: init?.method,
						headers: init?.headers,
						redirect: init?.redirect
					}
				);
			}
		});
		cleanups.push(async () => {
			await app.close();
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			});
			await rm(dataDir, { recursive: true, force: true });
		});
		const cookie = await ownerCookie(app, dataDir);
		const posts = await search(app, cookie, 'sunset');
		const response = await app.fetch(`/api/media/${posts[0]?.mediaRef}`, {
			headers: {
				cookie,
				referer: 'https://evil.example/secret',
				authorization: 'Bearer browser-token'
			}
		});
		expect(response.status).toBe(200);
		expect(recorded.at(-1)?.get('referer')).toBe('https://gelbooru.com/');
		expect(recorded.at(-1)?.get('cookie')).toBeNull();
		expect(recorded.at(-1)?.get('authorization')).toBeNull();
	});
});

function collectMedia(value: unknown, allowHosts: string[], mediaUrls: string[]) {
	const posts = Array.isArray(value) ? value : value ? [value] : [];
	for (const post of posts) {
		if (!post || typeof post !== 'object') continue;
		for (const key of ['file_url', 'preview_url']) {
			const raw = (post as Record<string, unknown>)[key];
			if (typeof raw !== 'string' || !raw) continue;
			mediaUrls.push(raw);
			try {
				const host = new URL(raw).hostname;
				if (!allowHosts.includes(host)) allowHosts.push(host);
			} catch {
				/* a malformed source url stays out of the allowlist */
			}
		}
	}
}

async function ownerCookie(app: RunningApp, dataDir: string) {
	const token = (await readFile(join(dataDir, 'bootstrap.token'), 'utf8')).trim();
	const setup = await app.fetch('/api/setup/owner', {
		method: 'POST',
		headers: { origin: app.origin, 'content-type': 'application/json' },
		body: JSON.stringify({ token, password })
	});
	return (setup.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

async function search(app: RunningApp, cookie: string, query: string) {
	const response = await app.fetch('/api/source/gelbooru/search', {
		method: 'POST',
		headers: { origin: app.origin, cookie, 'content-type': 'application/json' },
		body: JSON.stringify({ query })
	});
	expect(response.status).toBe(200);
	const body = (await response.json()) as { data: { posts: LivePost[] } };
	return body.data.posts;
}
