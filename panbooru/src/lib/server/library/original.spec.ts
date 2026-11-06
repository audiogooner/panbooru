import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '#lib/server/db/index.ts';
import { promoteOriginal } from '#lib/server/library/original.ts';
import { saveFavorite, type PostMetadata } from '#lib/server/library/save.ts';

const metadata: PostMetadata = {
	source: 'gelbooru',
	remoteId: '10',
	tags: ['landscape', 'sunset'],
	width: 100,
	height: 50,
	fileUrl: 'https://cdn.fixture.test/images/a.jpg'
};

function sha256(body: Buffer) {
	return createHash('sha256').update(body).digest('hex');
}

function originals(dataDir: string) {
	const directory = join(dataDir, 'media', 'originals');
	return existsSync(directory) ? readdirSync(directory) : [];
}

describe('verified original file', () => {
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
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-original-'));
		directories.push(dataDir);
		const db = openDatabase(dataDir);
		databases.push(db);
		return { db, dataDir };
	}

	it('writes a complete body to a temp file, hashes it, and records the renamed original ready', async () => {
		const { db, dataDir } = await database();
		const saved = saveFavorite(db, metadata);
		const body = Buffer.from('complete-jpeg-bytes');
		const hash = sha256(body);
		const result = promoteOriginal({
			db,
			dataDir,
			itemId: saved.itemId,
			body,
			mime: 'image/jpeg',
			expectedBytes: body.length,
			expectedHash: hash
		});

		expect(result.ready).toBe(true);
		const finalPath = join(dataDir, 'media', 'originals', hash);
		expect(result.relativePath).toBe(join('media', 'originals', hash));
		expect(existsSync(finalPath)).toBe(true);
		expect(await readFile(finalPath)).toEqual(body);
		expect(originals(dataDir)).toEqual([hash]);
		expect(existsSync(join(dataDir, 'tmp'))).toBe(true);
		const temps = readdirSync(join(dataDir, 'tmp')).filter((name) => name.startsWith('original-'));
		expect(temps).toEqual([]);
		const media = db.$client.prepare('select state, content_hash, byte_size from media_objects').get() as {
			state: string;
			content_hash: string;
			byte_size: number;
		};
		expect(media).toEqual({ state: 'ready', content_hash: hash, byte_size: body.length });
		const item = db.$client.prepare('select media_id from saved_items where id = ?').get(saved.itemId) as {
			media_id: string;
		};
		expect(item.media_id).toBe(result.mediaId);
	});

	it('leaves the item not ready and writes no final file when the body is short or the hash mismatches', async () => {
		const { db, dataDir } = await database();
		const shortItem = saveFavorite(db, { ...metadata, remoteId: '11' });
		const shortBody = Buffer.from('short');
		const short = promoteOriginal({
			db,
			dataDir,
			itemId: shortItem.itemId,
			body: shortBody,
			mime: 'image/jpeg',
			expectedBytes: 100,
			expectedHash: sha256(shortBody)
		});
		expect(short.ready).toBe(false);
		expect(short.mediaId).toBeNull();
		expect(originals(dataDir)).toEqual([]);
		const shortRow = db.$client
			.prepare('select media_id from saved_items where id = ?')
			.get(shortItem.itemId) as { media_id: string | null };
		expect(shortRow.media_id).toBeNull();

		const mismatchItem = saveFavorite(db, { ...metadata, remoteId: '12' });
		const body = Buffer.from('complete-jpeg-bytes');
		const mismatch = promoteOriginal({
			db,
			dataDir,
			itemId: mismatchItem.itemId,
			body,
			mime: 'image/jpeg',
			expectedBytes: body.length,
			expectedHash: 'ab'.repeat(32)
		});
		expect(mismatch.ready).toBe(false);
		expect(mismatch.mediaId).toBeNull();
		expect(originals(dataDir)).toEqual([]);
		expect(
			db.$client.prepare("select count(*) as n from media_objects where state = 'ready'").get()
		).toEqual({ n: 0 });
	});

	it('reuses one file when a second item has the same bytes', async () => {
		const { db, dataDir } = await database();
		const body = Buffer.from('shared-jpeg-bytes');
		const hash = sha256(body);
		const first = saveFavorite(db, metadata);
		const second = saveFavorite(db, { ...metadata, remoteId: '12', tags: ['forest'] });
		const promoted = [first.itemId, second.itemId].map((itemId) =>
			promoteOriginal({
				db,
				dataDir,
				itemId,
				body,
				mime: 'image/jpeg',
				expectedBytes: body.length,
				expectedHash: hash
			})
		);

		expect(promoted.every((result) => result.ready)).toBe(true);
		expect(promoted[0]?.mediaId).toBe(promoted[1]?.mediaId);
		expect(originals(dataDir)).toEqual([hash]);
		expect(db.$client.prepare('select count(*) as n from media_objects').get()).toEqual({ n: 1 });
		const links = db.$client.prepare('select media_id from saved_items order by remote_id').all() as {
			media_id: string;
		}[];
		expect(links.map((row) => row.media_id)).toEqual([promoted[0]?.mediaId, promoted[0]?.mediaId]);
	});
});
