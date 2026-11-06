import { createHash, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '#lib/server/db/index.ts';
import {
	albumItems,
	favorites,
	jobs,
	mediaObjects,
	postSnapshots,
	savedItems
} from '#lib/server/db/schema.ts';

export type PostMetadata = {
	source: string;
	remoteId: string;
	tags: string[];
	width: number;
	height: number;
	fileUrl: string;
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
		fileUrl: canonicalFileUrl(metadata.fileUrl)
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
	return rows.map((row) => {
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
	});
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
