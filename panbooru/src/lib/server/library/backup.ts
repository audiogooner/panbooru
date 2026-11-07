import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { copyFile as copyFileFs } from 'node:fs/promises';
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
