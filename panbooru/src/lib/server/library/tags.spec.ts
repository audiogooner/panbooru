import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '#lib/server/db/index.ts';
import { listFavorites, saveFavorite, type PostMetadata } from '#lib/server/library/save.ts';
import { refreshTagCategories } from '#lib/server/library/tags.ts';

const metadata: PostMetadata = {
	source: 'gelbooru',
	remoteId: '10',
	tags: ['sunset', 'artist_name'],
	width: 100,
	height: 50,
	fileUrl: 'https://cdn.fixture.test/images/a.jpg'
};

function snapshotText(db: AppDatabase) {
	const row = db.$client.prepare('select snapshot from post_snapshots').get() as {
		snapshot: string;
	};
	return row.snapshot;
}

describe('tag category refresh', () => {
	const directories: string[] = [];
	const databases: AppDatabase[] = [];

	afterEach(async () => {
		while (databases.length) databases.pop()?.$client.close();
		while (directories.length) {
			const directory = directories.pop();
			if (directory) await rm(directory, { recursive: true, force: true });
		}
	});

	it('updates how a saved tag is classified without rewriting the snapshot or membership', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'panbooru-tags-'));
		directories.push(directory);
		const db = openDatabase(directory);
		databases.push(db);
		saveFavorite(db, metadata, 1_000);
		const savedSnapshot = snapshotText(db);

		refreshTagCategories(
			db,
			'gelbooru',
			[
				{ name: 'sunset', category: 'general' },
				{ name: 'artist_name', category: 'artist' }
			],
			2_000
		);
		expect(listFavorites(db)[0]?.tagList).toEqual([
			{ name: 'artist_name', category: 'artist' },
			{ name: 'sunset', category: 'general' }
		]);
		expect(snapshotText(db)).toBe(savedSnapshot);
		expect(db.$client.prepare('select count(*) as n from favorites').get()).toEqual({ n: 1 });

		refreshTagCategories(db, 'gelbooru', [{ name: 'artist_name', category: 'character' }], 3_000);
		expect(listFavorites(db)[0]?.tagList).toEqual([
			{ name: 'artist_name', category: 'character' },
			{ name: 'sunset', category: 'general' }
		]);
		expect(snapshotText(db)).toBe(savedSnapshot);
		expect(db.$client.prepare('select count(*) as n from favorites').get()).toEqual({ n: 1 });
	});
});
