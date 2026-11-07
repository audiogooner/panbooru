import { createHash, randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '#lib/server/db/index.ts';
import {
	albumItems,
	albums,
	favorites,
	jobs,
	mediaObjects,
	postSnapshots,
	savedItems
} from '#lib/server/db/schema.ts';
import { removeAlbumMembership, unfavorite, type SavedPost } from '#lib/server/library/retention.ts';

export type PostMetadata = {
	source: string;
	remoteId: string;
	tags: string[];
	width: number;
	height: number;
	fileUrl: string;
	rating?: string;
};

export type SaveResult = {
	itemId: string;
	membership: 'favorite' | 'album';
	original: 'queued' | 'ready';
};

const hashVersion = 1;

type Writer = Pick<AppDatabase, 'select' | 'insert'>;

export function canonicalFileUrl(fileUrl: string) {
	const url = new URL(fileUrl);
	url.search = '';
	url.hash = '';
	url.username = '';
	url.password = '';
	return url.toString();
}

export function metadataHash(metadata: PostMetadata) {
	const canonical = [
		metadata.source,
		metadata.remoteId,
		[...metadata.tags].sort(),
		metadata.width,
		metadata.height,
		canonicalFileUrl(metadata.fileUrl)
	];
	return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function snapshotOf(metadata: PostMetadata) {
	return JSON.stringify({
		source: metadata.source,
		remoteId: metadata.remoteId,
		tags: [...metadata.tags].sort(),
		width: metadata.width,
		height: metadata.height,
		fileUrl: canonicalFileUrl(metadata.fileUrl),
		...(metadata.rating ? { rating: metadata.rating } : {})
	});
}

function ensureItem(tx: Writer, metadata: PostMetadata, now: number) {
	const hash = metadataHash(metadata);
	const existing = tx.select().from(savedItems).where(eq(savedItems.metadataHash, hash)).get();
	if (existing) return existing;
	const id = randomUUID();
	const snapshotId = randomUUID();
	tx.insert(savedItems)
		.values({
			id,
			metadataHash: hash,
			hashVersion,
			savedAt: now,
			snapshotId,
			source: metadata.source,
			remoteId: metadata.remoteId,
			mediaId: null,
			retentionState: 'retained'
		})
		.run();
	tx.insert(postSnapshots)
		.values({
			id: snapshotId,
			itemId: id,
			snapshot: snapshotOf(metadata),
			source: metadata.source,
			remoteId: metadata.remoteId,
			fetchedAt: now
		})
		.run();
	const created = tx.select().from(savedItems).where(eq(savedItems.id, id)).get();
	if (!created) throw new Error('saved item was not stored');
	return created;
}

function ensureOriginalJob(tx: Writer, itemId: string, fileUrl: string) {
	const dedupKey = `original:${itemId}`;
	const existing = tx.select().from(jobs).where(eq(jobs.dedupKey, dedupKey)).get();
	if (existing) return existing;
	tx.insert(jobs)
		.values({
			id: randomUUID(),
			kind: 'original',
			itemId,
			dedupKey,
			state: 'queued',
			attempts: 0,
			nextAttemptAt: null,
			leaseUntil: null,
			progress: 0,
			error: null,
			fileUrl: canonicalFileUrl(fileUrl),
			expectedHash: null
		})
		.run();
}

function originalState(tx: Writer, mediaId: string | null): 'queued' | 'ready' {
	if (!mediaId) return 'queued';
	const media = tx.select().from(mediaObjects).where(eq(mediaObjects.id, mediaId)).get();
	return media?.state === 'ready' ? 'ready' : 'queued';
}

export type FavoritePost = {
	id: string;
	tags: string;
	src: string;
	width: number;
	height: number;
};

function viewOf(row: { id: string; snapshot: string }): FavoritePost {
	const snapshot = JSON.parse(row.snapshot) as {
		tags?: unknown;
		width?: unknown;
		height?: unknown;
	};
	const tags = Array.isArray(snapshot.tags)
		? snapshot.tags.filter((tag): tag is string => typeof tag === 'string')
		: [];
	return {
		id: row.id,
		tags: tags.join(' '),
		src: `/api/library/originals/${row.id}`,
		width: Number(snapshot.width ?? 0),
		height: Number(snapshot.height ?? 0)
	};
}

export function listFavorites(db: AppDatabase): FavoritePost[] {
	const rows = db.$client
		.prepare(
			`select saved_items.id as id, post_snapshots.snapshot as snapshot
			 from favorites
			 join saved_items on saved_items.id = favorites.item_id
			 join post_snapshots on post_snapshots.id = saved_items.snapshot_id
			 order by favorites.favorited_at, saved_items.id`
		)
		.all() as { id: string; snapshot: string }[];
	return rows.map(viewOf);
}

export function createAlbum(db: AppDatabase, name: string, now = Date.now()) {
	const id = randomUUID();
	db.insert(albums).values({ id, name, createdAt: now }).run();
	return { id, name };
}

export function listAlbums(db: AppDatabase) {
	return db.$client
		.prepare('select id, name from albums order by created_at, id')
		.all() as { id: string; name: string }[];
}

export function getAlbum(db: AppDatabase, id: string) {
	return db.$client.prepare('select id, name from albums where id = ?').get(id) as
		| { id: string; name: string }
		| undefined;
}

export function listAlbumPosts(db: AppDatabase, albumId: string): FavoritePost[] {
	const rows = db.$client
		.prepare(
			`select saved_items.id as id, post_snapshots.snapshot as snapshot
			 from album_items
			 join saved_items on saved_items.id = album_items.item_id
			 join post_snapshots on post_snapshots.id = saved_items.snapshot_id
			 where album_items.album_id = ?
			 order by album_items.added_at, saved_items.id`
		)
		.all(albumId) as { id: string; snapshot: string }[];
	return rows.map(viewOf);
}

export function saveFavorite(db: AppDatabase, metadata: PostMetadata, now = Date.now()): SaveResult {
	return db.transaction((tx) => {
		const item = ensureItem(tx, metadata, now);
		tx.insert(favorites)
			.values({ itemId: item.id, favoritedAt: now })
			.onConflictDoNothing()
			.run();
		ensureOriginalJob(tx, item.id, metadata.fileUrl);
		return {
			itemId: item.id,
			membership: 'favorite' as const,
			original: originalState(tx, item.mediaId)
		};
	});
}

export function saveAlbumMembership(
	db: AppDatabase,
	metadata: PostMetadata,
	albumId: string,
	now = Date.now()
): SaveResult {
	return db.transaction((tx) => {
		const item = ensureItem(tx, metadata, now);
		tx.insert(albumItems)
			.values({ albumId, itemId: item.id, addedAt: now })
			.onConflictDoNothing()
			.run();
		ensureOriginalJob(tx, item.id, metadata.fileUrl);
		return {
			itemId: item.id,
			membership: 'album' as const,
			original: originalState(tx, item.mediaId)
		};
	});
}

function membership(db: AppDatabase, itemId: string): (SavedPost & { mediaId: string | null }) | null {
	const item = db.select().from(savedItems).where(eq(savedItems.id, itemId)).get();
	if (!item) return null;
	const favorite = db.select().from(favorites).where(eq(favorites.itemId, itemId)).get();
	const rows = db.select().from(albumItems).where(eq(albumItems.itemId, itemId)).all();
	return {
		id: item.id,
		favorite: Boolean(favorite),
		albumIds: rows.map((row) => row.albumId),
		originalId: item.mediaId ?? '',
		mediaId: item.mediaId
	};
}

function unreferencedPath(db: AppDatabase, mediaId: string | null) {
	if (!mediaId) return null;
	const used = db.$client.prepare('select id from saved_items where media_id = ?').get(mediaId);
	if (used) return null;
	const media = db.$client
		.prepare('select relative_path as relativePath from media_objects where id = ?')
		.get(mediaId) as { relativePath: string | null } | undefined;
	db.$client.prepare('delete from media_objects where id = ?').run(mediaId);
	const path = media?.relativePath ?? '';
	if (!path || path.startsWith('/') || path.includes('..')) return null;
	return path;
}

function purgeItem(db: AppDatabase, itemId: string, mediaId: string | null) {
	db.$client.prepare('delete from jobs where item_id = ?').run(itemId);
	db.$client.prepare('delete from album_items where item_id = ?').run(itemId);
	db.$client.prepare('delete from favorites where item_id = ?').run(itemId);
	db.$client.prepare('delete from post_snapshots where item_id = ?').run(itemId);
	db.$client.prepare('update saved_items set media_id = null where id = ?').run(itemId);
	db.$client.prepare('delete from saved_items where id = ?').run(itemId);
	return unreferencedPath(db, mediaId);
}

function unlinkOriginal(dataDir: string, relativePath: string | null) {
	if (!relativePath) return;
	try {
		unlinkSync(join(dataDir, relativePath));
	} catch {
		/* the file is already gone */
	}
}

export function removeFavoriteMembership(db: AppDatabase, dataDir: string, itemId: string) {
	const current = membership(db, itemId);
	if (!current?.favorite) return false;
	const decision = unfavorite(current);
	const relativePath = db.$client.transaction(() => {
		db.$client.prepare('delete from favorites where item_id = ?').run(itemId);
		if (decision.post) return null;
		return purgeItem(db, itemId, current.mediaId);
	})();
	unlinkOriginal(dataDir, relativePath);
	return true;
}

export function removeAlbumMembershipRow(
	db: AppDatabase,
	dataDir: string,
	albumId: string,
	itemId: string
) {
	const current = membership(db, itemId);
	if (!current?.albumIds.includes(albumId)) return false;
	const decision = removeAlbumMembership(current, albumId);
	const relativePath = db.$client.transaction(() => {
		db.$client
			.prepare('delete from album_items where album_id = ? and item_id = ?')
			.run(albumId, itemId);
		if (decision.post) return null;
		return purgeItem(db, itemId, current.mediaId);
	})();
	unlinkOriginal(dataDir, relativePath);
	return true;
}
