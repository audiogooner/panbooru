import { createHash, randomUUID } from 'node:crypto';
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
import { refreshAutomaticAlbumCover } from '#lib/server/library/collections.ts';
import {
	expireRemovals,
	recordHold,
	releaseHeldFiles,
	unretainedPaths
} from '#lib/server/library/removal.ts';

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

export type SavedTag = {
	name: string;
	category: string;
};

export type FavoritePost = {
	id: string;
	tags: string;
	tagList: SavedTag[];
	src: string;
	width: number;
	height: number;
	availability: 'ready' | 'queued' | 'unavailable';
};

type SavedRow = { id: string; source: string; snapshot: string };

function tagNames(snapshot: string) {
	const parsed = JSON.parse(snapshot) as { tags?: unknown };
	return Array.isArray(parsed.tags)
		? parsed.tags.filter((tag): tag is string => typeof tag === 'string')
		: [];
}

function tagList(db: AppDatabase, source: string, names: string[]): SavedTag[] {
	const categoryFor = db.$client.prepare(
		'select category from source_tags where source = ? and name = ?'
	);
	return names.map((name) => {
		const row = categoryFor.get(source, name) as { category: string } | undefined;
		return { name, category: row?.category ?? 'unknown' };
	});
}

function availabilityFor(db: AppDatabase, itemId: string): FavoritePost['availability'] {
	const media = db.$client
		.prepare(
			`select media_objects.state as state
			 from saved_items
			 join media_objects on media_objects.id = saved_items.media_id
			 where saved_items.id = ?`
		)
		.get(itemId) as { state: string } | undefined;
	if (media?.state === 'ready') return 'ready';
	const job = db.$client
		.prepare('select state, error from jobs where item_id = ? and kind = ?')
		.get(itemId, 'original') as { state: string; error: string | null } | undefined;
	if (job?.state === 'failed' && job.error === 'unavailable') return 'unavailable';
	return 'queued';
}

export function presentSavedPost(db: AppDatabase, row: SavedRow): FavoritePost {
	const snapshot = JSON.parse(row.snapshot) as {
		tags?: unknown;
		width?: unknown;
		height?: unknown;
	};
	const names = tagNames(row.snapshot);
	return {
		id: row.id,
		tags: names.join(' '),
		tagList: tagList(db, row.source, names),
		src: `/api/library/originals/${row.id}`,
		width: Number(snapshot.width ?? 0),
		height: Number(snapshot.height ?? 0),
		availability: availabilityFor(db, row.id)
	};
}

export function listFavorites(db: AppDatabase): FavoritePost[] {
	const rows = db.$client
		.prepare(
			`select saved_items.id as id, saved_items.source as source, post_snapshots.snapshot as snapshot
			 from favorites
			 join saved_items on saved_items.id = favorites.item_id
			 join post_snapshots on post_snapshots.id = saved_items.snapshot_id
			 order by favorites.favorited_at, saved_items.id`
		)
		.all() as SavedRow[];
	return rows.map((row) => presentSavedPost(db, row));
}

export function createAlbum(db: AppDatabase, name: string, now = Date.now()) {
	const id = randomUUID();
	db.insert(albums).values({ id, name, createdAt: now, updatedAt: now }).run();
	return { id, name };
}

export function listAlbums(db: AppDatabase) {
	return db.$client.prepare('select id, name from albums order by created_at, id').all() as {
		id: string;
		name: string;
	}[];
}

export function getAlbum(db: AppDatabase, id: string) {
	return db.$client.prepare('select id, name from albums where id = ?').get(id) as
		{ id: string; name: string } | undefined;
}

export function deleteAlbumRecord(db: AppDatabase, dataDir: string, albumId: string) {
	if (!getAlbum(db, albumId)) return false;
	const rows = db.$client
		.prepare('select item_id as itemId from album_items where album_id = ?')
		.all(albumId) as { itemId: string }[];
	const paths = db.$client.transaction(() => {
		db.$client.prepare('delete from album_items where album_id = ?').run(albumId);
		db.$client.prepare('delete from albums where id = ?').run(albumId);
		return unretainedPaths(
			db,
			rows.map((row) => row.itemId)
		);
	})();
	releaseHeldFiles(dataDir, paths);
	return true;
}

export function listAlbumPosts(db: AppDatabase, albumId: string): FavoritePost[] {
	const rows = db.$client
		.prepare(
			`select saved_items.id as id, saved_items.source as source, post_snapshots.snapshot as snapshot
			 from album_items
			 join saved_items on saved_items.id = album_items.item_id
			 join post_snapshots on post_snapshots.id = saved_items.snapshot_id
			 where album_items.album_id = ?
			 order by album_items.added_at, saved_items.id`
		)
		.all(albumId) as SavedRow[];
	return rows.map((row) => presentSavedPost(db, row));
}

export function saveFavorite(
	db: AppDatabase,
	metadata: PostMetadata,
	now = Date.now()
): SaveResult {
	return db.transaction((tx) => {
		const item = ensureItem(tx, metadata, now);
		tx.insert(favorites).values({ itemId: item.id, favoritedAt: now }).onConflictDoNothing().run();
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
	const saved = db.transaction((tx) => {
		const item = ensureItem(tx, metadata, now);
		const inserted = tx
			.insert(albumItems)
			.values({ albumId, itemId: item.id, addedAt: now })
			.onConflictDoNothing()
			.run();
		if (inserted.changes > 0) {
			tx.update(albums).set({ updatedAt: now }).where(eq(albums.id, albumId)).run();
		}
		ensureOriginalJob(tx, item.id, metadata.fileUrl);
		return {
			itemId: item.id,
			membership: 'album' as const,
			original: originalState(tx, item.mediaId),
			added: inserted.changes > 0
		};
	});
	if (saved.added) void refreshAutomaticAlbumCover(db, albumId);
	return { itemId: saved.itemId, membership: saved.membership, original: saved.original };
}

export type MembershipRemoval = {
	itemId: string;
	kind: 'favorite' | 'album';
	albumId?: string | null;
};

export function removeMemberships(
	db: AppDatabase,
	dataDir: string,
	removals: MembershipRemoval[],
	now = Date.now()
) {
	expireRemovals(db, dataDir, now);
	const paths = db.$client.transaction(() => {
		const entries = [];
		for (const removal of removals) {
			if (removal.kind === 'favorite') {
				const row = db.$client
					.prepare('select favorited_at as addedAt from favorites where item_id = ?')
					.get(removal.itemId) as { addedAt: number } | undefined;
				if (!row) continue;
				db.$client.prepare('delete from favorites where item_id = ?').run(removal.itemId);
				entries.push({
					itemId: removal.itemId,
					kind: 'favorite' as const,
					albumId: null,
					addedAt: row.addedAt
				});
			} else if (removal.albumId) {
				const row = db.$client
					.prepare('select added_at as addedAt from album_items where album_id = ? and item_id = ?')
					.get(removal.albumId, removal.itemId) as { addedAt: number } | undefined;
				if (!row) continue;
				db.$client
					.prepare('delete from album_items where album_id = ? and item_id = ?')
					.run(removal.albumId, removal.itemId);
				db.$client
					.prepare('update albums set updated_at = ? where id = ?')
					.run(now, removal.albumId);
				entries.push({
					itemId: removal.itemId,
					kind: 'album' as const,
					albumId: removal.albumId,
					addedAt: row.addedAt
				});
			}
		}
		if (!entries.length) return null;
		return recordHold(db, entries, now);
	})();
	if (!paths) return false;
	releaseHeldFiles(dataDir, paths);
	return true;
}

export function removeFavoriteMembership(
	db: AppDatabase,
	dataDir: string,
	itemId: string,
	now = Date.now()
) {
	return removeMemberships(db, dataDir, [{ itemId, kind: 'favorite' }], now);
}

export function removeAlbumMembershipRow(
	db: AppDatabase,
	dataDir: string,
	albumId: string,
	itemId: string,
	now = Date.now()
) {
	return removeMemberships(db, dataDir, [{ itemId, kind: 'album', albumId }], now);
}
