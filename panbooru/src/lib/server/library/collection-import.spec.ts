import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '#lib/server/db/index.ts';
import {
	cancelCollectionImport,
	createCollectionImport,
	pauseAllCollectionImports,
	pauseCollectionImport,
	resumeCollectionImport,
	runCollectionImportPass,
	type CollectionImportContext
} from '#lib/server/library/collection-import.ts';
import { createAlbum, saveFavorite, type PostMetadata } from '#lib/server/library/save.ts';
import { runOriginalPass } from '#lib/server/library/worker.ts';

const jpeg = Buffer.from('jpeg-bytes');

function image(bytes: Buffer) {
	return new Response(bytes, {
		status: 200,
		headers: {
			'content-type': 'image/jpeg',
			'content-length': String(bytes.length)
		}
	});
}

async function startFixture(total: number) {
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? '/', 'http://127.0.0.1');
		if (url.pathname.startsWith('/images/')) {
			response.writeHead(200, {
				'content-type': 'image/jpeg',
				'content-length': String(jpeg.length)
			});
			response.end(jpeg);
			return;
		}
		const pid = Number(url.searchParams.get('pid') ?? '0');
		const start = Number.isInteger(pid) && pid > 0 ? pid * COLLECTION_OFFSET : 0;
		const posts = [];
		for (let index = start; index < Math.min(start + 20, total); index += 1) {
			const id = 100 + index;
			posts.push({
				id,
				tags: 'landscape sunset',
				file_url: `https://cdn.fixture.test/images/${id}.jpg`,
				preview_url: `https://cdn.fixture.test/images/${id}.jpg`,
				width: 100,
				height: 50,
				rating: 'general'
			});
		}
		response.writeHead(200, { 'content-type': 'application/json' });
		response.end(
			JSON.stringify({
				'@attributes': { limit: 20, offset: start, count: total },
				post: posts
			})
		);
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('fixture failed to bind');
	return {
		origin: `http://127.0.0.1:${address.port}`,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			})
	};
}

const COLLECTION_OFFSET = 20;

function count(db: AppDatabase, table: string) {
	return (db.$client.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
}

function importRow(db: AppDatabase, id: string) {
	return db.$client
		.prepare(
			`select id, state, page_cursor as pageCursor, added_count as addedCount, total
			 from collection_imports where id = ?`
		)
		.get(id) as {
		id: string;
		state: string;
		pageCursor: number;
		addedCount: number;
		total: number | null;
	};
}

describe('collection import', () => {
	const directories: string[] = [];
	const databases: AppDatabase[] = [];
	const closers: Array<() => Promise<void>> = [];

	afterEach(async () => {
		while (databases.length) databases.pop()?.$client.close();
		while (closers.length) await closers.pop()?.();
		while (directories.length) {
			const directory = directories.pop();
			if (directory) await rm(directory, { recursive: true, force: true });
		}
	});

	async function database() {
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-collection-'));
		directories.push(dataDir);
		const db = openDatabase(dataDir);
		databases.push(db);
		expect(
			db.$client.prepare('select version from schema_migrations where version = 7').get()
		).toBeTruthy();
		return { db, dataDir };
	}

	async function gelbooru(db: AppDatabase, dataDir: string, total: number) {
		const fixture = await startFixture(total);
		closers.push(fixture.close);
		const requests: string[] = [];
		const services: CollectionImportContext = {
			db,
			dataDir,
			now: () => 5_000,
			fixtureOrigin: fixture.origin,
			log: () => {},
			fetchUpstream: async (input) => {
				expect(db.$client.inTransaction).toBe(false);
				requests.push(`${input.pathname}${input.search}`);
				return fetch(input);
			}
		};
		return { services, requests, origin: fixture.origin };
	}

	it('pauses and resumes the same import, and pause-all leaves original downloads running', async () => {
		const { db, dataDir } = await database();
		const { services, requests, origin } = await gelbooru(db, dataDir, 21);
		const created = createCollectionImport(
			db,
			{ destination: 'favorite', source: 'gelbooru', query: 'landscape' },
			5_000
		);
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		await runCollectionImportPass(services);
		expect(requests.some((line) => line.includes('limit=20') && line.includes('pid=0'))).toBe(
			true
		);
		expect(importRow(db, created.import.id)).toMatchObject({
			state: 'queued',
			pageCursor: 1,
			addedCount: 20,
			total: 21
		});
		expect(count(db, 'favorites')).toBe(20);

		expect(pauseCollectionImport(db, created.import.id, 5_000)).toBe(true);
		await runCollectionImportPass(services);
		expect(importRow(db, created.import.id)).toMatchObject({
			id: created.import.id,
			state: 'paused',
			pageCursor: 1,
			addedCount: 20
		});
		expect(count(db, 'favorites')).toBe(20);

		expect(resumeCollectionImport(db, created.import.id, 5_000)).toBe(true);
		await runCollectionImportPass(services);
		expect(importRow(db, created.import.id)).toMatchObject({
			id: created.import.id,
			state: 'succeeded',
			pageCursor: 2,
			addedCount: 21,
			total: 21
		});
		expect(count(db, 'favorites')).toBe(21);
		expect(requests.some((line) => line.includes('limit=20') && line.includes('pid=1'))).toBe(
			true
		);

		const queuedOriginal: PostMetadata = {
			source: 'gelbooru',
			remoteId: '1',
			tags: ['held'],
			width: 8,
			height: 8,
			fileUrl: `${origin}/images/a.jpg`
		};
		saveFavorite(db, queuedOriginal, 5_000);
		const held = createCollectionImport(
			db,
			{ destination: 'favorite', source: 'gelbooru', query: 'landscape' },
			6_000
		);
		const other = createCollectionImport(
			db,
			{ destination: 'favorite', source: 'gelbooru', query: 'sunset' },
			6_001
		);
		expect(held.ok && other.ok).toBe(true);
		if (!held.ok || !other.ok) return;
		expect(pauseAllCollectionImports(db, 6_002)).toBe(2);
		await runCollectionImportPass(services);
		expect(importRow(db, held.import.id).state).toBe('paused');
		expect(importRow(db, other.import.id).state).toBe('paused');
		expect(importRow(db, held.import.id).addedCount).toBe(0);
		const favoritesBeforeDownloads = count(db, 'favorites');
		await runOriginalPass({
			db,
			dataDir,
			now: 7_000,
			fetchFile: async () => image(jpeg)
		});
		expect(count(db, 'favorites')).toBe(favoritesBeforeDownloads);
		expect(importRow(db, held.import.id)).toMatchObject({ state: 'paused', addedCount: 0 });
		expect(
			db.$client.prepare("select state from jobs where file_url = ?").get(`${origin}/images/a.jpg`)
		).toEqual({ state: 'succeeded' });
	});

	it('cancel stops further additions and keeps memberships and original jobs', async () => {
		const { db, dataDir } = await database();
		const { services } = await gelbooru(db, dataDir, 21);
		const created = createCollectionImport(
			db,
			{ destination: 'favorite', source: 'gelbooru', query: 'landscape' },
			5_000
		);
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		await runCollectionImportPass(services);
		expect(count(db, 'favorites')).toBe(20);
		expect(count(db, 'jobs')).toBe(20);
		expect(cancelCollectionImport(db, created.import.id, 5_000)).toBe(true);
		await runCollectionImportPass(services);
		expect(count(db, 'favorites')).toBe(20);
		expect(count(db, 'jobs')).toBe(20);
		expect(importRow(db, created.import.id)).toMatchObject({
			state: 'cancelled',
			pageCursor: 1,
			addedCount: 20
		});
		const jobs = db.$client.prepare('select state, kind from jobs').all() as {
			state: string;
			kind: string;
		}[];
		expect(jobs.every((job) => job.state === 'queued' && job.kind === 'original')).toBe(true);
	});

	it('dedups gelbooru posts through the existing save path', async () => {
		const { db, dataDir } = await database();
		const { services, requests } = await gelbooru(db, dataDir, 2);
		const existing: PostMetadata = {
			source: 'gelbooru',
			remoteId: '100',
			tags: ['landscape', 'sunset'],
			width: 100,
			height: 50,
			fileUrl: 'https://cdn.fixture.test/images/100.jpg',
			rating: 'general'
		};
		saveFavorite(db, existing, 1_000);
		const created = createCollectionImport(
			db,
			{
				destination: 'favorite',
				source: 'gelbooru',
				query: 'landscape',
				excludedIds: []
			},
			5_000
		);
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		await runCollectionImportPass(services);
		expect(requests.some((line) => new URL(line, 'http://fixture').searchParams.get('limit') === '20')).toBe(
			true
		);
		expect(importRow(db, created.import.id)).toMatchObject({
			state: 'succeeded',
			addedCount: 1,
			total: 2
		});
		expect(count(db, 'saved_items')).toBe(2);
		expect(count(db, 'favorites')).toBe(2);
		expect(count(db, 'jobs')).toBe(2);
		expect(
			(
				db.$client
					.prepare("select count(*) as n from saved_items where remote_id = '100'")
					.get() as { n: number }
			).n
		).toBe(1);

		const again = createCollectionImport(
			db,
			{ destination: 'favorite', source: 'gelbooru', query: 'landscape' },
			6_000
		);
		expect(again.ok).toBe(true);
		if (!again.ok) return;
		await runCollectionImportPass(services);
		expect(importRow(db, again.import.id)).toMatchObject({ state: 'succeeded', addedCount: 0 });
		expect(count(db, 'saved_items')).toBe(2);
		expect(count(db, 'favorites')).toBe(2);
		expect(count(db, 'jobs')).toBe(2);
		expect(db.$client.prepare('select distinct kind as kind from jobs').all()).toEqual([
			{ kind: 'original' }
		]);
	});

	it('pages sqlite favorites into an album without duplicating items', async () => {
		const { db, dataDir } = await database();
		for (let index = 0; index < 21; index += 1) {
			saveFavorite(
				db,
				{
					source: 'gelbooru',
					remoteId: String(index),
					tags: ['landscape'],
					width: 10 + index,
					height: 12,
					fileUrl: `https://cdn.fixture.test/images/${index}.jpg`
				},
				1_000 + index
			);
		}
		const album = createAlbum(db, 'Dusk', 2_000);
		const created = createCollectionImport(
			db,
			{
				destination: 'album',
				albumId: album.id,
				source: 'favorites',
				query: 'landscape'
			},
			3_000
		);
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		let upstream = 0;
		const services: CollectionImportContext = {
			db,
			dataDir,
			now: () => 4_000,
			fetchUpstream: async () => {
				upstream += 1;
				throw new Error('local import requested gelbooru');
			}
		};
		await runCollectionImportPass(services);
		expect(upstream).toBe(0);
		expect(importRow(db, created.import.id)).toMatchObject({
			state: 'queued',
			pageCursor: 1,
			addedCount: 20,
			total: 21
		});
		expect(count(db, 'album_items')).toBe(20);
		expect(count(db, 'saved_items')).toBe(21);
		expect(count(db, 'jobs')).toBe(21);

		await runCollectionImportPass(services);
		expect(importRow(db, created.import.id)).toMatchObject({
			state: 'succeeded',
			pageCursor: 2,
			addedCount: 21
		});
		expect(count(db, 'album_items')).toBe(21);
		expect(count(db, 'jobs')).toBe(21);

		const again = createCollectionImport(
			db,
			{ destination: 'album', albumId: album.id, source: 'favorites', query: 'landscape' },
			5_000
		);
		expect(again.ok).toBe(true);
		if (!again.ok) return;
		await runCollectionImportPass(services);
		expect(importRow(db, again.import.id).addedCount).toBe(0);
		expect(count(db, 'album_items')).toBe(21);
		expect(count(db, 'saved_items')).toBe(21);
		expect(count(db, 'jobs')).toBe(21);
		expect(upstream).toBe(0);
	});
});
