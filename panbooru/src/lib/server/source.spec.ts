import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { startApp, type RunningApp } from '#lib/server/app.ts';

const password = 'correct-horse-battery';
const approvedHost = 'cdn.fixture.test';
const jpeg = Buffer.from('jpeg-bytes');

type Mode = 'ok' | 'html' | 'malformed' | 'unauthorized';

async function startFixture(mode: Mode = 'ok') {
	const requests: string[] = [];
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? '/', 'http://127.0.0.1');
		requests.push(`${url.pathname}${url.search}`);
		if (url.pathname.startsWith('/images/')) {
			response.writeHead(200, { 'content-type': 'image/jpeg' });
			response.end(jpeg);
			return;
		}
		if (mode === 'unauthorized') {
			response.writeHead(401, { 'content-type': 'application/json' });
			response.end('{"error":"unauthorized"}');
			return;
		}
		if (mode === 'html') {
			response.writeHead(200, { 'content-type': 'text/html' });
			response.end('<html>nope</html>');
			return;
		}
		if (mode === 'malformed') {
			response.writeHead(200, { 'content-type': 'application/json' });
			response.end('{');
			return;
		}
		const section = url.searchParams.get('s');
		if (section === 'tag') {
			if (url.searchParams.get('q') !== 'index') {
				response.writeHead(200, { 'content-type': 'text/html; charset=UTF-8' });
				response.end('');
				return;
			}
			const pattern = url.searchParams.get('name_pattern');
			response.writeHead(200, { 'content-type': 'application/json' });
			response.end(
				JSON.stringify({
					tag: pattern
						? [
								{ id: 3, name: 'sunset', type: 0, count: 12 },
								{ id: 4, name: 'sunlight', type: 0, count: 9 },
								{ id: 5, name: 'sunday', type: 4, count: 2 }
							]
						: [{ id: 3, name: 'sunset', type: 0, count: 12 }]
				})
			);
			return;
		}
		const id = url.searchParams.get('id');
		const post = {
			id: id ?? 10,
			tags: 'landscape sunset',
			file_url: `https://${approvedHost}/images/a.jpg`,
			preview_url: `https://${approvedHost}/images/a.jpg`,
			width: 100,
			height: 50,
			rating: 'general'
		};
		response.writeHead(200, { 'content-type': 'application/json' });
		response.end(JSON.stringify({ post: id ? post : [post] }));
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('fixture failed to bind');
	return {
		origin: `http://127.0.0.1:${address.port}`,
		requests,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			})
	};
}

describe('gelbooru source and media', () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		while (cleanups.length) await cleanups.pop()?.();
	});

	async function boot(mode: Mode = 'ok', allowHosts = [approvedHost]) {
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-source-'));
		const fixture = await startFixture(mode);
		const hosts: string[] = [];
		const app = await startApp({
			dataDir,
			secretPath: join(dataDir, 'secrets', 'master.key'),
			fixtureOrigin: fixture.origin,
			allowHosts,
			lookup: () => ['93.184.216.34'],
			fetchUpstream: async (input) => {
				hosts.push(input.hostname);
				return fetch(new URL(`${input.pathname}${input.search}`, fixture.origin));
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
		const cookie = (setup.headers.get('set-cookie') ?? '').split(';')[0];
		return { app, dataDir, fixture, cookie, hosts };
	}

	async function search(app: RunningApp, cookie: string, query: string, ratings?: string[]) {
		return app.fetch('/api/source/gelbooru/search', {
			method: 'POST',
			headers: { origin: app.origin, cookie, 'content-type': 'application/json' },
			body: JSON.stringify(ratings === undefined ? { query } : { query, ratings })
		});
	}

	function upstreamTags(requests: string[]) {
		const entry = [...requests]
			.reverse()
			.find((item) => item.includes('s=post') && item.includes('tags='));
		if (!entry) return '';
		return new URL(entry, 'http://127.0.0.1').searchParams.get('tags') ?? '';
	}

	it('normalizes search, posts, tags, and autocomplete', async () => {
		const { app, cookie, fixture, dataDir } = await boot();
		const found = await search(app, cookie, 'landscape sunset -forest');
		expect(found.status).toBe(200);
		expect(found.headers.get('cache-control')).toContain('no-store');
		const body = (await found.json()) as {
			data: { posts: Array<{ id: string; tags: string[]; mediaRef: string; fileUrl?: string }> };
			requestId: string;
		};
		expect(body.requestId).toBeTruthy();
		expect(body.data.posts[0]).toMatchObject({ id: '10', tags: ['landscape', 'sunset'] });
		expect(body.data.posts[0].fileUrl).toBeUndefined();
		expect(body.data.posts[0].mediaRef.startsWith('http')).toBe(false);
		expect(
			fixture.requests.some(
				(entry) =>
					entry.includes('tags=landscape+sunset+-forest') ||
					entry.includes('tags=landscape%20sunset%20-forest')
			)
		).toBe(true);

		const post = await app.fetch('/api/source/gelbooru/posts/10', { headers: { cookie } });
		expect(post.status).toBe(200);
		const postBody = (await post.json()) as { data: { post: { id: string } } };
		expect(postBody.data.post.id).toBe('10');

		const tags = await app.fetch('/api/source/gelbooru/tags', {
			method: 'POST',
			headers: { origin: app.origin, cookie, 'content-type': 'application/json' },
			body: JSON.stringify({ names: ['sunset'] })
		});
		expect(tags.status).toBe(200);
		const tagBody = (await tags.json()) as {
			data: { tags: Array<{ name: string; category: string }> };
		};
		expect(tagBody.data.tags[0]).toMatchObject({ name: 'sunset', category: 'general' });
		expect(
			fixture.requests.some(
				(entry) =>
					entry.includes('s=tag') && entry.includes('q=index') && entry.includes('names=sunset')
			)
		).toBe(true);

		const suggestions = await app.fetch('/api/source/gelbooru/autocomplete', {
			method: 'POST',
			headers: { origin: app.origin, cookie, 'content-type': 'application/json' },
			body: JSON.stringify({ pattern: 'sun' })
		});
		expect(suggestions.status).toBe(200);
		const suggestionBody = (await suggestions.json()) as {
			data: { suggestions: Array<{ name: string; count: number; category: string }> };
		};
		expect(suggestionBody.data.suggestions).toEqual([
			{ name: 'sunset', category: 'general', count: 12 },
			{ name: 'sunlight', category: 'general', count: 9 },
			{ name: 'sunday', category: 'character', count: 2 }
		]);
		const autocomplete = [...fixture.requests]
			.reverse()
			.find((entry) => entry.includes('s=tag') && entry.includes('name_pattern='));
		expect(autocomplete).toBeTruthy();
		const autocompleteParams = new URL(autocomplete ?? '', 'http://127.0.0.1').searchParams;
		expect(autocompleteParams.get('q')).toBe('index');
		expect(autocompleteParams.get('name_pattern')).toBe('sun%');
		expect(autocompleteParams.get('orderby')).toBe('count');
		expect(autocompleteParams.get('limit')).toBe('10');

		const escaped = await app.fetch('/api/source/gelbooru/autocomplete', {
			method: 'POST',
			headers: { origin: app.origin, cookie, 'content-type': 'application/json' },
			body: JSON.stringify({ pattern: 'long_hair' })
		});
		expect(escaped.status).toBe(200);
		const escapedRequest = [...fixture.requests]
			.reverse()
			.find((entry) => entry.includes('s=tag') && entry.includes('name_pattern='));
		expect(new URL(escapedRequest ?? '', 'http://127.0.0.1').searchParams.get('name_pattern')).toBe(
			'long\\_hair%'
		);

		for (const directory of ['media/originals', 'media/derivatives', 'cache', 'tmp']) {
			expect((await stat(join(dataDir, directory))).isDirectory()).toBe(true);
		}
	});

	it('treats html and malformed JSON as adapter errors', async () => {
		const html = await boot('html');
		const htmlResponse = await search(html.app, html.cookie, 'sunset');
		expect(htmlResponse.status).toBeGreaterThanOrEqual(500);
		const htmlBody = (await htmlResponse.json()) as {
			data?: { posts: unknown[] };
			code: string;
			message: string;
			retryable: boolean;
		};
		expect(htmlBody.data?.posts).toBeUndefined();
		expect(htmlBody).toMatchObject({
			code: 'UPSTREAM_INVALID',
			message: 'Gelbooru returned an unreadable response',
			retryable: false
		});

		const broken = await boot('malformed');
		const brokenResponse = await search(broken.app, broken.cookie, 'sunset');
		expect(brokenResponse.status).toBeGreaterThanOrEqual(500);
		const brokenBody = (await brokenResponse.json()) as { data?: { posts: unknown[] } };
		expect(brokenBody.data?.posts).toBeUndefined();
	});

	it('keeps the owner session when Gelbooru rejects the API key', async () => {
		const { app, cookie } = await boot('unauthorized');
		const response = await search(app, cookie, 'sunset');
		expect(response.status).toBe(502);
		const body = (await response.json()) as { code: string };
		expect(body.code).toBe('SOURCE_AUTH_REQUIRED');
		expect((await app.fetch('/api/auth/session', { headers: { cookie } })).status).toBe(200);
	});

	it('streams an approved media ref and blocks a rejected host', async () => {
		const { app, cookie, hosts } = await boot();
		const found = await search(app, cookie, 'sunset');
		const payload = (await found.json()) as { data: { posts: Array<{ mediaRef: string }> } };
		const ref = payload.data.posts[0].mediaRef;
		expect((await app.fetch(`/api/media/${ref}`)).status).toBe(401);

		const media = await app.fetch(`/api/media/${ref}`, { headers: { cookie } });
		expect(media.status).toBe(200);
		expect(media.headers.get('x-content-type-options')).toBe('nosniff');
		expect(media.headers.get('cache-control') ?? '').not.toContain('public');
		expect(Buffer.from(await media.arrayBuffer())).toEqual(jpeg);

		const head = await app.fetch(`/api/media/${ref}`, { method: 'HEAD', headers: { cookie } });
		expect(head.status).toBe(200);
		expect(await head.text()).toBe('');

		expect(hosts).toContain(approvedHost);
		const blockedApp = await boot('ok', []);
		const blockedSearch = await search(blockedApp.app, blockedApp.cookie, 'sunset');
		const blocked = (await blockedSearch.json()) as {
			data: { posts: Array<{ mediaRef: string }> };
		};
		const blockedMedia = await blockedApp.app.fetch(
			`/api/media/${blocked.data.posts[0].mediaRef}`,
			{
				headers: { cookie: blockedApp.cookie }
			}
		);
		expect(blockedMedia.status).toBeGreaterThanOrEqual(400);
		expect(blockedApp.hosts).not.toContain(approvedHost);
	});

	it('sends two selected ratings as exclusions and leaves an unfiltered query unchanged', async () => {
		const { app, cookie, fixture } = await boot();
		const narrowed = await search(app, cookie, 'landscape', ['general', 'sensitive']);
		expect(narrowed.status).toBe(200);
		const tags = upstreamTags(fixture.requests);
		expect(tags).toContain('-rating:explicit -rating:questionable');
		expect(tags).not.toContain('rating:general');
		expect(tags).not.toMatch(/(^|\s)or(\s|$)/);

		fixture.requests.length = 0;
		const plain = await search(app, cookie, 'landscape sunset -forest');
		expect(plain.status).toBe(200);
		expect(upstreamTags(fixture.requests)).toBe('landscape sunset -forest');
	});

	it('requests the next pid for a non-date sort and keeps that sort tag', async () => {
		const { app, cookie, fixture } = await boot();
		const score = await app.fetch('/api/source/gelbooru/search', {
			method: 'POST',
			headers: { origin: app.origin, cookie, 'content-type': 'application/json' },
			body: JSON.stringify({ query: 'forest sort:score', page: 1 })
		});
		expect(score.status).toBe(200);
		const scoreParams = new URL(
			[...fixture.requests].reverse().find((entry) => entry.includes('s=post')) ?? '',
			'http://127.0.0.1'
		).searchParams;
		expect(scoreParams.get('pid')).toBe('1');
		expect(scoreParams.get('limit')).toBe('20');
		expect(scoreParams.get('tags')).toContain('sort:score');
		expect(scoreParams.get('tags')).not.toMatch(/id:</);

		fixture.requests.length = 0;
		const random = await app.fetch('/api/source/gelbooru/search', {
			method: 'POST',
			headers: { origin: app.origin, cookie, 'content-type': 'application/json' },
			body: JSON.stringify({ query: 'forest sort:random:4242', page: 2 })
		});
		expect(random.status).toBe(200);
		const randomParams = new URL(
			[...fixture.requests].reverse().find((entry) => entry.includes('s=post')) ?? '',
			'http://127.0.0.1'
		).searchParams;
		expect(randomParams.get('pid')).toBe('2');
		expect(randomParams.get('tags')).toContain('sort:random:4242');
		expect(randomParams.get('tags')).not.toMatch(/id:</);

		fixture.requests.length = 0;
		const oldest = await app.fetch('/api/source/gelbooru/search', {
			method: 'POST',
			headers: { origin: app.origin, cookie, 'content-type': 'application/json' },
			body: JSON.stringify({ query: 'forest sort:id:asc', page: 1 })
		});
		expect(oldest.status).toBe(200);
		const oldestParams = new URL(
			[...fixture.requests].reverse().find((entry) => entry.includes('s=post')) ?? '',
			'http://127.0.0.1'
		).searchParams;
		expect(oldestParams.get('pid')).toBe('1');
		expect(oldestParams.get('tags')).toBe('forest sort:id:asc');
		expect(oldestParams.get('tags')).not.toMatch(/id:[<>]/);
	});

	it('keeps score: and id: in the upstream tag text', async () => {
		const { app, cookie, fixture } = await boot();
		const found = await search(app, cookie, 'score:>10 id:10', ['explicit']);
		expect(found.status).toBe(200);
		const tags = upstreamTags(fixture.requests);
		expect(tags).toContain('score:>10');
		expect(tags).toContain('id:10');
		expect(tags).toContain('rating:explicit');
	});
});
