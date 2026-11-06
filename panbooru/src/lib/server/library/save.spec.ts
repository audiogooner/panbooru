import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '#lib/server/db/index.ts';
import { saveAlbumMembership, saveFavorite, type PostMetadata } from '#lib/server/library/save.ts';

const metadata: PostMetadata = {
	source: 'gelbooru',
	remoteId: '10',
	tags: ['landscape', 'sunset'],
	width: 100,
	height: 50,
	fileUrl: 'https://cdn.fixture.test/images/a.jpg?api_key=super-secret&user_id=7'
};

function count(db: AppDatabase, table: string) {
	const row = db.$client.prepare(`select count(*) as n from ${table}`).get() as { n: number };
	return row.n;
}

describe('library save transaction', () => {
	const directories: string[] = [];

	afterEach(async () => {
		while (directories.length) {
			const directory = directories.pop();
			if (directory) await rm(directory, { recursive: true, force: true });
		}
	});

	async function database() {
		const directory = await mkdtemp(join(tmpdir(), 'panbooru-save-'));
		directories.push(directory);
		return openDatabase(directory);
	}

	it('stores one saved item, one favorite, and one queued original job', async () => {
		const db = await database();
		const saved = saveFavorite(db, metadata);
		expect(saved).toMatchObject({ membership: 'favorite', original: 'queued' });
		expect(saved.itemId).toEqual(expect.any(String));
		expect(saved.original).not.toBe('ready');
		expect(count(db, 'saved_items')).toBe(1);
		expect(count(db, 'favorites')).toBe(1);
		expect(count(db, 'jobs')).toBe(1);
		const job = db.$client.prepare('select state, kind from jobs').get() as {
			state: string;
			kind: string;
		};
		expect(job).toEqual({ state: 'queued', kind: 'original' });
		expect(count(db, 'media_objects')).toBe(0);
		db.$client.close();
	});

	it('adds an album membership for the same metadata without a second item or job', async () => {
		const db = await database();
		const saved = saveFavorite(db, metadata);
		db.$client
			.prepare('insert into albums (id, name, created_at) values (?, ?, ?)')
			.run('album-night', 'Night', 1);
		const again = saveAlbumMembership(db, metadata, 'album-night');
		expect(again).toMatchObject({
			itemId: saved.itemId,
			membership: 'album',
			original: 'queued'
		});
		expect(count(db, 'saved_items')).toBe(1);
		expect(count(db, 'post_snapshots')).toBe(1);
		expect(count(db, 'jobs')).toBe(1);
		expect(count(db, 'favorites')).toBe(1);
		expect(count(db, 'album_items')).toBe(1);
		saveAlbumMembership(db, metadata, 'album-night');
		expect(count(db, 'album_items')).toBe(1);
		db.$client.close();
	});

	it('leaves neither a favorite nor a job when the transaction fails', async () => {
		const db = await database();
		db.$client.exec(`
			create trigger fail_favorite before insert on favorites
			begin
				select raise(abort, 'fail');
			end;
		`);
		expect(() => saveFavorite(db, metadata)).toThrow();
		expect(count(db, 'favorites')).toBe(0);
		expect(count(db, 'jobs')).toBe(0);
		expect(count(db, 'saved_items')).toBe(0);
		db.$client.close();
	});

	it('stores a snapshot without an API key, user id, or credential query string', async () => {
		const db = await database();
		saveFavorite(db, metadata);
		const row = db.$client.prepare('select snapshot from post_snapshots').get() as
			| { snapshot: string }
			| undefined;
		expect(row).toBeTruthy();
		const snapshot = row?.snapshot ?? '';
		expect(snapshot).not.toMatch(/api_key/i);
		expect(snapshot).not.toMatch(/user_id/i);
		expect(snapshot).not.toContain('super-secret');
		expect(snapshot).not.toContain('?');
		expect(snapshot).toContain('https://cdn.fixture.test/images/a.jpg');
		expect(snapshot).toContain('sunset');
		db.$client.close();
	});
});
