import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile as copyFileFs, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import Database from 'better-sqlite3';
import type { AppDatabase } from '#lib/server/db/index.ts';
import type { AppServices } from '#lib/server/auth/dispatch.ts';
import { jsonData, jsonError } from '#lib/server/http/json.ts';
import { enterMaintenance, leaveMaintenance } from '#lib/server/library/maintenance.ts';
import { APP_VERSION } from '#lib/server/version.ts';

export type BackupManifest = {
	format: 'panbooru-backup-1';
	schemaVersion: number;
	appVersion: string;
	complete: boolean;
	files: { path: string; sha256: string }[];
};

type BackupSource = {
	db: AppDatabase;
	dataDir: string;
};

type BackupOptions = {
	copyFile?: (from: string, to: string) => Promise<void>;
	duringMaintenance?: () => Promise<void>;
};

function portable(relativePath: string) {
	return relativePath.split(sep).join('/');
}

function schemaVersion(db: AppDatabase) {
	const row = db.$client.prepare('select max(version) as version from schema_migrations').get() as {
		version: number;
	};
	return row.version;
}

async function hashFile(path: string) {
	return createHash('sha256')
		.update(await readFile(path))
		.digest('hex');
}

async function writeManifest(directory: string, manifest: BackupManifest) {
	await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function createBackup(source: BackupSource, options: BackupOptions = {}) {
	const id = randomUUID();
	const directory = join(source.dataDir, 'backups', id);
	await mkdir(join(directory, 'db'), { recursive: true });
	const copyFile =
		options.copyFile ??
		(async (from: string, to: string) => {
			await mkdir(dirname(to), { recursive: true });
			await copyFileFs(from, to);
		});
	let manifest: BackupManifest = {
		format: 'panbooru-backup-1',
		schemaVersion: schemaVersion(source.db),
		appVersion: APP_VERSION,
		complete: false,
		files: []
	};
	await writeManifest(directory, manifest);
	let held = false;
	try {
		enterMaintenance(source.dataDir);
		held = true;
		await options.duringMaintenance?.();
		const snapshotPath = join(directory, 'db', 'panbooru.sqlite');
		await source.db.$client.backup(snapshotPath);
		const originals = source.db.$client
			.prepare(
				`select relative_path as relativePath
				 from media_objects
				 where state = 'ready' and relative_path is not null`
			)
			.all() as { relativePath: string }[];
		const stored = [{ path: 'db/panbooru.sqlite', absolute: snapshotPath }];
		for (const original of originals) {
			if (!original.relativePath || original.relativePath.includes('..')) continue;
			const absolute = join(directory, original.relativePath);
			await copyFile(join(source.dataDir, original.relativePath), absolute);
			stored.push({ path: portable(original.relativePath), absolute });
		}
		manifest = {
			...manifest,
			files: await Promise.all(
				stored.map(async (file) => ({ path: file.path, sha256: await hashFile(file.absolute) }))
			)
		};
		await writeManifest(directory, manifest);
		for (const file of manifest.files) {
			const hashed = await hashFile(join(directory, ...file.path.split('/')));
			if (hashed !== file.sha256) throw new Error('backup hash did not match');
		}
		manifest = { ...manifest, complete: true };
		await writeManifest(directory, manifest);
		return { id, manifest };
	} finally {
		if (held) leaveMaintenance(source.dataDir);
	}
}

export async function restoreBackup(options: { backupDir: string; dataDir: string }) {
	const manifest = JSON.parse(
		await readFile(join(options.backupDir, 'manifest.json'), 'utf8')
	) as BackupManifest;
	if (manifest.format !== 'panbooru-backup-1' || !manifest.complete) {
		throw new Error('backup manifest is incomplete');
	}
	const missing: { path: string; reason: string }[] = [];
	for (const file of manifest.files) {
		const parts = file.path.split('/');
		if (file.path.startsWith('/') || parts.includes('..') || parts.includes('')) {
			throw new Error('backup path is unsafe');
		}
		const source = join(options.backupDir, ...parts);
		if (!existsSync(source)) {
			missing.push({ path: file.path, reason: 'missing' });
			continue;
		}
		const hashed = createHash('sha256')
			.update(await readFile(source))
			.digest('hex');
		if (hashed !== file.sha256) throw new Error('backup hash did not match');
	}
	const databaseFile = manifest.files.find((file) => file.path === 'db/panbooru.sqlite');
	if (!databaseFile || missing.some((file) => file.path === databaseFile.path)) {
		throw new Error('backup database is missing');
	}
	await mkdir(join(options.dataDir, 'db'), { recursive: true });
	const snapshot = new Database(join(options.backupDir, 'db', 'panbooru.sqlite'), {
		readonly: true,
		fileMustExist: true
	});
	try {
		await snapshot.backup(join(options.dataDir, 'db', 'panbooru.sqlite'));
	} finally {
		snapshot.close();
	}
	for (const file of manifest.files) {
		if (!file.path.startsWith('media/') || missing.some((item) => item.path === file.path))
			continue;
		const destination = join(options.dataDir, ...file.path.split('/'));
		await mkdir(dirname(destination), { recursive: true });
		await copyFileFs(join(options.backupDir, ...file.path.split('/')), destination);
	}
	const restored = new Database(join(options.dataDir, 'db', 'panbooru.sqlite'));
	try {
		const rows = restored
			.prepare(
				`select id, relative_path as relativePath
				 from media_objects
				 where state = 'ready'`
			)
			.all() as { id: string; relativePath: string | null }[];
		const markMissing = restored.prepare(`update media_objects set state = 'missing' where id = ?`);
		for (const row of rows) {
			const relative = row.relativePath ? portable(row.relativePath) : '';
			if (relative && existsSync(join(options.dataDir, ...relative.split('/')))) continue;
			markMissing.run(row.id);
			if (relative && !missing.some((item) => item.path === relative)) {
				missing.push({ path: relative, reason: 'missing' });
			}
		}
	} finally {
		restored.close();
	}
	return { missing };
}

export async function handleBackup(
	request: Request,
	url: URL,
	services: AppServices,
	hasSession: boolean
) {
	if (!(request.method === 'POST' && url.pathname === '/api/backups')) return null;
	if (!hasSession) return jsonError('UNAUTHORIZED', 'Session required', 401);
	try {
		const backup = await createBackup(services);
		return jsonData({ id: backup.id, complete: backup.manifest.complete });
	} catch (error) {
		services.log(error instanceof Error ? error.message : 'backup failed');
		return jsonError('BACKUP_FAILED', 'Backup failed', 500);
	}
}
