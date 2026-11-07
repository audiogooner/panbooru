import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readdir, readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { startApp, type RunningApp } from '#lib/server/app.ts';

const password = 'correct-horse-battery';
const approvedHost = 'cdn.fixture.test';
const animatedGif = Buffer.from(
	'R0lGODlhCAAIAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAAAAAACwAAAAACAAIAAACB4SPqcvtXQAAIfkEAAAAAAAsAAAAAAgACACAAAD/AAAAAgeEj6nL7V0AADs=',
	'base64'
);

const files = new Map<string, { type: string; body: Buffer }>();

async function startFixture() {
	const requests: string[] = [];
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? '/', 'http://127.0.0.1');
		requests.push(url.pathname);
		const file = files.get(url.pathname);
		if (file) {
			response.writeHead(200, {
				'content-type': file.type,
				'content-length': String(file.body.length)
			});
			if (request.method === 'HEAD') response.end();
			else response.end(file.body);
			return;
		}
		response.writeHead(200, { 'content-type': 'application/json' });
		response.end(
			JSON.stringify({
				post: [
					post('wide', '/images/wide.jpg', '/images/wide-preview.jpg', 2000, 1000),
					post('bad', '/images/bad.jpg', '/images/bad.jpg', 32, 32),
					post('anim', '/images/anim.gif', '/images/anim.gif', 8, 8),
					post('clip', '/images/clip.mp4', '/images/preview.jpg', 320, 180)
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
		requests,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			})
	};
}

function post(tag: string, file: string, preview: string, width: number, height: number) {
	return {
		id: tag,
		tags: tag,
		file_url: `https://${approvedHost}${file}`,
		preview_url: `https://${approvedHost}${preview}`,
		width,
		height,
		rating: 'general'
	};
}

describe('image derivatives', () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		files.clear();
		while (cleanups.length) await cleanups.pop()?.();
	});

	async function boot() {
		const wide = await sharp({
			create: { width: 2000, height: 1000, channels: 3, background: { r: 30, g: 80, b: 200 } }
		})
			.jpeg({ quality: 90 })
			.toBuffer();
		const preview = await sharp({
			create: { width: 80, height: 40, channels: 3, background: { r: 200, g: 40, b: 40 } }
		})
			.jpeg()
			.toBuffer();
		const widePreview = await sharp({
			create: { width: 160, height: 80, channels: 3, background: { r: 20, g: 180, b: 90 } }
		})
			.jpeg()
			.toBuffer();
		files.set('/images/wide.jpg', { type: 'image/jpeg', body: wide });
		files.set('/images/wide-preview.jpg', { type: 'image/jpeg', body: widePreview });
		files.set('/images/bad.jpg', { type: 'image/jpeg', body: Buffer.from('not-an-image') });
		files.set('/images/anim.gif', { type: 'image/gif', body: animatedGif });
		files.set('/images/clip.mp4', {
			type: 'video/mp4',
			body: Buffer.from('video-bytes-0123456789')
		});
		files.set('/images/preview.jpg', { type: 'image/jpeg', body: preview });

		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-derivative-'));
		const fixture = await startFixture();
		const app = await startApp({
			dataDir,
			secretPath: join(dataDir, 'secrets', 'master.key'),
			fixtureOrigin: fixture.origin,
			allowHosts: [approvedHost],
			lookup: () => ['93.184.216.34'],
			fetchUpstream: async (input, init) =>
				fetch(new URL(`${input.pathname}${input.search}`, fixture.origin), {
					method: init?.method,
					headers: init?.headers,
					redirect: init?.redirect
				})
		});
		cleanups.push(async () => {
			await app.close();
			await fixture.close();
			await rm(dataDir, { recursive: true, force: true });
		});
		const cookie = await ownerCookie(app, dataDir);
		const found = await app.fetch('/api/source/gelbooru/search', {
			method: 'POST',
			headers: { origin: app.origin, cookie, 'content-type': 'application/json' },
			body: JSON.stringify({ query: 'wide' })
		});
		expect(found.status).toBe(200);
		const payload = (await found.json()) as {
			data: { posts: Array<{ tags: string[]; mediaRef: string }> };
		};
		const ref = (tag: string) =>
			payload.data.posts.find((item) => item.tags.includes(tag))?.mediaRef ?? '';
		return { app, dataDir, cookie, ref, wide, requests: fixture.requests };
	}

	it('records recipe rows without a second copy of the same source', async () => {
		const { dataDir } = await boot();
		const sqlite = new Database(join(dataDir, 'db', 'panbooru.sqlite'), { readonly: true });
		const version = sqlite.prepare('select version from schema_migrations where version = 5').get();
		const table = sqlite
			.prepare("select sql from sqlite_master where type = 'table' and name = 'derivatives'")
			.get() as { sql: string } | undefined;
		sqlite.close();
		expect(version).toBeTruthy();
		expect(table?.sql.toLowerCase()).toContain('unique');
		expect(table?.sql).toContain('source_identity');
		expect(table?.sql).toContain('recipe');
	});

	it('serves thumb, display, and backdrop sizes without changing the original', async () => {
		const { app, dataDir, cookie, ref, wide, requests } = await boot();
		const thumb = await media(app, cookie, ref('wide'), 'thumb');
		expect(thumb.status).toBe(200);
		expect(thumb.headers.get('content-type')).toContain('image/webp');
		expect(thumb.headers.get('cache-control')).toContain('private');
		expect(thumb.headers.get('cache-control')).toContain('max-age=86400');
		expect(thumb.headers.get('cache-control')).not.toContain('no-store');
		expect(thumb.headers.get('cache-control')).not.toContain('public');
		const thumbBytes = Buffer.from(await thumb.arrayBuffer());
		expect(await sharp(thumbBytes).metadata()).toMatchObject({
			format: 'webp',
			width: 160,
			height: 80
		});
		expect(requests.filter((path) => path === '/images/wide.jpg')).toEqual([]);
		expect(requests.filter((path) => path === '/images/wide-preview.jpg')).toHaveLength(1);

		const display = await media(app, cookie, ref('wide'), 'display');
		const displayBytes = Buffer.from(await display.arrayBuffer());
		expect(await sharp(displayBytes).metadata()).toMatchObject({ width: 1920, height: 960 });
		expect(display.headers.get('cache-control')).not.toContain('no-store');
		expect(display.headers.get('cache-control')).not.toContain('public');

		const backdrop = await media(app, cookie, ref('wide'), 'backdrop');
		expect(requests.filter((path) => path === '/images/wide.jpg')).toHaveLength(1);
		const backdropBytes = Buffer.from(await backdrop.arrayBuffer());
		expect(await sharp(backdropBytes).metadata()).toMatchObject({ width: 48, height: 24 });
		expect(backdropBytes.equals(thumbBytes)).toBe(false);

		const ranged = await media(app, cookie, ref('wide'), 'thumb', 'bytes=0-3');
		expect(ranged.status).toBe(206);
		expect(ranged.headers.get('content-range')).toBe(`bytes 0-3/${thumbBytes.length}`);
		expect(ranged.headers.get('content-range')).not.toContain(`/${wide.length}`);
		expect(Buffer.from(await ranged.arrayBuffer())).toEqual(thumbBytes.subarray(0, 4));

		const download = await app.fetch(`/api/media/${ref('wide')}?download=1`, {
			headers: { cookie }
		});
		expect(download.headers.get('content-disposition')).toContain('attachment');
		expect(download.headers.get('content-disposition')).toContain('wide.jpg');
		expect(download.headers.get('cache-control')).toContain('no-store');
		expect(download.headers.get('cache-control')).not.toContain('public');
		expect(Buffer.from(await download.arrayBuffer())).toEqual(wide);

		const saved = await app.fetch('/api/library/favorites', {
			method: 'POST',
			headers: { origin: app.origin, cookie, 'content-type': 'application/json' },
			body: JSON.stringify({
				remoteId: 'wide',
				tags: ['wide'],
				width: 2000,
				height: 1000,
				mediaRef: ref('wide'),
				rating: 'general'
			})
		});
		expect(saved.status).toBe(200);
		const item = (await saved.json()) as { data: { itemId: string } };
		await expect
			.poll(
				async () =>
					(await app.fetch(`/api/library/originals/${item.data.itemId}`, { headers: { cookie } }))
						.status
			)
			.toBe(200);
		const stored = await readFile(
			join(
				dataDir,
				'media',
				'originals',
				(await readdir(join(dataDir, 'media', 'originals')))[0] ?? ''
			)
		);
		const hash = createHash('sha256').update(stored).digest('hex');
		await media(app, cookie, ref('wide'), 'thumb');
		const again = await readFile(join(dataDir, 'media', 'originals', hash));
		expect(createHash('sha256').update(again).digest('hex')).toBe(hash);
		expect(again).toEqual(wide);
		const upstreamBeforeThumb = requests.filter((path) => path === '/images/wide.jpg').length;
		const libraryThumb = await app.fetch(
			`/api/library/originals/${encodeURIComponent(item.data.itemId)}?recipe=thumb`,
			{ headers: { cookie } }
		);
		expect(libraryThumb.status).toBe(200);
		expect(libraryThumb.headers.get('content-type')).toContain('image/webp');
		expect(libraryThumb.headers.get('cache-control')).toContain('private');
		expect(libraryThumb.headers.get('cache-control')).toContain('max-age=86400');
		expect(libraryThumb.headers.get('cache-control')).not.toContain('no-store');
		expect(libraryThumb.headers.get('cache-control')).not.toContain('public');
		expect(await sharp(Buffer.from(await libraryThumb.arrayBuffer())).metadata()).toMatchObject({
			width: 320,
			height: 160
		});
		expect(requests.filter((path) => path === '/images/wide.jpg')).toHaveLength(upstreamBeforeThumb);
		const storedOriginal = await app.fetch(
			`/api/library/originals/${encodeURIComponent(item.data.itemId)}`,
			{ headers: { cookie } }
		);
		expect(storedOriginal.headers.get('cache-control')).toContain('no-store');
		expect(storedOriginal.headers.get('cache-control')).not.toContain('public');

		files.set('/images/wide.jpg', {
			type: 'image/jpeg',
			body: await sharp({
				create: { width: 8, height: 8, channels: 3, background: 'red' }
			})
				.jpeg()
				.toBuffer()
		});
		const original = await media(app, cookie, ref('wide'));
		expect(Buffer.from(await original.arrayBuffer())).toEqual(wide);
	});

	it('falls back to the original when a derivative cannot be made', async () => {
		const { app, cookie, ref } = await boot();
		const response = await media(app, cookie, ref('bad'), 'thumb');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('image/jpeg');
		expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from('not-an-image'));
		expect(response.headers.get('x-derivative-label')).toBeNull();
	});

	it('labels an animated still as a static first frame', async () => {
		const { app, cookie, ref } = await boot();
		const response = await media(app, cookie, ref('anim'), 'display');
		expect(response.headers.get('content-type')).toContain('image/webp');
		expect(response.headers.get('x-derivative-label')).toBe('static-preview');
		const meta = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
		expect(meta.pages ?? 1).toBe(1);
		expect(meta.width).toBe(8);
		expect(meta.height).toBe(8);
	});

	it('builds video previews from the preview image and leaves the video bytes intact', async () => {
		const { app, cookie, ref } = await boot();
		const poster = await media(app, cookie, ref('clip'), 'thumb');
		expect(poster.headers.get('content-type')).toContain('image/webp');
		expect(await sharp(Buffer.from(await poster.arrayBuffer())).metadata()).toMatchObject({
			width: 80,
			height: 40
		});
		const video = await media(app, cookie, ref('clip'));
		expect(video.headers.get('content-type')).toContain('video/mp4');
		expect(Buffer.from(await video.arrayBuffer())).toEqual(Buffer.from('video-bytes-0123456789'));
	});
});

async function ownerCookie(app: RunningApp, dataDir: string) {
	const token = (await readFile(join(dataDir, 'bootstrap.token'), 'utf8')).trim();
	const setup = await app.fetch('/api/setup/owner', {
		method: 'POST',
		headers: { origin: app.origin, 'content-type': 'application/json' },
		body: JSON.stringify({ token, password })
	});
	return (setup.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

function media(app: RunningApp, cookie: string, ref: string, recipe?: string, range?: string) {
	const headers = new Headers({ cookie });
	if (range) headers.set('range', range);
	const query = recipe ? `?recipe=${recipe}` : '';
	return app.fetch(`/api/media/${ref}${query}`, { headers });
}
