import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { startApp, type RunningApp } from '#lib/server/app.ts';
import { openDatabase, type AppDatabase } from '#lib/server/db/index.ts';
import { createBackup } from '#lib/server/library/backup.ts';
import { promoteOriginal } from '#lib/server/library/original.ts';
import { handleLibrary } from '#lib/server/library/routes.ts';
import {
	createAlbum,
	saveAlbumMembership,
	saveFavorite,
	type PostMetadata
} from '#lib/server/library/save.ts';
import { runOriginalPass } from '#lib/server/library/worker.ts';
import type { AppServices } from '#lib/server/auth/dispatch.ts';

const password = 'correct-horse-battery';
const marker = Buffer.from('derivative-bytes-not-in-backup');
const keyMarker = Buffer.from('MASTER-KEY-SHOULD-NOT-BE-COPIED');

const sunset: PostMetadata = {
	source: 'gelbooru',
	remoteId: '10',
	tags: ['landscape', 'sunset'],
	width: 100,
	height: 50,
	fileUrl: 'https://cdn.fixture.test/images/a.jpg'
};

function sha256(bytes: Buffer) {
	return createHash('sha256').update(bytes).digest('hex');
}

function walk(directory: string): string[] {
	if (!existsSync(directory)) return [];
	const found: string[] = [];
	for (const name of readdirSync(directory)) {
		const path = join(directory, name);
		found.push(path);
		if (statSync(path).isDirectory()) found.push(...walk(path));
	}
	return found;
}

describe('verified backup', () => {
	const directories: string[] = [];
	const databases: AppDatabase[] = [];
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		while (databases.length) databases.pop()?.$client.close();
		while (cleanups.length) await cleanups.pop()?.();
		while (directories.length) {
			const directory = directories.pop();
			if (directory) await rm(directory, { recursive: true, force: true });
		}
	});

	async function database() {
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-backup-'));
		directories.push(dataDir);
		const db = openDatabase(dataDir);
		databases.push(db);
		db.$client.pragma('journal_mode = WAL');
		return { db, dataDir };
	}

	function readyOriginal(db: AppDatabase, dataDir: string, metadata: PostMetadata, body: Buffer) {
		const saved = saveFavorite(db, metadata, 1_000);
		const album = createAlbum(db, 'Dusk', 1_000);
		saveAlbumMembership(db, metadata, album.id, 1_000);
		promoteOriginal({
			db,
			dataDir,
			itemId: saved.itemId,
			body,
			mime: 'image/jpeg',
			expectedBytes: body.length,
			expectedHash: sha256(body)
		});
		return saved;
	}

	it('snapshots the database and ready originals, then verifies the manifest', async () => {
		const { db, dataDir } = await database();
		const body = Buffer.from('sunset-original');
		readyOriginal(db, dataDir, sunset, body);
		mkdirSync(join(dataDir, 'secrets'), { recursive: true });
		writeFileSync(join(dataDir, 'secrets', 'master.key'), keyMarker);
		mkdirSync(join(dataDir, 'media', 'derivatives'), { recursive: true });
		writeFileSync(join(dataDir, 'media', 'derivatives', 'marker.webp'), marker);
		db.$client
			.prepare(
				`insert into derivatives (
					id, source_identity, recipe, width, height, format, relative_path, byte_size
				) values ('d1', 'identity', 'thumb', 10, 10, 'webp', ?, ?)`
			)
			.run(join('media', 'derivatives', 'marker.webp'), marker.length);

		const backup = await createBackup({ db, dataDir });
		expect(backup.manifest).toMatchObject({
			format: 'panbooru-backup-1',
			complete: true,
			schemaVersion: (
				db.$client.prepare('select max(version) as version from schema_migrations').get() as {
					version: number;
				}
			).version
		});
		expect(backup.manifest.appVersion).toBe(
			JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8')).version
		);

		const root = join(dataDir, 'backups', backup.id);
		const names = walk(root).map((path) => path.slice(root.length));
		expect(names.some((path) => path.includes('master.key'))).toBe(false);
		expect(names.some((path) => path.includes('derivatives'))).toBe(false);
		const files = walk(root).filter((path) => statSync(path).isFile());
		expect(files.some((path) => readFileSync(path).includes(marker))).toBe(false);
		expect(files.some((path) => readFileSync(path).includes(keyMarker))).toBe(false);

		const snapshot = new Database(join(root, 'db', 'panbooru.sqlite'), { readonly: true });
		expect(snapshot.prepare('select count(*) as n from favorites').get()).toEqual({ n: 1 });
		expect(snapshot.prepare('select count(*) as n from album_items').get()).toEqual({ n: 1 });
		snapshot.close();

		for (const file of backup.manifest.files) {
			const bytes = readFileSync(join(root, ...file.path.split('/')));
			expect(sha256(bytes)).toBe(file.sha256);
		}
		expect(backup.manifest.files.some((file) => file.path.endsWith(sha256(body)))).toBe(true);
		expect(readFileSync(join(root, 'media', 'originals', sha256(body)))).toEqual(body);
	});

	it('refuses library writes and job finalization while a failed copy stays incomplete', async () => {
		const { db, dataDir } = await database();
		const body = Buffer.from('sunset-original');
		readyOriginal(db, dataDir, sunset, body);
		const queued: PostMetadata = { ...sunset, remoteId: '11', tags: ['forest'] };
		saveFavorite(db, queued, 2_000);

		await expect(
			createBackup(
				{ db, dataDir },
				{
					duringMaintenance: async () => {
						const services = {
							db,
							dataDir,
							now: () => 3_000,
							media: new Map(),
							log: () => {}
						} as AppServices;
						const denied = await handleLibrary(
							new Request('http://127.0.0.1/api/library/favorites', {
								method: 'POST',
								headers: { 'content-type': 'application/json' },
								body: JSON.stringify({
									remoteId: '12',
									tags: ['night'],
									width: 1,
									height: 1,
									mediaRef: 'missing'
								})
							}),
							new URL('http://127.0.0.1/api/library/favorites'),
							services,
							true
						);
						expect(denied?.status).toBe(503);
						await runOriginalPass({
							db,
							dataDir,
							now: 3_000,
							fetchFile: async () =>
								new Response(body, {
									status: 200,
									headers: { 'content-type': 'image/jpeg', 'content-length': String(body.length) }
								})
						});
						expect(
							db.$client.prepare("select state from jobs where item_id != ''").all()
						).not.toEqual(expect.arrayContaining([{ state: 'succeeded' }]));
					},
					copyFile: async () => {
						throw new Error('copy failed');
					}
				}
			)
		).rejects.toThrow('copy failed');

		const backupDir = readdirSync(join(dataDir, 'backups'))[0];
		const manifest = JSON.parse(
			readFileSync(join(dataDir, 'backups', backupDir ?? '', 'manifest.json'), 'utf8')
		) as { complete: boolean };
		expect(manifest.complete).toBe(false);
		const services = {
			db,
			dataDir,
			now: () => 4_000,
			media: new Map(),
			log: () => {}
		} as AppServices;
		const after = await handleLibrary(
			new Request('http://127.0.0.1/api/library/albums', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'Later' })
			}),
			new URL('http://127.0.0.1/api/library/albums'),
			services,
			true
		);
		expect(after?.status).toBe(200);
	});

	it('creates a backup from the owner route', async () => {
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-backup-http-'));
		directories.push(dataDir);
		const app = await startApp({ dataDir, secretPath: join(dataDir, 'secrets', 'master.key') });
		cleanups.push(() => app.close());
		const cookie = await ownerCookie(app, dataDir);
		const created = await app.fetch('/api/backups', {
			method: 'POST',
			headers: { origin: app.origin, cookie }
		});
		expect(created.status).toBe(200);
		const body = (await created.json()) as { data: { id: string; complete: boolean } };
		expect(body.data.complete).toBe(true);
		expect(body.data.id).toEqual(expect.any(String));
		expect(
			JSON.parse(await readFile(join(dataDir, 'backups', body.data.id, 'manifest.json'), 'utf8'))
		).toMatchObject({
			complete: true
		});
		expect((await app.fetch('/api/backups', { method: 'POST' })).status).toBe(401);
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
