import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppServices } from '#lib/server/auth/dispatch.ts';
import { SCHEMA_VERSION, openDatabase, type AppDatabase } from '#lib/server/db/index.ts';
import type { AlbumRecord, SavedSearchRecord } from '#lib/server/library/collections.ts';
import { handleLibrary } from '#lib/server/library/routes.ts';
import { expireRemovals, removalHoldMs } from '#lib/server/library/removal.ts';
import {
	createAlbum,
	removeAlbumMembershipRow,
	saveAlbumMembership,
	saveFavorite,
	type PostMetadata
} from '#lib/server/library/save.ts';

const sunset: PostMetadata = {
	source: 'gelbooru',
	remoteId: '10',
	tags: ['sunset'],
	width: 100,
	height: 50,
	fileUrl: 'https://cdn.fixture.test/images/a.jpg'
};

const ratings = ['General', 'Sensitive', 'Questionable', 'Explicit'];
const media = ['Images', 'Animated images', 'Videos'];

describe('collection schema and routes', () => {
	const directories: string[] = [];
	const databases: AppDatabase[] = [];
	let now = 1_000;

	afterEach(async () => {
		while (databases.length) databases.pop()?.$client.close();
		while (directories.length) {
			const directory = directories.pop();
			if (directory) await rm(directory, { recursive: true, force: true });
		}
	});

	async function database() {
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-collections-'));
		directories.push(dataDir);
		const db = openDatabase(dataDir);
		databases.push(db);
		return { db, dataDir };
	}

	function services(db: AppDatabase, dataDir: string): AppServices {
		return {
			db,
			dataDir,
			now: () => now,
			media: new Map(),
			log: () => {}
		} as unknown as AppServices;
	}

	async function call(
		db: AppDatabase,
		dataDir: string,
		method: string,
		path: string,
		body?: unknown
	) {
		const url = `http://127.0.0.1${path}`;
		const response = await handleLibrary(
			new Request(url, {
				method,
				...(body === undefined
					? {}
					: { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
			}),
			new URL(url),
			services(db, dataDir),
			true
		);
		expect(response).not.toBeNull();
		const payload = (await response!.json()) as {
			data?: unknown;
			code?: string;
			matchId?: string;
		};
		return { status: response!.status, payload };
	}

	it('adds pin, temporary, and cover columns to an existing album database', async () => {
		expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(6);
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-collections-upgrade-'));
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
				(5, 1, 'derivatives-v5');
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
				created_at integer not null
			);
			insert into albums (id, name, created_at) values ('night', 'Night', 40);
		`);
		sqlite.close();
		const db = openDatabase(dataDir);
		databases.push(db);
		expect(
			db.$client
				.prepare(
					`select pinned, temporary_open as temporaryOpen, cover_saved as coverSaved,
						updated_at as updatedAt
					 from albums where id = 'night'`
				)
				.get()
		).toEqual({ pinned: 0, temporaryOpen: 0, coverSaved: 0, updatedAt: 40 });
		expect(
			db.$client.prepare('select version from schema_migrations where version = 6').get()
		).toEqual({
			version: 6
		});
		expect(db.$client.prepare('select count(*) as n from saved_searches').get()).toEqual({ n: 0 });
		db.$client.close();
		databases.pop();
		const again = openDatabase(dataDir);
		databases.push(again);
		expect(again.$client.prepare('select name from albums where id = ?').get('night')).toEqual({
			name: 'Night'
		});
	});

	it('uses the first album items until a cover is saved, then keeps the saved slots', async () => {
		const { db, dataDir } = await database();
		const album = createAlbum(db, 'Night', 1_000);
		const first = saveAlbumMembership(db, sunset, album.id, 1_100);
		const second = saveAlbumMembership(db, { ...sunset, remoteId: '11' }, album.id, 1_200);
		const third = saveAlbumMembership(db, { ...sunset, remoteId: '12' }, album.id, 1_300);

		const before = await call(db, dataDir, 'GET', `/api/library/albums/${album.id}`);
		expect(before.status).toBe(200);
		const unsaved = before.payload.data as AlbumRecord;
		expect(unsaved.itemCount).toBe(3);
		expect(unsaved.updatedAt).toBe(1_300);
		expect(unsaved.cover.saved).toBe(false);
		expect(unsaved.cover.fallback).toBe('first-items');
		expect(unsaved.cover.fallbackSource).toBe('album-membership');
		expect(unsaved.cover.primaryIndex).toBe(0);
		expect(unsaved.cover.slots).toEqual([null, null, null, null]);
		expect(unsaved.cover.firstItems.map((item) => item.itemId)).toEqual([
			first.itemId,
			second.itemId,
			third.itemId
		]);
		expect(unsaved.cover.firstItems[0]).toEqual({
			itemId: first.itemId,
			available: true,
			src: `/api/library/originals/${first.itemId}`
		});

		now = 1_400;
		const swapped = await call(db, dataDir, 'PUT', `/api/library/albums/${album.id}/cover`, {
			slots: [second.itemId, { itemId: first.itemId }, third.itemId, null]
		});
		expect(swapped.status).toBe(200);
		const saved = swapped.payload.data as AlbumRecord;
		expect(saved.cover.saved).toBe(true);
		expect(saved.cover.fallback).toBeNull();
		expect(saved.cover.slots.map((slot) => slot?.itemId ?? null)).toEqual([
			second.itemId,
			first.itemId,
			third.itemId,
			null
		]);

		now = 1_500;
		const reordered = await call(db, dataDir, 'PUT', `/api/library/albums/${album.id}/cover`, {
			slots: [first.itemId, third.itemId, second.itemId, null]
		});
		expect(reordered.status).toBe(200);
		expect(
			(reordered.payload.data as AlbumRecord).cover.slots.map((slot) => slot?.itemId ?? null)
		).toEqual([first.itemId, third.itemId, second.itemId, null]);

		const rejected = await call(db, dataDir, 'PUT', `/api/library/albums/${album.id}/cover`, {
			slots: [first.itemId, 'missing-item', null, null]
		});
		expect(rejected.status).toBe(400);
		const kept = await call(db, dataDir, 'GET', `/api/library/albums/${album.id}`);
		expect(
			(kept.payload.data as AlbumRecord).cover.slots.map((slot) => slot?.itemId ?? null)
		).toEqual([first.itemId, third.itemId, second.itemId, null]);

		expect(removeAlbumMembershipRow(db, dataDir, album.id, second.itemId, 1_600)).toBe(true);
		expireRemovals(db, dataDir, 1_600 + removalHoldMs);
		const afterRemoval = await call(db, dataDir, 'GET', `/api/library/albums/${album.id}`);
		const cover = (afterRemoval.payload.data as AlbumRecord).cover;
		expect(cover.saved).toBe(true);
		expect(cover.fallback).toBeNull();
		expect(cover.slots[2]).toMatchObject({ itemId: second.itemId, available: false, src: null });
		expect(cover.firstItems.map((item) => item.itemId)).toEqual([first.itemId, third.itemId]);
	});

	it('pins albums into an ordered sidebar group and closes a temporary open without deleting it', async () => {
		const { db, dataDir } = await database();
		now = 2_000;
		const night = await call(db, dataDir, 'POST', '/api/library/albums', { name: 'Night' });
		const day = await call(db, dataDir, 'POST', '/api/library/albums', { name: 'Day' });
		const dusk = await call(db, dataDir, 'POST', '/api/library/albums', { name: 'Dusk' });
		const dawn = await call(db, dataDir, 'POST', '/api/library/albums', { name: 'Dawn' });
		const ids = [night, day, dusk, dawn].map(
			(response) => (response.payload.data as AlbumRecord).id
		);
		expect(ids.every(Boolean)).toBe(true);
		const [nightId, dayId, duskId, dawnId] = ids as [string, string, string, string];
		expect((night.payload.data as AlbumRecord).cover.fallback).toBe('first-items');
		expect((night.payload.data as AlbumRecord).pinned).toBe(false);
		expect((night.payload.data as AlbumRecord).temporary).toBe(false);

		now = 2_100;
		const pinDay = await call(db, dataDir, 'POST', `/api/library/albums/${dayId}/pin`, {
			pinned: true
		});
		expect(pinDay.status).toBe(200);
		expect(sidebar(pinDay.payload.data)).toEqual({ temporary: [], pinned: [dayId] });

		const pinNight = await call(db, dataDir, 'POST', `/api/library/albums/${nightId}/pin`, {
			pinned: true
		});
		expect(sidebar(pinNight.payload.data)).toEqual({ temporary: [], pinned: [nightId, dayId] });

		const pinDusk = await call(db, dataDir, 'POST', `/api/library/albums/${duskId}/pin`, {
			pinned: true,
			position: 1
		});
		expect(sidebar(pinDusk.payload.data)).toEqual({
			temporary: [],
			pinned: [nightId, duskId, dayId]
		});

		now = 2_200;
		const openPinned = await call(db, dataDir, 'POST', `/api/library/albums/${nightId}/open`);
		expect(sidebar(openPinned.payload.data)).toEqual({
			temporary: [],
			pinned: [nightId, duskId, dayId]
		});

		now = 3_000;
		const openDawn = await call(db, dataDir, 'POST', `/api/library/albums/${dawnId}/open`);
		expect(sidebar(openDawn.payload.data)).toEqual({
			temporary: [dawnId],
			pinned: [nightId, duskId, dayId]
		});
		expect((openDawn.payload.data as { album: AlbumRecord }).album.temporaryOpenedAt).toBe(3_000);

		now = 4_000;
		const openAgain = await call(db, dataDir, 'POST', `/api/library/albums/${dawnId}/open`);
		expect((openAgain.payload.data as { album: AlbumRecord }).album.temporaryOpenedAt).toBe(3_000);

		const pinDawn = await call(db, dataDir, 'POST', `/api/library/albums/${dawnId}/pin`, {
			pinned: true,
			position: 99
		});
		expect(sidebar(pinDawn.payload.data)).toEqual({
			temporary: [],
			pinned: [nightId, duskId, dayId, dawnId]
		});

		now = 5_000;
		const unpinDawn = await call(db, dataDir, 'POST', `/api/library/albums/${dawnId}/pin`, {
			pinned: false,
			keepOpen: true
		});
		expect(sidebar(unpinDawn.payload.data)).toEqual({
			temporary: [dawnId],
			pinned: [nightId, duskId, dayId]
		});
		expect((unpinDawn.payload.data as { album: AlbumRecord }).album.temporaryOpenedAt).toBe(5_000);

		const closed = await call(db, dataDir, 'DELETE', `/api/library/albums/${dawnId}/open`);
		expect(closed.status).toBe(200);
		expect(sidebar(closed.payload.data)).toEqual({
			temporary: [],
			pinned: [nightId, duskId, dayId]
		});
		const stillThere = await call(db, dataDir, 'GET', `/api/library/albums/${dawnId}`);
		expect(stillThere.status).toBe(200);
		expect((stillThere.payload.data as AlbumRecord).name).toBe('Dawn');
		expect((stillThere.payload.data as AlbumRecord).temporary).toBe(false);
		expect(db.$client.prepare('select count(*) as n from albums').get()).toEqual({ n: 4 });
	});

	it('stores an applied saved search, opens a new view, and deletes only that row', async () => {
		const { db, dataDir } = await database();
		now = 6_000;
		const created = await call(db, dataDir, 'POST', '/api/library/saved-searches', {
			query: 'hatsune_miku',
			draft: 'forest sunset',
			type: 'character',
			rating: ['explicit', 'General'],
			sort: 'oldest'
		});
		expect(created.status).toBe(200);
		const saved = created.payload.data as SavedSearchRecord;
		expect(saved).toMatchObject({
			name: 'hatsune_miku',
			type: 'character',
			bookmarkLabel: 'Save character',
			query: 'hatsune_miku',
			rating: ['General', 'Explicit'],
			media,
			sort: 'Oldest'
		});
		expect(saved.cover).toMatchObject({
			saved: false,
			fallback: 'first-items',
			fallbackSource: 'applied-query',
			slots: [null, null, null, null],
			firstItems: []
		});
		expect(saved.exploration).toEqual({
			action: 'new-view',
			reuse: false,
			background: false,
			placement: 'top',
			recordHistory: true,
			query: 'hatsune_miku',
			rating: ['General', 'Explicit'],
			media,
			sort: 'Oldest'
		});
		expect(db.$client.prepare('select count(*) as n from saved_items').get()).toEqual({ n: 0 });

		const duplicate = await call(db, dataDir, 'POST', '/api/library/saved-searches', {
			query: 'hatsune_miku',
			type: 'search',
			name: 'Other',
			rating: ['General', 'Explicit'],
			sort: 'Oldest'
		});
		expect(duplicate.status).toBe(409);
		expect(duplicate.payload).toMatchObject({
			code: 'CONFLICT',
			matchId: saved.id
		});
		expect(db.$client.prepare('select count(*) as n from saved_searches').get()).toEqual({ n: 1 });

		const missed = await call(db, dataDir, 'POST', '/api/library/saved-searches/match', {
			query: 'hatsune_miku',
			sort: 'Newest'
		});
		expect(missed.status).toBe(200);
		expect(missed.payload.data).toBeNull();
		const matched = await call(db, dataDir, 'POST', '/api/library/saved-searches/match', {
			query: 'hatsune_miku',
			rating: ['Explicit', 'General'],
			sort: 'Oldest'
		});
		expect((matched.payload.data as SavedSearchRecord).id).toBe(saved.id);

		now = 6_100;
		const opened = await call(db, dataDir, 'POST', `/api/library/saved-searches/${saved.id}/open`);
		expect(opened.status).toBe(200);
		expect((opened.payload.data as SavedSearchRecord).exploration.action).toBe('new-view');
		expect((opened.payload.data as SavedSearchRecord).exploration.reuse).toBe(false);
		expect((opened.payload.data as SavedSearchRecord).updatedAt).toBe(saved.updatedAt);
		expect(db.$client.prepare('select count(*) as n from saved_searches').get()).toEqual({ n: 1 });

		const renamed = await call(db, dataDir, 'POST', `/api/library/saved-searches/${saved.id}`, {
			name: 'Miku',
			type: 'artist'
		});
		expect(renamed.status).toBe(200);
		expect(renamed.payload.data).toMatchObject({
			name: 'Miku',
			type: 'artist',
			bookmarkLabel: 'Save artist',
			query: 'hatsune_miku',
			sort: 'Oldest'
		});

		const filtered = await call(
			db,
			dataDir,
			'GET',
			'/api/library/saved-searches?q=miku&type=artist'
		);
		expect(filtered.status).toBe(200);
		expect(
			(filtered.payload.data as { savedSearches: SavedSearchRecord[] }).savedSearches
		).toHaveLength(1);
		const invalidType = await call(db, dataDir, 'GET', '/api/library/saved-searches?type=nope');
		expect(invalidType.status).toBe(400);

		const covered = await call(
			db,
			dataDir,
			'PUT',
			`/api/library/saved-searches/${saved.id}/cover`,
			{
				slots: ['42', null, null, null]
			}
		);
		expect(covered.status).toBe(200);
		expect((covered.payload.data as SavedSearchRecord).cover.slots[0]).toEqual({
			itemId: '42',
			src: null,
			available: false
		});

		const favorite = saveFavorite(db, sunset, 6_200);
		const album = createAlbum(db, 'Night', 6_300);
		const removed = await call(db, dataDir, 'DELETE', `/api/library/saved-searches/${saved.id}`);
		expect(removed.status).toBe(200);
		expect(removed.payload.data).toEqual({ removed: true });
		expect(db.$client.prepare('select count(*) as n from saved_searches').get()).toEqual({ n: 0 });
		expect(db.$client.prepare('select count(*) as n from favorites').get()).toEqual({ n: 1 });
		expect(db.$client.prepare('select id from albums').all()).toEqual([{ id: album.id }]);
		expect(db.$client.prepare('select id from saved_items').get()).toEqual({ id: favorite.itemId });
		const missing = await call(db, dataDir, 'DELETE', `/api/library/saved-searches/${saved.id}`);
		expect(missing.status).toBe(404);

		const denied = await handleLibrary(
			new Request(`http://127.0.0.1/api/library/saved-searches/${saved.id}`, { method: 'DELETE' }),
			new URL(`http://127.0.0.1/api/library/saved-searches/${saved.id}`),
			services(db, dataDir),
			false
		);
		expect(denied?.status).toBe(401);
	});

	it('names an empty applied query All posts and rejects a second copy of the defaults', async () => {
		const { db, dataDir } = await database();
		const created = await call(db, dataDir, 'POST', '/api/library/saved-searches', {
			query: '   '
		});
		expect(created.status).toBe(200);
		expect(created.payload.data).toMatchObject({
			name: 'All posts',
			type: 'search',
			bookmarkLabel: 'Save search',
			query: '',
			rating: ratings,
			media,
			sort: 'Newest'
		});
		const again = await call(db, dataDir, 'POST', '/api/library/saved-searches', { query: '' });
		expect(again.status).toBe(409);
		expect(again.payload.matchId).toBe((created.payload.data as SavedSearchRecord).id);
	});
});

function sidebar(data: unknown) {
	return (data as { albumSidebar: { temporary: string[]; pinned: string[] } }).albumSidebar;
}
