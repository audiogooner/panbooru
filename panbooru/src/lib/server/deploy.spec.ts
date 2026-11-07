import { chmodSync, mkdirSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { startApp, type RunningApp } from '#lib/server/app.ts';
import { SCHEMA_VERSION, openDatabase } from '#lib/server/db/index.ts';
import { saveFavorite, type PostMetadata } from '#lib/server/library/save.ts';
import {
	ORIGINAL_LEASE_MS,
	listenForShutdown,
	reconcileOriginals,
	resetJobClaimsForTests,
	runOriginalPass,
	stopJobClaims
} from '#lib/server/library/worker.ts';

const password = 'correct-horse-battery';

const sunset: PostMetadata = {
	source: 'gelbooru',
	remoteId: '10',
	tags: ['landscape', 'sunset'],
	width: 100,
	height: 50,
	fileUrl: 'https://cdn.fixture.test/images/a.jpg'
};

describe('deployment gates', () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		resetJobClaimsForTests();
		while (cleanups.length) await cleanups.pop()?.();
	});

	it('keeps public health free of paths and secrets', async () => {
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-deploy-'));
		const secretPath = join(dataDir, 'secrets', 'master.key');
		const app = await startApp({ dataDir, secretPath });
		cleanups.push(async () => {
			await app.close();
			await rm(dataDir, { recursive: true, force: true });
		});
		const body = await (await app.fetch('/health')).text();
		expect(body).not.toContain(dataDir);
		expect(body).not.toContain(secretPath);
		expect(body).not.toContain('master.key');
	});

	it('reports database, key, and storage readiness without locations', async () => {
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-ready-'));
		const secretPath = join(dataDir, 'secrets', 'master.key');
		const app = await startApp({ dataDir, secretPath });
		cleanups.push(async () => {
			await app.close();
			await rm(dataDir, { recursive: true, force: true });
		});
		expect((await app.fetch('/api/ready')).status).toBe(401);
		const cookie = await ownerCookie(app, dataDir);
		const response = await app.fetch('/api/ready', { headers: { cookie } });
		expect(response.status).toBe(200);
		const text = await response.text();
		const body = JSON.parse(text) as {
			data: { database: string; key: string; storage: string };
		};
		expect(body.data).toEqual({ database: 'ok', key: 'ok', storage: 'ok' });
		expect(text).not.toContain(dataDir);
		expect(text).not.toContain(secretPath);
		expect(text).not.toContain('master.key');
	});

	it('refuses to start when the schema is newer than this build', async () => {
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-schema-'));
		cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
		const db = openDatabase(dataDir);
		expect(SCHEMA_VERSION).toBeGreaterThan(0);
		db.$client.close();
		const sqlite = new Database(join(dataDir, 'db', 'panbooru.sqlite'));
		sqlite
			.prepare('insert into schema_migrations (version, applied_at, checksum) values (99, ?, ?)')
			.run(Date.now(), 'future');
		sqlite.close();
		expect(() => openDatabase(dataDir)).toThrow(/newer than this build/);
		await expect(
			startApp({ dataDir, secretPath: join(dataDir, 'secrets', 'master.key') })
		).rejects.toThrow(/newer than this build/);
	});

	it('never marks an original ready when the disk rejects the write', async () => {
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-disk-'));
		cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
		const db = openDatabase(dataDir);
		saveFavorite(db, sunset);
		const tempDir = join(dataDir, 'tmp');
		mkdirSync(tempDir, { recursive: true });
		chmodSync(tempDir, 0o500);
		try {
			await runOriginalPass({
				db,
				dataDir,
				now: 1_000,
				fetchFile: async () =>
					new Response(Buffer.from('jpeg-bytes'), {
						status: 200,
						headers: { 'content-type': 'image/jpeg', 'content-length': '10' }
					})
			});
		} finally {
			chmodSync(tempDir, 0o700);
		}
		expect(
			db.$client.prepare("select count(*) as n from media_objects where state = 'ready'").get()
		).toEqual({
			n: 0
		});
		db.$client.close();
	});

	it('stops new job claims on SIGTERM and leaves the in-flight job recoverable', async () => {
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-stop-'));
		cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
		const db = openDatabase(dataDir);
		saveFavorite(db, sunset, 1);
		saveFavorite(db, { ...sunset, remoteId: '11', tags: ['forest'] }, 2);
		listenForShutdown();
		let release = () => {};
		const hung = new Promise<void>((resolve) => {
			release = resolve;
		});
		let started: () => void = () => {};
		const claimed = new Promise<void>((resolve) => {
			started = resolve;
		});
		const bodies = [Buffer.from('one-original'), Buffer.from('two-original')];
		let fetches = 0;
		const pass = runOriginalPass({
			db,
			dataDir,
			now: 5_000,
			fetchFile: async () => {
				fetches += 1;
				if (fetches === 1) {
					started();
					await hung;
				}
				const body = bodies[fetches - 1] ?? bodies[0]!;
				return new Response(body, {
					status: 200,
					headers: { 'content-type': 'image/jpeg', 'content-length': String(body.length) }
				});
			}
		});
		await claimed;
		const handler = process.listeners('SIGTERM').find((listener) => listener.name === 'onShutdown');
		expect(handler).toBeTypeOf('function');
		handler?.();
		expect(stopJobClaims).toBeTypeOf('function');
		release();
		await pass;
		const states = db.$client.prepare('select state from jobs').all() as { state: string }[];
		expect(states.filter((row) => row.state === 'succeeded')).toEqual([]);
		expect(states.filter((row) => row.state === 'leased')).toHaveLength(1);
		expect(states.filter((row) => row.state === 'queued')).toHaveLength(1);
		reconcileOriginals(db, dataDir, 5_000 + ORIGINAL_LEASE_MS + 1);
		expect(db.$client.prepare("select state from jobs where state = 'leased'").all()).toEqual([]);
		resetJobClaimsForTests();
		await runOriginalPass({
			db,
			dataDir,
			now: 5_000 + ORIGINAL_LEASE_MS + 2,
			fetchFile: async () => {
				fetches += 1;
				const body = bodies[Math.min(fetches - 1, bodies.length - 1)] ?? bodies[0]!;
				return new Response(body, {
					status: 200,
					headers: { 'content-type': 'image/jpeg', 'content-length': String(body.length) }
				});
			}
		});
		expect(
			db.$client.prepare("select count(*) as n from jobs where state = 'succeeded'").get()
		).toEqual({
			n: 2
		});
		db.$client.close();
	});
});

async function ownerCookie(app: RunningApp, dataDir: string) {
	const token = (await readFile(join(dataDir, 'bootstrap.token'), 'utf8')).trim();
	const setup = await app.fetch('/api/setup/owner', {
		method: 'POST',
		headers: { origin: app.origin, 'content-type': 'application/json' },
		body: JSON.stringify({ token, password })
	});
	return (setup.headers.get('set-cookie') ?? '').split(';')[0];
}
