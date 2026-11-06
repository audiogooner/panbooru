import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '#lib/server/db/index.ts';
import { saveFavorite, type PostMetadata } from '#lib/server/library/save.ts';
import { ORIGINAL_LEASE_MS, runOriginalPass } from '#lib/server/library/worker.ts';

const metadata: PostMetadata = {
	source: 'gelbooru',
	remoteId: '10',
	tags: ['landscape', 'sunset'],
	width: 100,
	height: 50,
	fileUrl: 'https://cdn.fixture.test/images/a.jpg?api_key=super-secret&user_id=7'
};

const body = Buffer.from('jpeg-bytes');

function sha256(bytes: Buffer) {
	return createHash('sha256').update(bytes).digest('hex');
}

function image(bytes: Buffer) {
	return new Response(bytes, {
		status: 200,
		headers: {
			'content-type': 'image/jpeg',
			'content-length': String(bytes.length)
		}
	});
}

function originals(dataDir: string) {
	const directory = join(dataDir, 'media', 'originals');
	return existsSync(directory) ? readdirSync(directory).sort() : [];
}

describe('original download worker', () => {
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
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-worker-'));
		directories.push(dataDir);
		const db = openDatabase(dataDir);
		databases.push(db);
		return { db, dataDir };
	}

	it('lets saveFavorite return before the file exists, then one pass marks it ready', async () => {
		const { db, dataDir } = await database();
		const urls: string[] = [];
		const saved = saveFavorite(db, metadata);
		expect(saved.original).toBe('queued');
		expect(originals(dataDir)).toEqual([]);

		await runOriginalPass({
			db,
			dataDir,
			now: 1_000,
			fetchFile: async (url) => {
				urls.push(url);
				return image(body);
			}
		});

		expect(urls).toEqual(['https://cdn.fixture.test/images/a.jpg']);
		expect(originals(dataDir)).toEqual([sha256(body)]);
		expect(db.$client.prepare('select state from jobs').get()).toEqual({ state: 'succeeded' });
		expect(db.$client.prepare('select state from media_objects').get()).toEqual({ state: 'ready' });
	});

	it('claims an expired lease again and returns a failed verification to retry', async () => {
		const { db, dataDir } = await database();
		saveFavorite(db, metadata);
		const now = 5_000_000;
		db.$client
			.prepare("update jobs set state = 'leased', lease_until = ?")
			.run(now + ORIGINAL_LEASE_MS);
		let fetches = 0;
		const fetchFile = async () => {
			fetches += 1;
			return image(body);
		};
		await runOriginalPass({ db, dataDir, now, fetchFile });
		expect(fetches).toBe(0);

		db.$client.prepare('update jobs set lease_until = ?').run(now - 1);
		await runOriginalPass({ db, dataDir, now, fetchFile });
		expect(fetches).toBe(1);
		expect(db.$client.prepare('select state from jobs').get()).toEqual({ state: 'succeeded' });

		saveFavorite(db, { ...metadata, remoteId: '11' });
		db.$client
			.prepare("update jobs set expected_hash = ? where state = 'queued'")
			.run('ab'.repeat(32));
		await runOriginalPass({
			db,
			dataDir,
			now,
			fetchFile: async () => image(body)
		});
		const jobs = db.$client.prepare('select state from jobs order by state').all() as {
			state: string;
		}[];
		expect(jobs).toEqual([{ state: 'retry' }, { state: 'succeeded' }]);
		expect(
			db.$client.prepare("select count(*) as n from media_objects where state = 'ready'").get()
		).toEqual({ n: 1 });
		expect(originals(dataDir)).toEqual([sha256(body)]);
	});

	it('stops a second pass from claiming a job that already has a lease', async () => {
		const { db, dataDir } = await database();
		saveFavorite(db, metadata);
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let fetches = 0;
		const fetchFile = async () => {
			fetches += 1;
			await gate;
			return image(body);
		};
		const options = { db, dataDir, now: 2_000, fetchFile };
		try {
			const first = runOriginalPass(options);
			const second = runOriginalPass(options);
			expect(fetches).toBe(1);
			release();
			await Promise.all([first, second]);
		} finally {
			release();
		}
		expect(fetches).toBe(1);
		expect(db.$client.prepare('select state from jobs').get()).toEqual({ state: 'succeeded' });
		expect(originals(dataDir)).toEqual([sha256(body)]);
	});

	it('recovers one ready file when a pass stops before the database commit', async () => {
		const { db, dataDir } = await database();
		saveFavorite(db, metadata);
		let now = 10_000;
		const fetchFile = async () => image(body);
		await expect(
			runOriginalPass({
				db,
				dataDir,
				now,
				fetchFile,
				afterTempWrite: () => {
					throw new Error('stop');
				}
			})
		).rejects.toThrow('stop');
		expect(
			db.$client.prepare("select count(*) as n from media_objects where state = 'ready'").get()
		).toEqual({ n: 0 });
		expect(db.$client.prepare('select state from jobs').get()).not.toEqual({ state: 'succeeded' });

		now += ORIGINAL_LEASE_MS + 1;
		await runOriginalPass({ db, dataDir, now, fetchFile });
		expect(originals(dataDir)).toEqual([sha256(body)]);
		expect(
			db.$client.prepare("select count(*) as n from media_objects where state = 'ready'").get()
		).toEqual({ n: 1 });
		expect(db.$client.prepare('select state from jobs').get()).toEqual({ state: 'succeeded' });
	});
});
