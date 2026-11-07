import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '#lib/server/db/index.ts';
import { undoRemoval } from '#lib/server/library/removal.ts';
import {
	listFavorites,
	removeFavoriteMembership,
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
});
