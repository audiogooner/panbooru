import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { startApp, type RunningApp } from '#lib/server/app.ts';
import { openDatabase } from '#lib/server/db/index.ts';
import { importFileUrl } from '#lib/server/library/import.ts';
import { saveFavorite, type PostMetadata } from '#lib/server/library/save.ts';

const password = 'correct-horse-battery';

function sha256(bytes: Buffer) {
	return createHash('sha256').update(bytes).digest('hex');
}

function walk(directory: string): string[] {
	const found: string[] = [];
	for (const name of readdirSync(directory)) {
		const path = join(directory, name);
		if (statSync(path).isDirectory()) found.push(...walk(path));
		else found.push(path);
	}
	return found.sort();
}

function directoryHash(directory: string) {
	const hash = createHash('sha256');
	for (const path of walk(directory)) {
		hash.update(path.slice(directory.length));
		hash.update(readFileSync(path));
	}
	return hash.digest('hex');
}

describe('archive import', () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		while (cleanups.length) await cleanups.pop()?.();
	});

	async function boot(dataDir?: string) {
		const directory = dataDir ?? (await mkdtemp(join(tmpdir(), 'panbooru-import-')));
		const app = await startApp({
			dataDir: directory,
			secretPath: join(directory, 'secrets', 'master.key')
		});
		let closed = false;
		cleanups.push(async () => {
			if (!closed) await app.close();
			if (!dataDir) await rm(directory, { recursive: true, force: true });
		});
		const close = async () => {
			if (closed) return;
			closed = true;
			await app.close();
		};
		const token = (await readFile(join(directory, 'bootstrap.token'), 'utf8')).trim();
		const setup = await app.fetch('/api/setup/owner', {
			method: 'POST',
			headers: { origin: app.origin, 'content-type': 'application/json' },
			body: JSON.stringify({ token, password })
		});
		expect(setup.status).toBe(200);
		return {
			app,
			dataDir: directory,
			close,
			cookie: (setup.headers.get('set-cookie') ?? '').split(';')[0]
		};
	}

	it('reports a dry-run conflict and missing bytes, and rejects traversal', async () => {
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-import-'));
		cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
		const db = openDatabase(dataDir);
		const existing: PostMetadata = {
			source: 'gelbooru',
			remoteId: '10',
			tags: ['other'],
			width: 100,
			height: 50,
			fileUrl: importFileUrl('gelbooru', '10')
		};
		saveFavorite(db, existing, 1);
		db.$client.close();
		const { app, cookie } = await boot(dataDir);
		const hash = sha256(Buffer.from('sunset-bytes'));
		const manifest = {
			format: 'panbooru-archive-1',
			items: [
				{
					source: 'gelbooru',
					remoteId: '10',
					tags: ['landscape', 'sunset'],
					rating: 'general',
					width: 100,
					height: 50,
					byteSize: 12,
					savedAt: 1_000,
					favorite: true,
					albums: ['Dusk'],
					originalSha256: hash
				},
				{
					source: 'gelbooru',
					remoteId: '11',
					tags: ['forest'],
					rating: 'general',
					width: 20,
					height: 10,
					byteSize: 0,
					savedAt: 1_000,
					favorite: false,
					albums: [],
					originalSha256: null
				}
			],
			files: [{ path: `files/${hash}`, sha256: hash }]
		};
		const dry = await app.fetch('/api/imports', {
			method: 'POST',
			headers: { origin: app.origin, cookie, 'content-type': 'application/json' },
			body: JSON.stringify({ dryRun: true, manifest })
		});
		expect(dry.status).toBe(200);
		const report = (await dry.json()) as {
			data: {
				conflicts: { remoteId: string }[];
				missing: { remoteId: string }[];
			};
		};
		expect(report.data.conflicts.map((item) => item.remoteId)).toEqual(['10']);
		expect(report.data.missing.map((item) => item.remoteId)).toEqual(['11']);

		const traversal = await app.fetch('/api/imports', {
			method: 'POST',
			headers: { origin: app.origin, cookie, 'content-type': 'application/json' },
			body: JSON.stringify({
				dryRun: true,
				manifest: {
					...manifest,
					files: [{ path: '../secrets/master.key', sha256: hash }]
				}
			})
		});
		expect(traversal.status).toBe(400);
	});

	it('resumes an upload in a new process and does not duplicate or touch the source', async () => {
		const source = await mkdtemp(join(tmpdir(), 'panbooru-archive-'));
		cleanups.push(() => rm(source, { recursive: true, force: true }));
		const bytes = Buffer.from('sunset-bytes');
		const hash = sha256(bytes);
		const manifest = {
			format: 'panbooru-archive-1',
			items: [
				{
					source: 'gelbooru',
					remoteId: '10',
					tags: ['landscape', 'sunset'],
					rating: 'general',
					width: 100,
					height: 50,
					byteSize: bytes.length,
					savedAt: 1_700_000_000_000,
					favorite: true,
					albums: ['Dusk'],
					originalSha256: hash
				},
				{
					source: 'gelbooru',
					remoteId: '11',
					tags: ['forest'],
					rating: 'general',
					width: 20,
					height: 10,
					byteSize: 0,
					savedAt: 1_700_000_000_000,
					favorite: false,
					albums: [],
					originalSha256: null
				}
			],
			files: [{ path: `files/${hash}`, sha256: hash }]
		};
		mkdirSync(join(source, 'files'));
		writeFileSync(join(source, 'manifest.json'), JSON.stringify(manifest));
		writeFileSync(join(source, 'files', hash), bytes);
		const before = directoryHash(source);

		const first = await boot();
		const created = await postImport(first.app, first.cookie, manifest);
		expect(created.status).toBe(200);
		const id = ((await created.json()) as { data: { id: string } }).data.id;
		const partial = await first.app.fetch(`/api/imports/${id}/files/${hash}`, {
			method: 'PUT',
			headers: {
				origin: first.app.origin,
				cookie: first.cookie,
				'content-type': 'application/octet-stream',
				'content-range': `bytes 0-5/${bytes.length}`
			},
			body: bytes.subarray(0, 6)
		});
		expect(partial.status).toBe(200);
		await first.close();

		const second = await startApp({
			dataDir: first.dataDir,
			secretPath: join(first.dataDir, 'secrets', 'master.key')
		});
		cleanups.push(async () => {
			await second.close();
			await rm(first.dataDir, { recursive: true, force: true });
		});
		const progress = await second.fetch(`/api/imports/${id}`, {
			headers: { cookie: first.cookie }
		});
		expect(progress.status).toBe(200);
		const progressBody = (await progress.json()) as {
			data: { files: { sha256: string; received: number; complete: boolean }[] };
		};
		expect(progressBody.data.files[0]).toMatchObject({
			sha256: hash,
			received: 6,
			complete: false
		});
		const rest = await second.fetch(`/api/imports/${id}/files/${hash}`, {
			method: 'PUT',
			headers: {
				origin: second.origin,
				cookie: first.cookie,
				'content-type': 'application/octet-stream',
				'content-range': `bytes 6-${bytes.length - 1}/${bytes.length}`
			},
			body: bytes.subarray(6)
		});
		expect(rest.status).toBe(200);
		const committed = await second.fetch(`/api/imports/${id}/commit`, {
			method: 'POST',
			headers: { origin: second.origin, cookie: first.cookie }
		});
		expect(committed.status).toBe(200);
		const report = (await committed.json()) as {
			data: { missing: { remoteId: string }[] };
		};
		expect(report.data.missing.map((item) => item.remoteId)).toEqual(['11']);
		expect(counts(first.dataDir)).toEqual({ favorites: 1, albums: 1, originals: 1 });
		expect(readFileSync(join(first.dataDir, 'media', 'originals', hash))).toEqual(bytes);
		const savedDb = openReadonly(first.dataDir);
		const savedAt = savedDb.prepare('select saved_at from saved_items').get() as {
			saved_at: number;
		};
		savedDb.close();
		expect(savedAt.saved_at).toBe(1_700_000_000_000);

		const again = await postImport(second, first.cookie, manifest);
		const againId = ((await again.json()) as { data: { id: string } }).data.id;
		expect(
			(
				await second.fetch(`/api/imports/${againId}/files/${hash}`, {
					method: 'PUT',
					headers: {
						origin: second.origin,
						cookie: first.cookie,
						'content-type': 'application/octet-stream'
					},
					body: bytes
				})
			).status
		).toBe(200);
		expect(
			(
				await second.fetch(`/api/imports/${againId}/commit`, {
					method: 'POST',
					headers: { origin: second.origin, cookie: first.cookie }
				})
			).status
		).toBe(200);
		expect(counts(first.dataDir)).toEqual({ favorites: 1, albums: 1, originals: 1 });
		expect(directoryHash(source)).toBe(before);
	});
});

function counts(dataDir: string) {
	const db = openReadonly(dataDir);
	const count = (table: string) =>
		(db.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
	const result = {
		favorites: count('favorites'),
		albums: count('albums'),
		originals: (
			db.prepare("select count(*) as n from media_objects where state = 'ready'").get() as {
				n: number;
			}
		).n
	};
	db.close();
	return result;
}

function openReadonly(dataDir: string) {
	return new Database(join(dataDir, 'db', 'panbooru.sqlite'), { readonly: true });
}

function postImport(app: RunningApp, cookie: string, manifest: unknown) {
	return app.fetch('/api/imports', {
		method: 'POST',
		headers: { origin: app.origin, cookie, 'content-type': 'application/json' },
		body: JSON.stringify({ manifest })
	});
}
