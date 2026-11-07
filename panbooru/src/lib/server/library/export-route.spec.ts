import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppServices } from '#lib/server/auth/dispatch.ts';
import { openDatabase, type AppDatabase } from '#lib/server/db/index.ts';
import { promoteOriginal } from '#lib/server/library/original.ts';
import { handleLibrary } from '#lib/server/library/routes.ts';
import {
	createAlbum,
	saveAlbumMembership,
	saveFavorite,
	type PostMetadata
} from '#lib/server/library/save.ts';

const sunset: PostMetadata = {
	source: 'gelbooru',
	remoteId: '10',
	tags: ['sunset'],
	width: 100,
	height: 50,
	fileUrl: 'https://cdn.fixture.test/images/sunset.jpg',
	rating: 'general'
};

const forest: PostMetadata = {
	source: 'gelbooru',
	remoteId: '11',
	tags: ['forest'],
	width: 80,
	height: 40,
	fileUrl: 'https://cdn.fixture.test/images/forest.jpg',
	rating: 'general'
};

describe('library export route', () => {
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
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-export-'));
		directories.push(dataDir);
		const db = openDatabase(dataDir);
		databases.push(db);
		return { db, dataDir };
	}

	function services(
		db: AppDatabase,
		dataDir: string,
		fetchUpstream?: AppServices['fetchUpstream']
	): AppServices {
		return {
			db,
			dataDir,
			now: () => 1_000,
			media: new Map(),
			log: () => {},
			fixtureOrigin: 'https://fixture.test',
			fetchUpstream
		} as unknown as AppServices;
	}

	async function ready(db: AppDatabase, dataDir: string, metadata: PostMetadata, bytes: Buffer) {
		const saved = saveFavorite(db, metadata, 1_000);
		const hash = createHash('sha256').update(bytes).digest('hex');
		const promoted = promoteOriginal({
			db,
			dataDir,
			itemId: saved.itemId,
			body: bytes,
			mime: 'image/jpeg',
			expectedBytes: bytes.length,
			expectedHash: hash
		});
		expect(promoted.ready).toBe(true);
		return saved.itemId;
	}

	async function call(
		db: AppDatabase,
		dataDir: string,
		body: unknown,
		fetchUpstream?: AppServices['fetchUpstream'],
		session = true
	) {
		const url = 'http://127.0.0.1/api/library/exports';
		return handleLibrary(
			new Request(url, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			}),
			new URL(url),
			services(db, dataDir, fetchUpstream),
			session
		);
	}

	it('returns 413 and writes nothing when the selection is over 500 files', async () => {
		const { db, dataDir } = await database();
		const response = await call(
			db,
			dataDir,
			{ itemIds: Array.from({ length: 501 }, (_, index) => `missing-${index}`) }
		);
		expect(response?.status).toBe(413);
		const payload = (await response?.json()) as { code?: string };
		expect(payload.code).toBe('ZIP_TOO_LARGE');
		expect(existsSync(join(dataDir, 'exports'))).toBe(false);
	});

	it('zips ready originals, counts files that are not ready, and names a single download', async () => {
		const { db, dataDir } = await database();
		const readyId = await ready(db, dataDir, sunset, Buffer.from('sunset-bytes'));
		const queued = saveFavorite(db, forest, 1_001);
		const response = await call(db, dataDir, { itemIds: [readyId, queued.itemId] });
		expect(response?.status).toBe(200);
		expect(response?.headers.get('content-type')).toContain('application/zip');
		expect(response?.headers.get('content-disposition')).toContain('attachment; filename="panbooru.zip"');
		expect(response?.headers.get('x-panbooru-export-included')).toBe('1');
		expect(response?.headers.get('x-panbooru-export-omitted')).toBe('1');
		const zip = Buffer.from(await response!.arrayBuffer());
		expect(storedPayload(zip, 'sunset.jpg', Buffer.from('sunset-bytes').length)).toEqual(
			Buffer.from('sunset-bytes')
		);
		expect(zip.includes('forest.jpg')).toBe(false);

		const singleUrl = `http://127.0.0.1/api/library/originals/${encodeURIComponent(readyId)}?download=1`;
		const single = await handleLibrary(
			new Request(singleUrl),
			new URL(singleUrl),
			services(db, dataDir),
			true
		);
		expect(single?.headers.get('content-disposition')).toContain('filename="sunset.jpg"');
	});

	it('exports a whole favorites query with exclusions instead of loaded ids', async () => {
		const { db, dataDir } = await database();
		const sunsetId = await ready(db, dataDir, sunset, Buffer.from('sunset-bytes'));
		await ready(db, dataDir, forest, Buffer.from('forest-bytes'));
		const response = await call(db, dataDir, {
			source: 'favorites',
			query: '',
			excludedIds: [sunsetId]
		});
		expect(response?.status).toBe(200);
		expect(response?.headers.get('x-panbooru-export-included')).toBe('1');
		expect(response?.headers.get('x-panbooru-export-omitted')).toBe('0');
		const zip = Buffer.from(await response!.arrayBuffer());
		expect(storedPayload(zip, 'forest.jpg', Buffer.from('forest-bytes').length)).toEqual(
			Buffer.from('forest-bytes')
		);
		expect(zip.includes('sunset.jpg')).toBe(false);
	});

	it('keeps a whole gelbooru query on the descriptor and omits originals that are not ready', async () => {
		const { db, dataDir } = await database();
		await ready(db, dataDir, sunset, Buffer.from('sunset-bytes'));
		const response = await call(
			db,
			dataDir,
			{ source: 'gelbooru', query: 'sunset', excludedIds: [] },
			async () =>
				new Response(
					JSON.stringify({
						'@attributes': { count: 2 },
						post: [
							{ id: 10, file_url: 'https://cdn.fixture.test/images/sunset.jpg' },
							{ id: 99, file_url: 'https://cdn.fixture.test/images/missing.jpg' }
						]
					}),
					{ headers: { 'content-type': 'application/json' } }
				)
		);
		expect(response?.status).toBe(200);
		expect(response?.headers.get('x-panbooru-export-included')).toBe('1');
		expect(response?.headers.get('x-panbooru-export-omitted')).toBe('1');
		const zip = Buffer.from(await response!.arrayBuffer());
		expect(zip.includes('sunset.jpg')).toBe(true);
		expect(zip.includes('missing.jpg')).toBe(false);
	});

	it('returns 404 when a whole-query album is missing and 401 without a session', async () => {
		const { db, dataDir } = await database();
		const missing = await call(db, dataDir, {
			source: 'album',
			sourceAlbumId: 'missing-album',
			query: ''
		});
		expect(missing?.status).toBe(404);
		const denied = await call(db, dataDir, { itemIds: ['one'] }, undefined, false);
		expect(denied?.status).toBe(401);
		const album = createAlbum(db, 'Landscapes', 1_000);
		const saved = saveAlbumMembership(db, sunset, album.id, 1_000);
		await ready(db, dataDir, sunset, Buffer.from('sunset-bytes'));
		const response = await call(db, dataDir, {
			source: 'album',
			sourceAlbumId: album.id,
			query: 'sunset',
			rating: ['General']
		});
		expect(response?.status).toBe(200);
		expect(response?.headers.get('x-panbooru-export-included')).toBe('1');
		expect(saved.itemId).toBeTruthy();
	});
});

function storedPayload(zip: Buffer, name: string, size: number) {
	const marker = Buffer.from(name);
	const nameAt = zip.indexOf(marker);
	expect(nameAt).toBeGreaterThanOrEqual(30);
	const header = nameAt - 30;
	expect(zip.readUInt32LE(header)).toBe(0x04034b50);
	expect(zip.readUInt16LE(header + 8)).toBe(0);
	expect(zip.readUInt16LE(header + 26)).toBe(marker.length);
	const extra = zip.readUInt16LE(header + 28);
	const dataStart = nameAt + marker.length + extra;
	return zip.subarray(dataStart, dataStart + size);
}
