import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '#lib/server/db/index.ts';
import { promoteOriginal } from '#lib/server/library/original.ts';
import { undoRemoval } from '#lib/server/library/removal.ts';
import {
	createAlbum,
	listAlbumPosts,
	listFavorites,
	removeFavoriteMembership,
	removeMemberships,
	saveAlbumMembership,
	saveFavorite,
	type PostMetadata
} from '#lib/server/library/save.ts';

const metadata: PostMetadata = {
	source: 'gelbooru',
	remoteId: '10',
	tags: ['sunset'],
	width: 100,
	height: 50,
	fileUrl: 'https://cdn.fixture.test/images/a.jpg'
};

const removedAt = 1_000_000;

function count(db: AppDatabase, table: string) {
	const row = db.$client.prepare(`select count(*) as n from ${table}`).get() as { n: number };
	return row.n;
}

describe('removal hold', () => {
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
		const directory = await mkdtemp(join(tmpdir(), 'panbooru-removal-'));
		directories.push(directory);
		const db = openDatabase(directory);
		databases.push(db);
		return { db, dataDir: directory };
	}

	it('keeps the saved item and records one favorite hold for 60 seconds', async () => {
		const { db, dataDir } = await database();
		const saved = saveFavorite(db, metadata, removedAt - 10);
		expect(removeFavoriteMembership(db, dataDir, saved.itemId, removedAt)).toBe(true);
		expect(count(db, 'favorites')).toBe(0);
		expect(count(db, 'saved_items')).toBe(1);
		expect(count(db, 'post_snapshots')).toBe(1);
		const action = db.$client
			.prepare('select id, removed_at as removedAt, expires_at as expiresAt from removal_actions')
			.get() as { id: string; removedAt: number; expiresAt: number };
		expect(action).toMatchObject({ removedAt, expiresAt: removedAt + 60_000 });
		const membership = db.$client
			.prepare(
				'select item_id as itemId, kind, album_id as albumId, added_at as addedAt from removal_memberships'
			)
			.get();
		expect(membership).toEqual({
			itemId: saved.itemId,
			kind: 'favorite',
			albumId: null,
			addedAt: removedAt - 10
		});
		expect(count(db, 'removal_actions')).toBe(1);
	});

	it('restores the favorite one millisecond before the hold expires', async () => {
		const { db, dataDir } = await database();
		const saved = saveFavorite(db, metadata, removedAt - 10);
		removeFavoriteMembership(db, dataDir, saved.itemId, removedAt);
		const action = db.$client.prepare('select id from removal_actions').get() as { id: string };
		expect(undoRemoval(db, dataDir, action.id, removedAt + 60_000 - 1)).toBe(true);
		expect(listFavorites(db).map((post) => post.id)).toEqual([saved.itemId]);
		expect(count(db, 'removal_actions')).toBe(0);
		expect(count(db, 'removal_memberships')).toBe(0);
	});

	it('stores no action and leaves the favorite when the removal fails', async () => {
		const { db, dataDir } = await database();
		const saved = saveFavorite(db, metadata, removedAt);
		db.$client.exec(`
			create trigger fail_removal before insert on removal_actions
			begin
				select raise(abort, 'fail');
			end;
		`);
		expect(() => removeFavoriteMembership(db, dataDir, saved.itemId, removedAt)).toThrow();
		expect(count(db, 'favorites')).toBe(1);
		expect(count(db, 'removal_actions')).toBe(0);
		expect(count(db, 'saved_items')).toBe(1);
	});

	it('deletes the held original at exactly 60 seconds', async () => {
		const { db, dataDir } = await database();
		const saved = saveFavorite(db, metadata, removedAt - 10);
		const file = originalFile(db, dataDir, saved.itemId, Buffer.from('sunset-bytes'));
		removeFavoriteMembership(db, dataDir, saved.itemId, removedAt);
		const action = db.$client.prepare('select id from removal_actions').get() as { id: string };
		expect(undoRemoval(db, dataDir, action.id, removedAt + 60_000)).toBe(false);
		expect(listFavorites(db)).toEqual([]);
		expect(count(db, 'saved_items')).toBe(0);
		expect(count(db, 'post_snapshots')).toBe(0);
		expect(existsSync(file)).toBe(false);
		expect(count(db, 'removal_actions')).toBe(0);
	});

	it('deletes the replaced hold immediately when nothing retains it', async () => {
		const { db, dataDir } = await database();
		const first = saveFavorite(db, metadata, removedAt - 10);
		const firstFile = originalFile(db, dataDir, first.itemId, Buffer.from('sunset-bytes'));
		const second = saveFavorite(db, { ...metadata, remoteId: '11' }, removedAt);
		const secondFile = originalFile(db, dataDir, second.itemId, Buffer.from('forest-bytes'));
		removeFavoriteMembership(db, dataDir, first.itemId, removedAt);
		removeFavoriteMembership(db, dataDir, second.itemId, removedAt + 1);
		expect(existsSync(firstFile)).toBe(false);
		expect(count(db, 'saved_items')).toBe(1);
		expect(existsSync(secondFile)).toBe(true);
		const action = db.$client
			.prepare('select removed_at as removedAt from removal_actions')
			.get() as { removedAt: number };
		expect(action.removedAt).toBe(removedAt + 1);
	});

	it('keeps an original that an album still retains when the hold is replaced', async () => {
		const { db, dataDir } = await database();
		const saved = saveFavorite(db, metadata, removedAt - 10);
		const file = originalFile(db, dataDir, saved.itemId, Buffer.from('sunset-bytes'));
		const album = createAlbum(db, 'Landscapes', removedAt - 5);
		saveAlbumMembership(db, metadata, album.id, removedAt - 5);
		removeFavoriteMembership(db, dataDir, saved.itemId, removedAt);
		expect(existsSync(file)).toBe(true);
		const other = saveFavorite(db, { ...metadata, remoteId: '11' }, removedAt);
		const otherFile = originalFile(db, dataDir, other.itemId, Buffer.from('forest-bytes'));
		removeFavoriteMembership(db, dataDir, other.itemId, removedAt + 1);
		expect(existsSync(file)).toBe(true);
		expect(existsSync(otherFile)).toBe(true);
		expect(count(db, 'saved_items')).toBe(2);
	});

	it('records one action when one call removes a favorite and an album membership', async () => {
		const { db, dataDir } = await database();
		const favorite = saveFavorite(db, metadata, removedAt - 20);
		const album = createAlbum(db, 'Landscapes', removedAt - 15);
		const albumPost = saveAlbumMembership(
			db,
			{ ...metadata, remoteId: '11' },
			album.id,
			removedAt - 15
		);
		expect(
			removeMemberships(
				db,
				dataDir,
				[
					{ itemId: favorite.itemId, kind: 'favorite' },
					{ itemId: albumPost.itemId, kind: 'album', albumId: album.id }
				],
				removedAt
			)
		).toBe(true);
		expect(count(db, 'removal_actions')).toBe(1);
		expect(count(db, 'favorites')).toBe(0);
		expect(listAlbumPosts(db, album.id)).toEqual([]);
		const rows = db.$client
			.prepare(
				`select item_id as itemId, kind, album_id as albumId, added_at as addedAt
				 from removal_memberships order by added_at`
			)
			.all();
		expect(rows).toEqual([
			{ itemId: favorite.itemId, kind: 'favorite', albumId: null, addedAt: removedAt - 20 },
			{ itemId: albumPost.itemId, kind: 'album', albumId: album.id, addedAt: removedAt - 15 }
		]);
	});

	it('restores the favorite and the album post from that action', async () => {
		const { db, dataDir } = await database();
		const favorite = saveFavorite(db, metadata, removedAt - 20);
		const album = createAlbum(db, 'Landscapes', removedAt - 15);
		const albumPost = saveAlbumMembership(
			db,
			{ ...metadata, remoteId: '11' },
			album.id,
			removedAt - 15
		);
		removeMemberships(
			db,
			dataDir,
			[
				{ itemId: favorite.itemId, kind: 'favorite' },
				{ itemId: albumPost.itemId, kind: 'album', albumId: album.id }
			],
			removedAt
		);
		const action = db.$client.prepare('select id from removal_actions').get() as { id: string };
		expect(undoRemoval(db, dataDir, action.id, removedAt + 1)).toBe(true);
		expect(listFavorites(db).map((post) => post.id)).toEqual([favorite.itemId]);
		expect(listAlbumPosts(db, album.id).map((post) => post.id)).toEqual([albumPost.itemId]);
	});

	it('drops both holds together and keeps a post another membership retains', async () => {
		const { db, dataDir } = await database();
		const album = createAlbum(db, 'Landscapes', removedAt - 30);
		const kept = saveFavorite(db, metadata, removedAt - 20);
		saveAlbumMembership(db, metadata, album.id, removedAt - 20);
		const keptFile = originalFile(db, dataDir, kept.itemId, Buffer.from('sunset-bytes'));
		const dropped = saveAlbumMembership(
			db,
			{ ...metadata, remoteId: '11' },
			album.id,
			removedAt - 15
		);
		const droppedFile = originalFile(db, dataDir, dropped.itemId, Buffer.from('forest-bytes'));
		const later = saveFavorite(db, { ...metadata, remoteId: '12' }, removedAt);
		const laterFile = originalFile(db, dataDir, later.itemId, Buffer.from('ridge-bytes'));
		removeMemberships(
			db,
			dataDir,
			[
				{ itemId: kept.itemId, kind: 'favorite' },
				{ itemId: dropped.itemId, kind: 'album', albumId: album.id }
			],
			removedAt
		);
		removeFavoriteMembership(db, dataDir, later.itemId, removedAt + 1);
		expect(existsSync(keptFile)).toBe(true);
		expect(existsSync(droppedFile)).toBe(false);
		expect(existsSync(laterFile)).toBe(true);
		expect(count(db, 'saved_items')).toBe(2);
		expect(count(db, 'removal_memberships')).toBe(1);
	});
});

function originalFile(db: AppDatabase, dataDir: string, itemId: string, body: Buffer) {
	const promoted = promoteOriginal({
		db,
		dataDir,
		itemId,
		body,
		mime: 'image/jpeg',
		expectedBytes: body.byteLength,
		expectedHash: createHash('sha256').update(body).digest('hex')
	});
	if (!promoted.relativePath) throw new Error('original was not stored');
	return join(dataDir, promoted.relativePath);
}
