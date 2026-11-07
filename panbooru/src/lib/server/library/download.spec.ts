import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startApp, type RunningApp } from '#lib/server/app.ts';

const password = 'correct-horse-battery';
const bytes = Buffer.from('jpeg-bytes');

describe('background original download', () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		while (cleanups.length) await cleanups.pop()?.();
	});

	it('returns the favorite while the download is still running, then stores the file', async () => {
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-download-'));
		let releaseDownload = () => {};
		const download = new Promise<void>((resolve) => {
			releaseDownload = resolve;
		});
		const app = await startApp({
			dataDir,
			secretPath: join(dataDir, 'secrets', 'master.key'),
			fetchUpstream: async (input) => {
				if (input.pathname.startsWith('/images/')) {
					await download;
					return new Response(bytes, {
						status: 200,
						headers: {
							'content-type': 'image/jpeg',
							'content-length': String(bytes.length)
						}
					});
				}
				return new Response(
					JSON.stringify({
						post: [
							{
								id: 10,
								tags: 'landscape sunset',
								file_url: 'https://cdn.fixture.test/images/a.jpg',
								width: 100,
								height: 50,
								rating: 'general'
							}
						]
					}),
					{ headers: { 'content-type': 'application/json' } }
				);
			}
		});
		cleanups.push(async () => {
			releaseDownload();
			await app.close();
			await rm(dataDir, { recursive: true, force: true });
		});

		const cookie = await ownerCookie(app, dataDir);
		const mediaRef = await searchMediaRef(app, cookie);
		const pending = app.fetch('/api/library/favorites', {
			method: 'POST',
			headers: { origin: app.origin, cookie, 'content-type': 'application/json' },
			body: JSON.stringify({
				remoteId: '10',
				tags: ['landscape', 'sunset'],
				width: 100,
				height: 50,
				mediaRef,
				rating: 'general'
			})
		});
		const winner = await Promise.race([
			pending.then(() => 'response' as const),
			new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 300))
		]);
		expect(winner).toBe('response');
		const saved = await pending;
		const body = (await saved.json()) as {
			data: { itemId: string; membership: string; original: string };
		};
		expect(saved.status).toBe(200);
		expect(body.data).toMatchObject({ membership: 'favorite', original: 'queued' });
		const original = `/api/library/originals/${encodeURIComponent(body.data.itemId)}`;
		expect((await app.fetch(original, { headers: { cookie } })).status).toBe(404);

		releaseDownload();
		await expect
			.poll(async () => (await app.fetch(original, { headers: { cookie } })).status)
			.toBe(200);
	});
});

async function ownerCookie(app: RunningApp, dataDir: string) {
	const token = (await readFile(join(dataDir, 'bootstrap.token'), 'utf8')).trim();
	const setup = await app.fetch('/api/setup/owner', {
		method: 'POST',
		headers: { origin: app.origin, 'content-type': 'application/json' },
		body: JSON.stringify({ token, password })
	});
	return (setup.headers.get('set-cookie') ?? '').split(';')[0];
}

async function searchMediaRef(app: RunningApp, cookie: string) {
	const found = await app.fetch('/api/source/gelbooru/search', {
		method: 'POST',
		headers: { origin: app.origin, cookie, 'content-type': 'application/json' },
		body: JSON.stringify({ query: 'landscape sunset' })
	});
	const searched = (await found.json()) as { data: { posts: { mediaRef: string }[] } };
	return searched.data.posts[0]?.mediaRef ?? '';
}
