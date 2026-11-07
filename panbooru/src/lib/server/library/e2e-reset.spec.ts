import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dispatch, type AppServices } from '#lib/server/auth/dispatch.ts';
import { openDatabase, type AppDatabase } from '#lib/server/db/index.ts';
import { owner, sessions, sourceCredentials } from '#lib/server/db/schema.ts';
import { createSavedSearch } from '#lib/server/library/collections.ts';
import { e2eLibraryReset } from '#lib/server/library/e2e-reset.ts';
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
	fileUrl: 'https://cdn.fixture.test/images/a.jpg'
};

describe('e2e library reset', () => {
	const directories: string[] = [];
	const databases: AppDatabase[] = [];
	const previousToken = process.env.PANBOORU_E2E_RESET;

	afterEach(async () => {
		if (previousToken === undefined) delete process.env.PANBOORU_E2E_RESET;
		else process.env.PANBOORU_E2E_RESET = previousToken;
		while (databases.length) databases.pop()?.$client.close();
		while (directories.length) {
			const directory = directories.pop();
			if (directory) await rm(directory, { recursive: true, force: true });
		}
	});

	async function database() {
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-e2e-reset-'));
		directories.push(dataDir);
		const db = openDatabase(dataDir);
		databases.push(db);
		return db;
	}

	function count(db: AppDatabase, table: string) {
		return (db.$client.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
	}

	function seed(db: AppDatabase) {
		db.insert(owner)
			.values({ singleton: 1, passwordHash: 'hash', authVersion: 1, createdAt: 1, updatedAt: 1 })
			.run();
		db.insert(sessions)
			.values({ tokenHash: 'session', absoluteExpiresAt: 9, idleExpiresAt: 9, revoked: 0 })
			.run();
		db.insert(sourceCredentials)
			.values({
				source: 'gelbooru',
				ciphertext: Buffer.from('cipher'),
				nonce: Buffer.from('nonce'),
				authTag: Buffer.from('tag'),
				keyVersion: 1,
				userId: '7',
				validated: 1
			})
			.run();
		const album = createAlbum(db, 'Night', 1_000);
		saveFavorite(db, sunset, 1_000);
		saveAlbumMembership(db, sunset, album.id, 1_000);
		const saved = createSavedSearch(
			db,
			{
				name: 'Night search',
				type: 'search',
				applied: {
					query: 'sunset',
					rating: ['General', 'Sensitive', 'Questionable', 'Explicit'],
					media: ['Images', 'Animated images', 'Videos'],
					sort: 'Newest'
				}
			},
			1_000
		);
		expect(saved.ok).toBe(true);
	}

	it('clears albums, favorites, and saved searches while keeping the owner fixture', async () => {
		const db = await database();
		seed(db);
		expect(count(db, 'albums')).toBe(1);
		expect(count(db, 'favorites')).toBe(1);
		expect(count(db, 'saved_searches')).toBe(1);

		delete process.env.PANBOORU_E2E_RESET;
		const closed = e2eLibraryReset(
			new Request('http://127.0.0.1/api/e2e/reset-library', { method: 'POST' }),
			new URL('http://127.0.0.1/api/e2e/reset-library'),
			db
		);
		expect(closed).toBeNull();
		expect(count(db, 'albums')).toBe(1);

		process.env.PANBOORU_E2E_RESET = 'reset-token';
		const rejected = e2eLibraryReset(
			new Request('http://127.0.0.1/api/e2e/reset-library', {
				method: 'POST',
				headers: { 'x-panbooru-e2e-reset': 'wrong' }
			}),
			new URL('http://127.0.0.1/api/e2e/reset-library'),
			db
		);
		expect(rejected?.status).toBe(403);
		expect(count(db, 'albums')).toBe(1);

		const services = { db } as AppServices;
		const accepted = await dispatch(
			new Request('http://127.0.0.1/api/e2e/reset-library', {
				method: 'POST',
				headers: { 'x-panbooru-e2e-reset': 'reset-token' }
			}),
			services
		);
		expect(accepted?.status).toBe(200);
		expect(count(db, 'albums')).toBe(0);
		expect(count(db, 'album_items')).toBe(0);
		expect(count(db, 'favorites')).toBe(0);
		expect(count(db, 'saved_searches')).toBe(0);
		expect(count(db, 'saved_items')).toBe(0);
		expect(count(db, 'owner')).toBe(1);
		expect(count(db, 'sessions')).toBe(1);
		expect(count(db, 'source_credentials')).toBe(1);
	});
});
