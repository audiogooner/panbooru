import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '#lib/server/db/index.ts';
import { promoteOriginal } from '#lib/server/library/original.ts';
import {
	createAlbum,
	deleteAlbumRecord,
	listAlbumPosts,
	listFavorites,
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

describe('album deletion', () => {
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
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-album-'));
		directories.push(dataDir);
		const db = openDatabase(dataDir);
		databases.push(db);
		return { db, dataDir };
	}

	it('deletes an album and the post that nothing else keeps', async () => {
		const { db, dataDir } = await database();
		const album = createAlbum(db, 'Night', 1_000);
		const saved = saveAlbumMembership(db, sunset, album.id, 1_000);
		const file = originalFile(db, dataDir, saved.itemId, Buffer.from('sunset-bytes'));
		expect(deleteAlbumRecord(db, dataDir, album.id)).toBe(true);
		expect(listAlbumPosts(db, album.id)).toEqual([]);
		expect(db.$client.prepare('select count(*) as n from albums').get()).toEqual({ n: 0 });
		expect(db.$client.prepare('select count(*) as n from saved_items').get()).toEqual({ n: 0 });
		expect(existsSync(file)).toBe(false);
		expect(db.$client.prepare('select count(*) as n from removal_actions').get()).toEqual({ n: 0 });
	});

	it('keeps a favorited post and a post that remains in another album', async () => {
		const { db, dataDir } = await database();
		const night = createAlbum(db, 'Night', 1_000);
		const day = createAlbum(db, 'Day', 1_000);
		const favorited = saveFavorite(db, sunset, 1_000);
		saveAlbumMembership(db, sunset, night.id, 1_000);
		const sharedFile = originalFile(db, dataDir, favorited.itemId, Buffer.from('sunset-bytes'));
		const other = saveAlbumMembership(db, { ...sunset, remoteId: '11' }, night.id, 1_100);
		saveAlbumMembership(db, { ...sunset, remoteId: '11' }, day.id, 1_100);
		const otherFile = originalFile(db, dataDir, other.itemId, Buffer.from('forest-bytes'));
		const onlyNight = saveAlbumMembership(db, { ...sunset, remoteId: '12' }, night.id, 1_200);
		const onlyFile = originalFile(db, dataDir, onlyNight.itemId, Buffer.from('ridge-bytes'));

		expect(deleteAlbumRecord(db, dataDir, night.id)).toBe(true);
		expect(listFavorites(db).map((post) => post.id)).toEqual([favorited.itemId]);
		expect(listAlbumPosts(db, day.id).map((post) => post.id)).toEqual([other.itemId]);
		expect(existsSync(sharedFile)).toBe(true);
		expect(existsSync(otherFile)).toBe(true);
		expect(existsSync(onlyFile)).toBe(false);
		expect(db.$client.prepare('select id from albums').all()).toEqual([{ id: day.id }]);
	});

	it('keeps a shared original when another saved post still references it', async () => {
		const { db, dataDir } = await database();
		const album = createAlbum(db, 'Night', 1_000);
		const kept = saveFavorite(db, sunset, 1_000);
		const body = Buffer.from('same-bytes');
		const file = originalFile(db, dataDir, kept.itemId, body);
		const dropped = saveAlbumMembership(db, { ...sunset, remoteId: '11' }, album.id, 1_100);
		promoteOriginal({
			db,
			dataDir,
			itemId: dropped.itemId,
			body,
			mime: 'image/jpeg',
			expectedBytes: body.length,
			expectedHash: createHash('sha256').update(body).digest('hex')
		});
		expect(deleteAlbumRecord(db, dataDir, album.id)).toBe(true);
		expect(existsSync(file)).toBe(true);
		expect(listFavorites(db)).toHaveLength(1);
		expect(db.$client.prepare('select count(*) as n from saved_items').get()).toEqual({ n: 1 });
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
