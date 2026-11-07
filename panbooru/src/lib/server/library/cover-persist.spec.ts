import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { SCHEMA_VERSION, openDatabase, type AppDatabase } from '#lib/server/db/index.ts';
import { sampleBorderColor, type Rgb } from '#lib/server/library/cover-color.ts';
import {
	coverPreviewFile,
	createSavedSearch,
	deleteSavedSearch,
	listAlbumCollection,
	mediaChoices,
	openSavedSearch,
	ratingChoices,
	readAlbum,
	readSavedSearch,
	saveAlbumCover,
	saveSavedSearchCover,
	settledCoverRefreshes
} from '#lib/server/library/collections.ts';
import { recipeNames } from '#lib/server/media/derivative.ts';
import { expireRemovals, removalHoldMs } from '#lib/server/library/removal.ts';
import {
	createAlbum,
	deleteAlbumRecord,
	removeAlbumMembershipRow,
	saveAlbumMembership,
	type PostMetadata
} from '#lib/server/library/save.ts';

const applied = {
	query: 'hatsune_miku',
	rating: [...ratingChoices],
	media: [...mediaChoices],
	sort: 'Newest' as const
};

describe('automatic cover persistence', () => {
	const directories: string[] = [];
	const databases: AppDatabase[] = [];

	afterEach(async () => {
		while (databases.length) databases.pop()?.$client.close();
		while (directories.length) {
			const directory = directories.pop();
			if (directory) await rm(directory, { recursive: true, force: true });
		}
	});

	async function database() {
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-cover-persist-'));
		directories.push(dataDir);
		const db = openDatabase(dataDir);
		databases.push(db);
		return { db, dataDir };
	}

	it('adds cover_auto_stopped when opening a version 7 database', async () => {
		expect(SCHEMA_VERSION).toBe(9);
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-cover-v7-'));
		directories.push(dataDir);
		const directory = join(dataDir, 'db');
		mkdirSync(directory, { recursive: true });
		const sqlite = new Database(join(directory, 'panbooru.sqlite'));
		sqlite.exec(`
			create table schema_migrations (
				version integer primary key,
				applied_at integer not null,
				checksum text not null
			);
			insert into schema_migrations (version, applied_at, checksum) values
				(1, 1, 'owner-sessions-v1'),
				(2, 1, 'library-v2'),
				(3, 1, 'removal-v3'),
				(4, 1, 'source-tags-v4'),
				(5, 1, 'derivatives-v5'),
				(6, 1, 'collections-v6'),
				(7, 1, 'collection-imports-v7');
			create table source_tags (
				source text not null,
				name text not null,
				category text not null,
				fetched_at integer not null,
				primary key (source, name)
			);
			create table albums (
				id text primary key,
				name text not null,
				created_at integer not null,
				updated_at integer not null default 0,
				pinned integer not null default 0,
				pin_order integer,
				temporary_open integer not null default 0,
				temporary_opened_at integer,
				cover_saved integer not null default 0,
				cover_primary text,
				cover_support_1 text,
				cover_support_2 text,
				cover_support_3 text
			);
			create table saved_searches (
				id text primary key,
				name text not null,
				type text not null,
				query text not null,
				rating text not null,
				media text not null,
				sort text not null,
				cover_saved integer not null default 0,
				cover_primary text,
				cover_support_1 text,
				cover_support_2 text,
				cover_support_3 text,
				created_at integer not null,
				updated_at integer not null
			);
			insert into albums (id, name, created_at) values ('night', 'Night', 40);
			insert into saved_searches (
				id, name, type, query, rating, media, sort, created_at, updated_at
			) values ('miku', 'Miku', 'search', 'hatsune_miku', '[]', '[]', 'Newest', 40, 40);
		`);
		sqlite.close();

		const db = openDatabase(dataDir);
		databases.push(db);
		expect(storedCover(db, 'albums', 'night')).toMatchObject({ saved: 0, stopped: 0 });
		expect(storedCover(db, 'saved_searches', 'miku')).toMatchObject({ saved: 0, stopped: 0 });
		expect(
			db.$client.prepare('select checksum from schema_migrations where version = 7').get()
		).toEqual({ checksum: 'collection-imports-v7' });
		expect(
			db.$client.prepare('select checksum from schema_migrations where version = 8').get()
		).toEqual({ checksum: 'cover-auto-v8' });
		db.$client.close();
		databases.pop();

		const again = openDatabase(dataDir);
		databases.push(again);
		expect(again.$client.prepare('select name from albums where id = ?').get('night')).toEqual({
			name: 'Night'
		});
		expect(storedCover(again, 'saved_searches', 'miku').stopped).toBe(0);
	});

	it('chooses supports as imaged posts are added and then stops inside distance 30', async () => {
		const { db, dataDir } = await database();
		const album = createAlbum(db, 'Night', 1_000);
		const primary = await addImage(db, dataDir, album.id, 'primary', { r: 0, g: 0, b: 0 }, 1_100);
		const far = await addImage(db, dataDir, album.id, 'far', { r: 0, g: 80, b: 0 }, 1_200);
		const wide = await addImage(db, dataDir, album.id, 'wide', { r: 40, g: 0, b: 0 }, 1_300);

		expect(storedCover(db, 'albums', album.id)).toEqual({
			saved: 0,
			stopped: 0,
			primaryId: null,
			support1: null,
			support2: null,
			support3: null
		});
		expect(readAlbum(db, album.id)?.cover.fallback).toBe('first-items');

		const mid = await addImage(db, dataDir, album.id, 'mid', { r: 0, g: 20, b: 0 }, 1_400);
		expect(storedCover(db, 'albums', album.id)).toEqual({
			saved: 0,
			stopped: 0,
			primaryId: primary,
			support1: mid,
			support2: wide,
			support3: far
		});
		const shown = readAlbum(db, album.id);
		expect(shown?.cover.saved).toBe(false);
		expect(shown?.cover.fallback).toBeNull();
		expect(shown?.cover.slots.map((slot) => slot?.itemId ?? null)).toEqual([
			primary,
			mid,
			wide,
			far
		]);
		expect(shown?.cover.slots[0]?.src).toBe(
			`/api/library/originals/${encodeURIComponent(primary)}`
		);
		expect(existsSync(previewOf(dataDir, primary) ?? '')).toBe(true);

		const near = await addImage(db, dataDir, album.id, 'near', { r: 10, g: 0, b: 0 }, 1_500);
		expect(storedCover(db, 'albums', album.id)).toMatchObject({
			stopped: 0,
			primaryId: primary,
			support1: near,
			support2: mid,
			support3: wide
		});

		const close = await addImage(db, dataDir, album.id, 'close', { r: 0, g: 0, b: 15 }, 1_600);
		await addImage(db, dataDir, album.id, 'edge', { r: 18, g: 24, b: 0 }, 1_700);
		expect(storedCover(db, 'albums', album.id)).toEqual({
			saved: 0,
			stopped: 1,
			primaryId: primary,
			support1: near,
			support2: close,
			support3: mid
		});

		const perfect = await addImage(db, dataDir, album.id, 'perfect', { r: 0, g: 0, b: 1 }, 1_800);
		expect(storedCover(db, 'albums', album.id).primaryId).toBe(primary);
		expect(storedCover(db, 'albums', album.id).support1).not.toBe(perfect);
		expect(storedCover(db, 'albums', album.id)).toMatchObject({
			stopped: 1,
			support1: near,
			support2: close,
			support3: mid
		});
		expect(existsSync(previewOf(dataDir, far) ?? '')).toBe(false);
	});

	it('keeps a manual cover where the editor saved it', async () => {
		const { db, dataDir } = await database();
		const album = createAlbum(db, 'Night', 2_000);
		const primary = await addImage(db, dataDir, album.id, 'primary', { r: 0, g: 0, b: 0 }, 2_100);
		const saved = saveAlbumCover(db, album.id, [primary, null, null, null], 2_200);
		expect(saved && saved !== 'not-member' ? saved.cover.saved : false).toBe(true);
		await settledCoverRefreshes();

		await addImage(db, dataDir, album.id, 'far', { r: 0, g: 80, b: 0 }, 2_300);
		await addImage(db, dataDir, album.id, 'wide', { r: 40, g: 0, b: 0 }, 2_400);
		await addImage(db, dataDir, album.id, 'mid', { r: 0, g: 20, b: 0 }, 2_500);
		await addImage(db, dataDir, album.id, 'near', { r: 1, g: 0, b: 0 }, 2_600);

		expect(storedCover(db, 'albums', album.id)).toEqual({
			saved: 1,
			stopped: 0,
			primaryId: primary,
			support1: null,
			support2: null,
			support3: null
		});
		expect(readAlbum(db, album.id)?.cover.fallback).toBeNull();
	});

	it('leaves a removed cover image empty and keeps its preview', async () => {
		const { db, dataDir } = await database();
		const album = createAlbum(db, 'Night', 3_000);
		const primary = await addImage(db, dataDir, album.id, 'primary', { r: 0, g: 0, b: 0 }, 3_100);
		const far = await addImage(db, dataDir, album.id, 'far', { r: 0, g: 80, b: 0 }, 3_200);
		const wide = await addImage(db, dataDir, album.id, 'wide', { r: 40, g: 0, b: 0 }, 3_300);
		const mid = await addImage(db, dataDir, album.id, 'mid', { r: 0, g: 20, b: 0 }, 3_400);
		const before = storedCover(db, 'albums', album.id);
		expect(before).toMatchObject({
			primaryId: primary,
			support1: mid,
			support2: wide,
			support3: far
		});

		expect(removeAlbumMembershipRow(db, dataDir, album.id, mid, 3_500)).toBe(true);
		expect(storedCover(db, 'albums', album.id)).toEqual(before);
		const preview = previewOf(dataDir, mid);
		expect(preview).toBeTruthy();
		expect(await sampleBorderColor(preview ?? '')).toEqual({ r: 0, g: 20, b: 0 });

		expireRemovals(db, dataDir, 3_500 + removalHoldMs);
		expect(db.$client.prepare('select id from saved_items where id = ?').get(mid)).toBeUndefined();
		expect(existsSync(preview ?? '')).toBe(true);
		const cover = readAlbum(db, album.id)?.cover;
		expect(cover?.slots.map((slot) => slot?.itemId ?? null)).toEqual([primary, mid, wide, far]);
		expect(cover?.slots[1]).toMatchObject({ itemId: mid, available: false });
		expect(cover?.slots[1]?.src?.startsWith('data:image/webp;base64,')).toBe(true);
		expect(cover?.slots[0]?.src).toBe(`/api/library/originals/${encodeURIComponent(primary)}`);
	});

	it('deletes a preview only after every cover slot has let it go', async () => {
		const { db, dataDir } = await database();
		const bytes = await Promise.all([
			solid({ r: 0, g: 0, b: 0 }),
			solid({ r: 0, g: 80, b: 0 }),
			solid({ r: 40, g: 0, b: 0 }),
			solid({ r: 0, g: 20, b: 0 })
		]);
		const night = createAlbum(db, 'Night', 4_000);
		const day = createAlbum(db, 'Day', 4_100);
		const ids: string[] = [];
		for (const [index, image] of bytes.entries()) {
			const remoteId = `shared-${index}`;
			const saved = saveAlbumMembership(db, post(remoteId), night.id, 4_200 + index);
			attachOriginal(db, dataDir, saved.itemId, image, remoteId);
			saveAlbumMembership(db, post(remoteId), day.id, 4_200 + index);
			ids.push(saved.itemId);
		}
		await settledCoverRefreshes();
		for (const itemId of ids) expect(existsSync(previewOf(dataDir, itemId) ?? '')).toBe(true);

		expect(deleteAlbumRecord(db, dataDir, night.id)).toBe(true);
		listAlbumCollection(db);
		for (const itemId of ids) expect(existsSync(previewOf(dataDir, itemId) ?? '')).toBe(true);

		expect(deleteAlbumRecord(db, dataDir, day.id)).toBe(true);
		listAlbumCollection(db);
		for (const itemId of ids) expect(existsSync(previewOf(dataDir, itemId) ?? '')).toBe(false);
	});

	it('samples the small derivative when a post has one', async () => {
		const { db, dataDir } = await database();
		const album = createAlbum(db, 'Night', 5_000);
		const images = await Promise.all([
			solid({ r: 0, g: 0, b: 0 }),
			solid({ r: 50, g: 0, b: 0 }),
			solid({ r: 60, g: 0, b: 0 }),
			solid({ r: 70, g: 0, b: 0 }),
			solid({ r: 0, g: 0, b: 200 }),
			solid({ r: 5, g: 0, b: 0 })
		]);
		const ids: string[] = [];
		for (const [index, image] of images.slice(0, 5).entries()) {
			const remoteId = `sample-${index}`;
			const saved = saveAlbumMembership(db, post(remoteId), album.id, 5_100 + index);
			attachOriginal(db, dataDir, saved.itemId, image, remoteId);
			ids.push(saved.itemId);
		}
		const special = ids[4] ?? '';
		attachDerivative(db, dataDir, special, post('sample-4').fileUrl, images[5] ?? Buffer.alloc(0));
		await settledCoverRefreshes();

		expect(storedCover(db, 'albums', album.id)).toMatchObject({
			primaryId: ids[0],
			support1: special,
			support2: ids[1],
			support3: ids[2]
		});
	});

	it('recalculates a saved search only when an open brings new results', async () => {
		const { db, dataDir } = await database();
		const created = createSavedSearch(db, { applied, type: 'character', name: 'Miku' }, 6_000);
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		const id = created.savedSearch.id;
		expect(readSavedSearch(db, id)?.cover).toMatchObject({
			saved: false,
			fallback: 'first-items',
			slots: [null, null, null, null]
		});
		expect((await openSavedSearch(db, id))?.cover.slots).toEqual([null, null, null, null]);
		expect((await openSavedSearch(db, id, []))?.cover.fallback).toBe('first-items');
		expect(storedCover(db, 'saved_searches', id).stopped).toBe(0);

		const first = await openSavedSearch(db, id, [
			await candidate('primary', { r: 0, g: 0, b: 0 }),
			await candidate('far', { r: 0, g: 80, b: 0 }),
			await candidate('wide', { r: 40, g: 0, b: 0 }),
			await candidate('mid', { r: 0, g: 20, b: 0 })
		]);
		expect(first?.cover.saved).toBe(false);
		expect(first?.cover.fallback).toBeNull();
		expect(first?.cover.slots.map((slot) => slot?.itemId ?? null)).toEqual([
			'primary',
			'mid',
			'wide',
			'far'
		]);
		expect(first?.cover.slots[0]?.src?.startsWith('data:image/webp;base64,')).toBe(true);
		expect(storedCover(db, 'saved_searches', id)).toMatchObject({
			saved: 0,
			stopped: 0,
			primaryId: 'primary'
		});
		expect((await openSavedSearch(db, id))?.cover.slots[0]?.itemId).toBe('primary');

		const moved = await openSavedSearch(db, id, [
			await candidate('other-first', { r: 90, g: 0, b: 0 }),
			await candidate('near', { r: 10, g: 0, b: 0 }),
			await candidate('wide', { r: 40, g: 0, b: 0 }),
			await candidate('mid', { r: 0, g: 20, b: 0 }),
			await candidate('far', { r: 0, g: 80, b: 0 })
		]);
		expect(moved?.cover.slots.map((slot) => slot?.itemId ?? null)).toEqual([
			'primary',
			'near',
			'mid',
			'wide'
		]);

		const frozen = await openSavedSearch(db, id, [
			await candidate('primary', { r: 0, g: 0, b: 0 }),
			await candidate('near', { r: 10, g: 0, b: 0 }),
			await candidate('south', { r: 0, g: 30, b: 0 }),
			await candidate('edge', { r: 18, g: 24, b: 0 }),
			await candidate('outlier', { r: 90, g: 0, b: 0 })
		]);
		expect(frozen?.cover.slots.map((slot) => slot?.itemId ?? null)).toEqual([
			'primary',
			'near',
			'south',
			'edge'
		]);
		expect(storedCover(db, 'saved_searches', id).stopped).toBe(1);

		const ignored = await openSavedSearch(db, id, [
			await candidate('perfect', { r: 0, g: 0, b: 1 }),
			await candidate('near', { r: 10, g: 0, b: 0 }),
			await candidate('south', { r: 0, g: 30, b: 0 }),
			await candidate('edge', { r: 18, g: 24, b: 0 })
		]);
		expect(ignored?.cover.slots.map((slot) => slot?.itemId ?? null)).toEqual([
			'primary',
			'near',
			'south',
			'edge'
		]);

		const manual = createSavedSearch(
			db,
			{ applied: { ...applied, query: 'vocaloid' }, type: 'search', name: 'Vocaloid' },
			6_100
		);
		expect(manual.ok).toBe(true);
		if (!manual.ok) return;
		const locked = saveSavedSearchCover(db, manual.savedSearch.id, ['42', null, null, null], 6_200);
		await settledCoverRefreshes();
		const still = await openSavedSearch(db, manual.savedSearch.id, [
			await candidate('primary', { r: 0, g: 0, b: 0 }),
			await candidate('near', { r: 1, g: 0, b: 0 }),
			await candidate('mid', { r: 0, g: 2, b: 0 }),
			await candidate('edge', { r: 0, g: 0, b: 3 })
		]);
		expect(locked?.cover.slots.map((slot) => slot?.itemId ?? null)).toEqual([
			'42',
			null,
			null,
			null
		]);
		expect(still?.cover.slots.map((slot) => slot?.itemId ?? null)).toEqual([
			'42',
			null,
			null,
			null
		]);
		expect(still?.cover.slots[0]).toEqual({ itemId: '42', available: false, src: null });

		expect(existsSync(previewOf(dataDir, 'primary') ?? '')).toBe(true);
		expect(deleteSavedSearch(db, id)).toBe(true);
		expect(existsSync(previewOf(dataDir, 'primary') ?? '')).toBe(false);
	});
});

function storedCover(db: AppDatabase, table: 'albums' | 'saved_searches', id: string) {
	return db.$client
		.prepare(
			`select cover_saved as saved,
				cover_auto_stopped as stopped,
				cover_primary as primaryId,
				cover_support_1 as support1,
				cover_support_2 as support2,
				cover_support_3 as support3
			 from ${table} where id = ?`
		)
		.get(id) as {
		saved: number;
		stopped: number;
		primaryId: string | null;
		support1: string | null;
		support2: string | null;
		support3: string | null;
	};
}

function post(remoteId: string): PostMetadata {
	return {
		source: 'gelbooru',
		remoteId,
		tags: ['cover'],
		width: 50,
		height: 40,
		fileUrl: `https://cdn.fixture.test/images/${remoteId}.png`
	};
}

async function addImage(
	db: AppDatabase,
	dataDir: string,
	albumId: string,
	remoteId: string,
	color: Rgb,
	now: number
) {
	const image = await solid(color);
	const saved = saveAlbumMembership(db, post(remoteId), albumId, now);
	attachOriginal(db, dataDir, saved.itemId, image, remoteId);
	await settledCoverRefreshes();
	return saved.itemId;
}

function attachOriginal(
	db: AppDatabase,
	dataDir: string,
	itemId: string,
	bytes: Buffer,
	name: string
) {
	const relativePath = join('media', 'originals', `${name}.png`);
	mkdirSync(join(dataDir, 'media', 'originals'), { recursive: true });
	writeFileSync(join(dataDir, relativePath), bytes);
	const mediaId = randomUUID();
	db.$client
		.prepare(
			`insert into media_objects (
				id, content_hash, relative_path, mime, byte_size, verified_at, state
			) values (?, ?, ?, 'image/png', ?, ?, 'ready')`
		)
		.run(mediaId, name, relativePath, bytes.length, Date.now());
	db.$client.prepare('update saved_items set media_id = ? where id = ?').run(mediaId, itemId);
}

function attachDerivative(
	db: AppDatabase,
	dataDir: string,
	itemId: string,
	fileUrl: string,
	bytes: Buffer
) {
	const relativePath = join('media', 'derivatives', `${itemId}.png`);
	mkdirSync(join(dataDir, 'media', 'derivatives'), { recursive: true });
	writeFileSync(join(dataDir, relativePath), bytes);
	db.$client
		.prepare(
			`insert into derivatives (
				id, source_identity, recipe, width, height, format, relative_path, byte_size, label
			) values (?, ?, ?, 50, 40, 'png', ?, ?, null)`
		)
		.run(randomUUID(), fileUrl, recipeNames.thumb, relativePath, bytes.length);
}

function previewOf(dataDir: string, itemId: string) {
	return coverPreviewFile(dataDir, itemId);
}

async function solid(color: Rgb) {
	return sharp({ create: { width: 50, height: 40, channels: 3, background: color } })
		.png()
		.toBuffer();
}

async function candidate(id: string, color: Rgb) {
	return { id, image: await solid(color) };
}
