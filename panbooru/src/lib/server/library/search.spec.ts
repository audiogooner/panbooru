import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '#lib/server/db/index.ts';
import {
	createAlbum,
	saveAlbumMembership,
	saveFavorite,
	type PostMetadata
} from '#lib/server/library/save.ts';
import {
	searchAlbum,
	searchFavorites,
	suggestAlbum,
	suggestFavorites
} from '#lib/server/library/search.ts';

const base: PostMetadata = {
	source: 'gelbooru',
	remoteId: '10',
	tags: ['sunset'],
	width: 100,
	height: 50,
	fileUrl: 'https://cdn.fixture.test/images/a.jpg'
};

function post(remoteId: string, tags: string[], rating?: string): PostMetadata {
	return {
		...base,
		remoteId,
		tags,
		fileUrl: `https://cdn.fixture.test/images/${remoteId}.jpg`,
		...(rating ? { rating } : {})
	};
}

describe('scoped library search', () => {
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
		const directory = await mkdtemp(join(tmpdir(), 'panbooru-search-'));
		directories.push(directory);
		const db = openDatabase(directory);
		databases.push(db);
		return db;
	}

	it('searches favorites without returning an album-only post', async () => {
		const db = await database();
		const favorite = saveFavorite(db, post('1', ['sunset'], 'general'));
		const album = createAlbum(db, 'Night');
		saveAlbumMembership(db, post('2', ['sunset'], 'general'), album.id);
		const result = searchFavorites(db, 'sunset', []);
		expect(result.posts.map((item) => item.id)).toEqual([favorite.itemId]);
		expect(result.explanation).toBeUndefined();
	});

	it('searches one album without returning a favorite outside it', async () => {
		const db = await database();
		saveFavorite(db, post('1', ['sunset'], 'general'));
		const album = createAlbum(db, 'Night');
		const member = saveAlbumMembership(db, post('2', ['sunset'], 'sensitive'), album.id);
		const result = searchAlbum(db, album.id, 'sunset', []);
		expect(result.posts.map((item) => item.id)).toEqual([member.itemId]);
		expect(result.explanation).toBeUndefined();
	});

	it('keeps a post saved without a rating until the selection is narrowed', async () => {
		const db = await database();
		saveFavorite(db, post('1', ['sunset']));
		expect(searchFavorites(db, 'sunset', []).posts).toHaveLength(1);
		expect(
			searchFavorites(db, 'sunset', ['general', 'sensitive', 'questionable', 'explicit']).posts
		).toHaveLength(1);
		expect(searchFavorites(db, 'sunset', ['explicit']).posts).toHaveLength(0);
	});

	it('does not read or write a network client', async () => {
		const db = await database();
		saveFavorite(db, post('1', ['sunset'], 'general'));
		const calls: string[] = [];
		const original = globalThis.fetch;
		globalThis.fetch = (async (input: unknown) => {
			calls.push(String(input));
			return new Response('', { status: 500 });
		}) as typeof fetch;
		try {
			expect(searchFavorites(db, 'sunset', ['general']).posts).toHaveLength(1);
			expect(searchAlbum(db, 'missing-album', 'sunset', []).posts).toEqual([]);
			expect(calls).toEqual([]);
		} finally {
			globalThis.fetch = original;
		}
	});

	it('suggests a favorite tag and omits a tag that is only on an album post', async () => {
		const db = await database();
		saveFavorite(db, post('1', ['sunset'], 'general'));
		const album = createAlbum(db, 'Night');
		saveAlbumMembership(db, post('2', ['forest'], 'general'), album.id);
		const suggestions = suggestFavorites(db, 'sun');
		expect(suggestions).toContainEqual({ name: 'sunset', count: 1 });
		expect(suggestions.map((item) => item.name)).not.toContain('forest');
	});

	it('suggests an album tag and omits a tag that is only on a favorite', async () => {
		const db = await database();
		saveFavorite(db, post('1', ['sunset'], 'general'));
		const album = createAlbum(db, 'Night');
		saveAlbumMembership(db, post('2', ['forest'], 'general'), album.id);
		const suggestions = suggestAlbum(db, album.id, 'for');
		expect(suggestions).toContainEqual({ name: 'forest', count: 1 });
		expect(suggestions.map((item) => item.name)).not.toContain('sunset');
	});

	it('counts the posts in that scope that have the tag', async () => {
		const db = await database();
		saveFavorite(db, post('1', ['sunset', 'sky'], 'general'));
		saveFavorite(db, post('2', ['sunset'], 'sensitive'));
		saveFavorite(db, post('3', ['sunbeam'], 'explicit'));
		const suggestions = suggestFavorites(db, 'sun');
		expect(suggestions).toContainEqual({ name: 'sunset', count: 2 });
		expect(suggestions).toContainEqual({ name: 'sunbeam', count: 1 });
		expect(suggestions.find((item) => item.name === 'sky')).toBeUndefined();
	});

	it('does not call the Gelbooru tag endpoint for suggestions', async () => {
		const db = await database();
		saveFavorite(db, post('1', ['sunset'], 'general'));
		const calls: string[] = [];
		const original = globalThis.fetch;
		globalThis.fetch = (async (input: unknown) => {
			calls.push(String(input));
			return new Response('', { status: 500 });
		}) as typeof fetch;
		try {
			expect(suggestFavorites(db, 'sun')).toContainEqual({ name: 'sunset', count: 1 });
			const album = createAlbum(db, 'Night');
			saveAlbumMembership(db, post('2', ['forest'], 'general'), album.id);
			expect(suggestAlbum(db, album.id, 'for')).toContainEqual({ name: 'forest', count: 1 });
			expect(calls).toEqual([]);
		} finally {
			globalThis.fetch = original;
		}
	});
});
