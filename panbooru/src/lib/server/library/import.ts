import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppDatabase } from '#lib/server/db/index.ts';
import type { AppServices } from '#lib/server/auth/dispatch.ts';
import { jsonData, jsonError } from '#lib/server/http/json.ts';
import { promoteOriginal } from '#lib/server/library/original.ts';
import {
	createAlbum,
	metadataHash,
	saveAlbumMembership,
	saveFavorite,
	type PostMetadata
} from '#lib/server/library/save.ts';

const shaPattern = /^[a-f0-9]{64}$/;

type ArchiveItem = {
	source: string;
	remoteId: string;
	tags: string[];
	rating: string;
	width: number;
	height: number;
	byteSize: number;
	savedAt: number;
	favorite: boolean;
	albums: string[];
	originalSha256: string | null;
};

type ArchiveFile = { path: string; sha256: string };

type ArchiveManifest = {
	format: 'panbooru-archive-1';
	items: ArchiveItem[];
	files: ArchiveFile[];
};

type PartialMeta = { received: number; total: number | null };

export function importFileUrl(source: string, remoteId: string) {
	return `https://import.panbooru.invalid/${encodeURIComponent(source)}/${encodeURIComponent(remoteId)}`;
}

function metadataOf(item: ArchiveItem): PostMetadata {
	return {
		source: item.source,
		remoteId: item.remoteId,
		tags: item.tags,
		width: item.width,
		height: item.height,
		fileUrl: importFileUrl(item.source, item.remoteId),
		...(item.rating ? { rating: item.rating } : {})
	};
}

function isItem(value: unknown): value is ArchiveItem {
	if (!value || typeof value !== 'object') return false;
	const item = value as ArchiveItem;
	return (
		typeof item.source === 'string' &&
		item.source.length > 0 &&
		typeof item.remoteId === 'string' &&
		item.remoteId.length > 0 &&
		Array.isArray(item.tags) &&
		item.tags.every((tag) => typeof tag === 'string') &&
		typeof item.rating === 'string' &&
		typeof item.width === 'number' &&
		typeof item.height === 'number' &&
		typeof item.byteSize === 'number' &&
		typeof item.savedAt === 'number' &&
		typeof item.favorite === 'boolean' &&
		Array.isArray(item.albums) &&
		item.albums.every((name) => typeof name === 'string' && name.trim().length > 0) &&
		(item.originalSha256 === null ||
			(typeof item.originalSha256 === 'string' && shaPattern.test(item.originalSha256)))
	);
}

function parseManifest(value: unknown): ArchiveManifest | null {
	if (!value || typeof value !== 'object') return null;
	if ('credentials' in value || 'sessions' in value) return null;
	const manifest = value as ArchiveManifest;
	if (manifest.format !== 'panbooru-archive-1') return null;
	if (!Array.isArray(manifest.items) || !manifest.items.every(isItem)) return null;
	if (!Array.isArray(manifest.files)) return null;
	for (const file of manifest.files) {
		if (!file || typeof file.path !== 'string' || typeof file.sha256 !== 'string') return null;
		if (file.path.split('/').includes('..') || file.path.startsWith('/')) return null;
		if (file.path !== `files/${file.sha256}` || !shaPattern.test(file.sha256)) return null;
	}
	return manifest;
}

function sessionDir(dataDir: string, id: string) {
	return join(dataDir, 'imports', id);
}

function conflicts(db: AppDatabase, item: ArchiveItem) {
	const hash = metadataHash(metadataOf(item));
	const rows = db.$client
		.prepare(
			'select metadata_hash as metadataHash from saved_items where source = ? and remote_id = ?'
		)
		.all(item.source, item.remoteId) as { metadataHash: string }[];
	return rows.length > 0 && rows.every((row) => row.metadataHash !== hash);
}

function missingBytes(manifest: ArchiveManifest, item: ArchiveItem) {
	if (!item.originalSha256) return true;
	return !manifest.files.some((file) => file.sha256 === item.originalSha256);
}

function report(db: AppDatabase, manifest: ArchiveManifest) {
	return {
		conflicts: manifest.items
			.filter((item) => conflicts(db, item))
			.map((item) => ({
				source: item.source,
				remoteId: item.remoteId
			})),
		missing: manifest.items
			.filter((item) => missingBytes(manifest, item))
			.map((item) => ({
				source: item.source,
				remoteId: item.remoteId,
				sha256: item.originalSha256
			}))
	};
}

async function readManifest(dataDir: string, id: string) {
	return parseManifest(
		JSON.parse(await readFile(join(sessionDir(dataDir, id), 'manifest.json'), 'utf8'))
	);
}

async function readPartial(dataDir: string, id: string, sha: string): Promise<PartialMeta> {
	try {
		return JSON.parse(
			await readFile(join(sessionDir(dataDir, id), 'partial', `${sha}.json`), 'utf8')
		) as PartialMeta;
	} catch {
		return { received: 0, total: null };
	}
}

function ensureAlbum(db: AppDatabase, name: string, now: number) {
	const existing = db.$client.prepare('select id from albums where name = ?').get(name) as
		{ id: string } | undefined;
	if (existing) return existing.id;
	return createAlbum(db, name, now).id;
}

export async function handleImport(
	request: Request,
	url: URL,
	services: AppServices,
	hasSession: boolean
) {
	if (!url.pathname.startsWith('/api/imports')) return null;
	if (!hasSession) return jsonError('UNAUTHORIZED', 'Session required', 401);

	if (request.method === 'POST' && url.pathname === '/api/imports') {
		const body = (await request.json().catch(() => null)) as {
			dryRun?: unknown;
			manifest?: unknown;
		} | null;
		const manifest = parseManifest(body?.manifest);
		if (!manifest) return jsonError('BAD_REQUEST', 'Archive manifest is invalid', 400);
		const preview = report(services.db, manifest);
		if (body?.dryRun === true) return jsonData({ dryRun: true, ...preview });
		const id = randomUUID();
		const directory = sessionDir(services.dataDir, id);
		await mkdir(join(directory, 'partial'), { recursive: true });
		await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
		return jsonData({ id, ...preview });
	}

	const commit = url.pathname.match(/^\/api\/imports\/([^/]+)\/commit$/);
	if (request.method === 'POST' && commit) {
		const id = commit[1] ?? '';
		if (!existsSync(sessionDir(services.dataDir, id))) {
			return jsonError('NOT_FOUND', 'Import was not found', 404);
		}
		const manifest = await readManifest(services.dataDir, id);
		if (!manifest) return jsonError('BAD_REQUEST', 'Archive manifest is invalid', 400);
		const missing: { source: string; remoteId: string }[] = [];
		const conflicted: { source: string; remoteId: string }[] = [];
		for (const item of manifest.items) {
			if (conflicts(services.db, item)) {
				conflicted.push({ source: item.source, remoteId: item.remoteId });
				continue;
			}
			const sha = item.originalSha256;
			const partial = sha ? await readPartial(services.dataDir, id, sha) : null;
			const filePath = sha ? join(sessionDir(services.dataDir, id), 'partial', sha) : '';
			const ready =
				Boolean(sha) &&
				partial?.total !== null &&
				partial?.received === partial?.total &&
				partial.received === item.byteSize &&
				existsSync(filePath);
			if (!ready || !sha) {
				missing.push({ source: item.source, remoteId: item.remoteId });
				continue;
			}
			if (!item.favorite && item.albums.length === 0) {
				missing.push({ source: item.source, remoteId: item.remoteId });
				continue;
			}
			const bytes = await readFile(filePath);
			const hash = createHash('sha256').update(bytes).digest('hex');
			if (hash !== sha) {
				missing.push({ source: item.source, remoteId: item.remoteId });
				continue;
			}
			const metadata = metadataOf(item);
			let itemId: string | null = null;
			if (item.favorite) itemId = saveFavorite(services.db, metadata, item.savedAt).itemId;
			for (const name of item.albums) {
				const albumId = ensureAlbum(services.db, name, item.savedAt);
				itemId = saveAlbumMembership(services.db, metadata, albumId, item.savedAt).itemId;
			}
			if (!itemId) continue;
			promoteOriginal({
				db: services.db,
				dataDir: services.dataDir,
				itemId,
				body: bytes,
				mime: 'application/octet-stream',
				expectedBytes: bytes.length,
				expectedHash: hash
			});
		}
		return jsonData({ missing, conflicts: conflicted });
	}

	const upload = url.pathname.match(/^\/api\/imports\/([^/]+)\/files\/([^/]+)$/);
	if (request.method === 'PUT' && upload) {
		const id = upload[1] ?? '';
		const sha = upload[2] ?? '';
		if (!shaPattern.test(sha) || !existsSync(sessionDir(services.dataDir, id))) {
			return jsonError('BAD_REQUEST', 'Import file is invalid', 400);
		}
		const manifest = await readManifest(services.dataDir, id);
		if (!manifest?.files.some((file) => file.sha256 === sha)) {
			return jsonError('BAD_REQUEST', 'Import file is invalid', 400);
		}
		const body = Buffer.from(await request.arrayBuffer());
		const current = await readPartial(services.dataDir, id, sha);
		const range = request.headers.get('content-range');
		let next: PartialMeta;
		if (!range) {
			if (current.received !== 0) return jsonError('CONFLICT', 'Upload already started', 409);
			next = { received: body.length, total: body.length };
			await writeFile(join(sessionDir(services.dataDir, id), 'partial', sha), body);
		} else {
			const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
			if (!match) return jsonError('BAD_REQUEST', 'Content range is invalid', 400);
			const start = Number(match[1]);
			const end = Number(match[2]);
			const total = Number(match[3]);
			if (start !== current.received || end !== start + body.length - 1 || end >= total) {
				return jsonError('CONFLICT', 'Upload range does not continue', 409);
			}
			await appendFile(join(sessionDir(services.dataDir, id), 'partial', sha), body);
			next = { received: current.received + body.length, total };
		}
		await writeFile(
			join(sessionDir(services.dataDir, id), 'partial', `${sha}.json`),
			JSON.stringify(next)
		);
		if (next.total !== null && next.received === next.total) {
			const stored = await readFile(join(sessionDir(services.dataDir, id), 'partial', sha));
			if (createHash('sha256').update(stored).digest('hex') !== sha) {
				await rm(join(sessionDir(services.dataDir, id), 'partial', sha), { force: true });
				await writeFile(
					join(sessionDir(services.dataDir, id), 'partial', `${sha}.json`),
					JSON.stringify({ received: 0, total: null })
				);
				return jsonError('BAD_REQUEST', 'Uploaded bytes do not match the archive hash', 400);
			}
		}
		return jsonData({
			sha256: sha,
			received: next.received,
			complete: next.total !== null && next.received === next.total
		});
	}

	const status = url.pathname.match(/^\/api\/imports\/([^/]+)$/);
	if (request.method === 'GET' && status) {
		const id = status[1] ?? '';
		if (!existsSync(sessionDir(services.dataDir, id))) {
			return jsonError('NOT_FOUND', 'Import was not found', 404);
		}
		const manifest = await readManifest(services.dataDir, id);
		if (!manifest) return jsonError('BAD_REQUEST', 'Archive manifest is invalid', 400);
		const files = [];
		for (const file of manifest.files) {
			const partial = await readPartial(services.dataDir, id, file.sha256);
			files.push({
				sha256: file.sha256,
				received: partial.received,
				complete: partial.total !== null && partial.received === partial.total
			});
		}
		return jsonData({ id, files });
	}

	return jsonError('NOT_FOUND', 'Not found', 404);
}
