import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '#lib/server/db/index.ts';
import {
	mediaChoices,
	readAppliedSearch,
	type AppliedSearch,
	type MediaChoice,
	type SortChoice
} from '#lib/server/library/collections.ts';
import { inMaintenance } from '#lib/server/library/maintenance.ts';
import { compileRatingTags } from '#lib/server/library/rating-tags.ts';
import { matchSavedPosts } from '#lib/server/library/query.ts';
import {
	getAlbum,
	metadataHash,
	removeMemberships,
	saveAlbumMembership,
	saveFavorite,
	type PostMetadata
} from '#lib/server/library/save.ts';
import { isVideoFile } from '#lib/server/media/derivative.ts';
import {
	gelbooruCredentialState,
	gelbooruJson,
	readGelbooruAuth
} from '#lib/server/sources/gelbooru.ts';

/** Gelbooru search pages, and each local favorites or album page, use this size. */
export const COLLECTION_PAGE_LIMIT = 20;
export const COLLECTION_LEASE_MS = 60_000;

const sourceKinds = ['gelbooru', 'favorites', 'album', 'saved-search'] as const;

export type CollectionSource = (typeof sourceKinds)[number];
export type CollectionOperation = 'add' | 'remove';
export type CollectionDestination = 'favorite' | 'album';

export type CollectionImportContext = {
	db: AppDatabase;
	dataDir: string;
	now: () => number;
	fetchUpstream: (input: URL) => Promise<Response>;
	log?: (line: string) => void;
	fixtureOrigin?: string;
	secretPath?: string;
};

export type CollectionImportDraft = {
	operation?: unknown;
	destination?: unknown;
	albumId?: unknown;
	source?: unknown;
	sourceAlbumId?: unknown;
	query?: unknown;
	rating?: unknown;
	media?: unknown;
	sort?: unknown;
	excludedIds?: unknown;
	seed?: unknown;
};

export type CollectionImportView = {
	id: string;
	state: string;
	operation: CollectionOperation;
	destinationName: string;
	addedCount: number;
	total: number | null;
	error: string | null;
};

type ImportRow = {
	id: string;
	operation: CollectionOperation;
	destinationKind: CollectionDestination;
	destinationAlbumId: string | null;
	sourceKind: CollectionSource;
	sourceAlbumId: string | null;
	query: string;
	rating: string;
	media: string;
	sort: string;
	randomSeed: number;
	excludedIds: string;
	pageCursor: number;
	addedCount: number;
	total: number | null;
	state: string;
	error: string | null;
	leaseUntil: number | null;
};

type RemotePost = {
	id: string;
	metadata: PostMetadata;
};

type LocalPost = {
	itemId: string;
	metadata: PostMetadata;
	tags: string[];
	rating: string | null;
};

const rowSelect = `
	select id,
		operation,
		destination_kind as destinationKind,
		destination_album_id as destinationAlbumId,
		source_kind as sourceKind,
		source_album_id as sourceAlbumId,
		query,
		rating,
		media,
		sort,
		random_seed as randomSeed,
		excluded_ids as excludedIds,
		page_cursor as pageCursor,
		added_count as addedCount,
		total,
		state,
		error,
		lease_until as leaseUntil
	from collection_imports
`;

function logOf(services: CollectionImportContext) {
	return services.log ?? (() => {});
}

function readRow(db: AppDatabase, id: string) {
	return db.$client.prepare(`${rowSelect} where id = ?`).get(id) as ImportRow | undefined;
}

function destinationName(db: AppDatabase, row: ImportRow) {
	if (row.destinationKind === 'favorite') return 'Favorites';
	const album = row.destinationAlbumId ? getAlbum(db, row.destinationAlbumId) : undefined;
	return album?.name ?? 'Album';
}

function present(db: AppDatabase, row: ImportRow): CollectionImportView {
	return {
		id: row.id,
		state: row.state,
		operation: row.operation,
		destinationName: destinationName(db, row),
		addedCount: row.addedCount,
		total: row.total,
		error: row.error
	};
}

function reject(status: 400 | 404, message: string) {
	return { ok: false as const, status, message };
}

function readOperation(value: unknown): CollectionOperation | null {
	if (value === undefined || value === 'add') return 'add';
	if (value === 'remove') return 'remove';
	return null;
}

function readDestination(value: unknown): CollectionDestination | null {
	if (value === 'favorite' || value === 'album') return value;
	return null;
}

function readSource(value: unknown): CollectionSource | null {
	return sourceKinds.find((kind) => kind === value) ?? null;
}

function readId(value: unknown) {
	if (typeof value !== 'string') return null;
	const id = value.trim();
	if (!id || id.length > 200) return null;
	return id;
}

function readExcluded(value: unknown) {
	if (value === undefined) return [] as string[];
	if (!Array.isArray(value)) return null;
	const ids: string[] = [];
	for (const item of value) {
		if (typeof item !== 'string') return null;
		const id = item.trim();
		if (!id || id.length > 200) return null;
		if (!ids.includes(id)) ids.push(id);
	}
	if (ids.length > 10_000) return null;
	return ids;
}

function readSeed(sort: SortChoice, value: unknown) {
	if (sort !== 'Random') return 0;
	if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1_000_000) {
		return value;
	}
	return Math.floor(Math.random() * 10_001);
}

export function createCollectionImport(db: AppDatabase, input: unknown, now: number) {
	const draft =
		input && typeof input === 'object' ? (input as CollectionImportDraft) : ({} as CollectionImportDraft);
	const operation = readOperation(draft.operation);
	if (!operation) return reject(400, 'Import operation is invalid');
	const destination = readDestination(draft.destination);
	if (!destination) return reject(400, 'Import destination is invalid');
	const source = readSource(draft.source);
	if (!source) return reject(400, 'Import source is invalid');
	const applied = readAppliedSearch({
		query: draft.query === undefined ? '' : draft.query,
		rating: draft.rating,
		media: draft.media,
		sort: draft.sort
	});
	if (!applied.ok) return reject(400, applied.message);
	const excluded = readExcluded(draft.excludedIds);
	if (!excluded) return reject(400, 'Excluded posts are invalid');

	let albumId: string | null = null;
	if (destination === 'album') {
		albumId = readId(draft.albumId);
		if (!albumId) return reject(400, 'Album is invalid');
		if (!getAlbum(db, albumId)) return reject(404, 'Album was not found');
	}
	let sourceAlbumId: string | null = null;
	if (source === 'album') {
		sourceAlbumId = readId(draft.sourceAlbumId);
		if (!sourceAlbumId) return reject(400, 'Source album is invalid');
		if (!getAlbum(db, sourceAlbumId)) return reject(404, 'Album was not found');
	}

	const id = randomUUID();
	db.$client
		.prepare(
			`insert into collection_imports (
				id, operation, destination_kind, destination_album_id, source_kind, source_album_id,
				query, rating, media, sort, random_seed, excluded_ids, page_cursor, added_count,
				total, state, error, lease_until, created_at, updated_at
			) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, null, 'queued', null, null, ?, ?)`
		)
		.run(
			id,
			operation,
			destination,
			albumId,
			source,
			sourceAlbumId,
			applied.applied.query,
			JSON.stringify(applied.applied.rating),
			JSON.stringify(applied.applied.media),
			applied.applied.sort,
			readSeed(applied.applied.sort, draft.seed),
			JSON.stringify(excluded),
			now,
			now
		);
	const row = readRow(db, id);
	if (!row) return reject(400, 'Import could not be stored');
	return { ok: true as const, import: present(db, row) };
}

export function readCollectionImport(db: AppDatabase, id: string) {
	const row = readRow(db, id);
	return row ? present(db, row) : null;
}

export function listCollectionImports(db: AppDatabase): CollectionImportView[] {
	const rows = db.$client
		.prepare(
			`${rowSelect}
			 where state in ('queued', 'leased', 'paused', 'failed')
			 order by created_at, id`
		)
		.all() as ImportRow[];
	return rows.map((row) => present(db, row));
}

export function pauseCollectionImport(db: AppDatabase, id: string, now: number) {
	const result = db.$client
		.prepare(
			`update collection_imports
			 set state = 'paused', lease_until = null, updated_at = ?
			 where id = ? and state in ('queued', 'leased')`
		)
		.run(now, id);
	return result.changes > 0;
}

export function pauseAllCollectionImports(db: AppDatabase, now: number) {
	const result = db.$client
		.prepare(
			`update collection_imports
			 set state = 'paused', lease_until = null, updated_at = ?
			 where state in ('queued', 'leased')`
		)
		.run(now);
	return result.changes;
}

export function resumeCollectionImport(db: AppDatabase, id: string, now: number) {
	const result = db.$client
		.prepare(
			`update collection_imports
			 set state = 'queued', lease_until = null, updated_at = ?
			 where id = ? and state = 'paused'`
		)
		.run(now, id);
	return result.changes > 0;
}

export function cancelCollectionImport(db: AppDatabase, id: string, now: number) {
	const result = db.$client
		.prepare(
			`update collection_imports
			 set state = 'cancelled', lease_until = null, updated_at = ?
			 where id = ? and state in ('queued', 'leased', 'paused')`
		)
		.run(now, id);
	return result.changes > 0;
}

export function retryCollectionImport(db: AppDatabase, id: string, now: number) {
	const result = db.$client
		.prepare(
			`update collection_imports
			 set state = 'queued', error = null, lease_until = null, updated_at = ?
			 where id = ? and state = 'failed'`
		)
		.run(now, id);
	return result.changes > 0;
}

export function dismissCollectionImport(db: AppDatabase, id: string) {
	const result = db.$client
		.prepare(
			`delete from collection_imports
			 where id = ? and state in ('failed', 'cancelled')`
		)
		.run(id);
	return result.changes > 0;
}

function reclaimExpired(db: AppDatabase, now: number) {
	db.$client
		.prepare(
			`update collection_imports
			 set state = 'queued', lease_until = null
			 where state = 'leased' and (lease_until is null or lease_until <= ?)`
		)
		.run(now);
}

function claimImport(db: AppDatabase, now: number) {
	reclaimExpired(db, now);
	return db.$client.transaction(() => {
		const picked = db.$client
			.prepare(
				`select id from collection_imports
				 where state = 'queued'
				 order by created_at, id
				 limit 1`
			)
			.get() as { id: string } | undefined;
		if (!picked) return undefined;
		const leaseUntil = now + COLLECTION_LEASE_MS;
		const updated = db.$client
			.prepare(
				`update collection_imports
				 set state = 'leased', lease_until = ?, updated_at = ?
				 where id = ? and state = 'queued'`
			)
			.run(leaseUntil, now, picked.id);
		if (updated.changes !== 1) return undefined;
		return readRow(db, picked.id);
	})();
}

function hasQueued(db: AppDatabase) {
	return Boolean(
		db.$client.prepare(`select id from collection_imports where state = 'queued' limit 1`).get()
	);
}

function liveState(db: AppDatabase, id: string) {
	const row = db.$client.prepare('select state from collection_imports where id = ?').get(id) as
		| { state: string }
		| undefined;
	return row?.state ?? null;
}

function markFailed(db: AppDatabase, row: ImportRow, now: number, error: string) {
	const result = db.$client
		.prepare(
			`update collection_imports
			 set state = 'failed', error = ?, lease_until = null, updated_at = ?
			 where id = ? and state = 'leased' and lease_until = ?`
		)
		.run(error, now, row.id, row.leaseUntil);
	return result.changes > 0;
}

function storedApplied(row: ImportRow): AppliedSearch | null {
	let rating: unknown;
	let media: unknown;
	try {
		rating = JSON.parse(row.rating) as unknown;
		media = JSON.parse(row.media) as unknown;
	} catch {
		return null;
	}
	const applied = readAppliedSearch({
		query: row.query,
		rating,
		media,
		sort: row.sort
	});
	return applied.ok ? applied.applied : null;
}

function excludedSet(row: ImportRow) {
	try {
		const parsed = JSON.parse(row.excludedIds) as unknown;
		if (!Array.isArray(parsed)) return new Set<string>();
		return new Set(parsed.filter((item): item is string => typeof item === 'string'));
	} catch {
		return new Set<string>();
	}
}

function lowercaseRatings(rating: readonly string[]) {
	return rating.map((item) => item.toLowerCase());
}

function sortTag(sort: SortChoice, seed: number) {
	if (sort === 'Oldest') return 'sort:id:asc';
	if (sort === 'Highest score') return 'sort:score';
	if (sort === 'Random') return `sort:random:${seed}`;
	return '';
}

function mediaTag(selected: readonly MediaChoice[]) {
	const images = selected.includes('Images');
	const animated = selected.includes('Animated images');
	const videos = selected.includes('Videos');
	if ((images && animated && videos) || (!images && !animated && !videos)) return '';
	if (videos && !images && !animated) return 'video';
	if (animated && !images && !videos) return 'animated';
	if (!images) return '';
	return [videos ? '' : '-video', animated ? '' : '-animated'].filter(Boolean).join(' ');
}

function upstreamTags(applied: AppliedSearch, seed: number) {
	const ratingText = compileRatingTags(lowercaseRatings(applied.rating));
	return [applied.query, ratingText, sortTag(applied.sort, seed), mediaTag(applied.media)]
		.filter(Boolean)
		.join(' ')
		.trim();
}

function fileKind(fileUrl: string) {
	if (isVideoFile(fileUrl)) return 'video' as const;
	let pathname = fileUrl;
	try {
		pathname = new URL(fileUrl).pathname;
	} catch {
		// A bare path is already the value to classify.
	}
	const lower = pathname.toLowerCase();
	if (lower.endsWith('.gif') || lower.endsWith('.webp') || lower.endsWith('.apng')) {
		return 'animated' as const;
	}
	return 'image' as const;
}

function allowsMedia(selected: readonly MediaChoice[], fileUrl: string) {
	if (selected.length === 0 || selected.length === mediaChoices.length) return true;
	const kind = fileKind(fileUrl);
	if (kind === 'video') return selected.includes('Videos');
	if (kind === 'animated') return selected.includes('Animated images');
	return selected.includes('Images');
}

function metadataFromSnapshot(snapshot: string): PostMetadata | null {
	let parsed: {
		source?: unknown;
		remoteId?: unknown;
		tags?: unknown;
		width?: unknown;
		height?: unknown;
		fileUrl?: unknown;
		rating?: unknown;
	};
	try {
		parsed = JSON.parse(snapshot) as typeof parsed;
	} catch {
		return null;
	}
	const tags = Array.isArray(parsed.tags)
		? parsed.tags.filter((tag): tag is string => typeof tag === 'string')
		: [];
	const width = Number(parsed.width);
	const height = Number(parsed.height);
	if (typeof parsed.remoteId !== 'string' || typeof parsed.fileUrl !== 'string') return null;
	if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
	const rating = typeof parsed.rating === 'string' && parsed.rating ? parsed.rating : undefined;
	return {
		source: typeof parsed.source === 'string' ? parsed.source : 'gelbooru',
		remoteId: parsed.remoteId,
		tags,
		width,
		height,
		fileUrl: parsed.fileUrl,
		...(rating ? { rating } : {})
	};
}

function asRecords(value: unknown) {
	if (Array.isArray(value)) {
		return value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
	}
	if (value && typeof value === 'object') return [value as Record<string, unknown>];
	return [];
}

function gelbooruCount(json: unknown) {
	if (!json || typeof json !== 'object') return null;
	const attributes = (json as { '@attributes'?: { count?: unknown } })['@attributes'];
	const count = Number(attributes?.count);
	if (!Number.isFinite(count) || count < 0) return null;
	return count;
}

function gelbooruPosts(json: unknown): RemotePost[] {
	const root = json as { post?: unknown };
	const posts: RemotePost[] = [];
	for (const post of asRecords(root.post)) {
		const id = String(post.id ?? '');
		const fileUrl = String(post.file_url ?? '');
		if (!id || !fileUrl) continue;
		const tags = String(post.tags ?? '')
			.split(/\s+/)
			.filter(Boolean);
		const width = Number(post.width ?? 0);
		const height = Number(post.height ?? 0);
		const rating = String(post.rating ?? '');
		posts.push({
			id,
			metadata: {
				source: 'gelbooru',
				remoteId: id,
				tags,
				width: Number.isFinite(width) ? width : 0,
				height: Number.isFinite(height) ? height : 0,
				fileUrl,
				...(rating ? { rating } : {})
			}
		});
	}
	return posts;
}

function remoteSource(kind: CollectionSource) {
	return kind === 'gelbooru' || kind === 'saved-search';
}

function localOrder(
	sort: SortChoice,
	seed: number,
	timeColumn: 'favorites.favorited_at' | 'album_items.added_at'
) {
	const salt = Number.isInteger(seed) ? seed : 0;
	if (sort === 'Oldest') return `${timeColumn} asc, saved_items.id asc`;
	if (sort === 'Highest score') return 'saved_items.saved_at desc, saved_items.id desc';
	if (sort === 'Random') {
		return `((length(saved_items.id) * 17 + unicode(substr(saved_items.id, 1, 1)) + ${salt}) % 9973), saved_items.id`;
	}
	return `${timeColumn} desc, saved_items.id desc`;
}

function localRows(db: AppDatabase, row: ImportRow, applied: AppliedSearch) {
	const offset = row.pageCursor * COLLECTION_PAGE_LIMIT;
	const album = row.sourceKind === 'album';
	const timeColumn = album ? 'album_items.added_at' : 'favorites.favorited_at';
	const from = album
		? `album_items
			 join saved_items on saved_items.id = album_items.item_id
			 join post_snapshots on post_snapshots.id = saved_items.snapshot_id
			 where album_items.album_id = ?`
		: `favorites
			 join saved_items on saved_items.id = favorites.item_id
			 join post_snapshots on post_snapshots.id = saved_items.snapshot_id`;
	const statement = db.$client.prepare(
		`select saved_items.id as itemId, post_snapshots.snapshot as snapshot
		 from ${from}
		 order by ${localOrder(applied.sort, row.randomSeed, timeColumn)}
		 limit ? offset ?`
	);
	const args = album
		? [row.sourceAlbumId, COLLECTION_PAGE_LIMIT, offset]
		: [COLLECTION_PAGE_LIMIT, offset];
	return statement.all(...args) as { itemId: string; snapshot: string }[];
}

function scopeCount(db: AppDatabase, row: ImportRow) {
	if (row.sourceKind === 'album') {
		const count = db.$client
			.prepare('select count(*) as n from album_items where album_id = ?')
			.get(row.sourceAlbumId) as { n: number };
		return count.n;
	}
	const count = db.$client.prepare('select count(*) as n from favorites').get() as { n: number };
	return count.n;
}

function targetError(db: AppDatabase, row: ImportRow) {
	if (row.destinationKind === 'album' && !getAlbum(db, row.destinationAlbumId ?? '')) {
		return 'album was not found';
	}
	if (row.sourceKind === 'album' && !getAlbum(db, row.sourceAlbumId ?? '')) {
		return 'album was not found';
	}
	return null;
}

function stillOpen(db: AppDatabase, row: ImportRow) {
	const state = liveState(db, row.id);
	return state === 'leased' || state === 'paused';
}

function memberExists(db: AppDatabase, metadata: PostMetadata, row: ImportRow) {
	const hash = metadataHash(metadata);
	const item = db.$client
		.prepare('select id from saved_items where metadata_hash = ?')
		.get(hash) as { id: string } | undefined;
	if (!item) return false;
	if (row.destinationKind === 'favorite') {
		return Boolean(
			db.$client.prepare('select item_id from favorites where item_id = ?').get(item.id)
		);
	}
	return Boolean(
		db.$client
			.prepare('select item_id from album_items where album_id = ? and item_id = ?')
			.get(row.destinationAlbumId, item.id)
	);
}

function rememberAdd(db: AppDatabase, metadata: PostMetadata, row: ImportRow, now: number) {
	const existed = memberExists(db, metadata, row);
	if (row.destinationKind === 'favorite') saveFavorite(db, metadata, now);
	else saveAlbumMembership(db, metadata, row.destinationAlbumId ?? '', now);
	return existed ? 0 : 1;
}

function remoteItemIds(db: AppDatabase, metadata: PostMetadata) {
	return (
		db.$client
			.prepare('select id from saved_items where source = ? and remote_id = ?')
			.all(metadata.source, metadata.remoteId) as { id: string }[]
	).map((item) => item.id);
}

function rememberRemoval(
	db: AppDatabase,
	dataDir: string,
	itemId: string,
	row: ImportRow,
	now: number
) {
	const removed = removeMemberships(
		db,
		dataDir,
		[
			row.destinationKind === 'favorite'
				? { itemId, kind: 'favorite' as const }
				: { itemId, kind: 'album' as const, albumId: row.destinationAlbumId }
		],
		now
	);
	return removed ? 1 : 0;
}

function applyMetadata(
	services: CollectionImportContext,
	row: ImportRow,
	metadata: PostMetadata,
	itemId: string | null,
	now: number
) {
	if (row.operation === 'remove') {
		const ids = itemId ? [itemId] : remoteItemIds(services.db, metadata);
		let removed = 0;
		for (const id of ids) {
			if (!stillOpen(services.db, row)) return removed;
			removed += rememberRemoval(services.db, services.dataDir, id, row, now);
		}
		return removed;
	}
	return rememberAdd(services.db, metadata, row, now);
}

function commitPage(
	db: AppDatabase,
	row: ImportRow,
	now: number,
	added: number,
	total: number | null,
	done: boolean
) {
	const nextCursor = row.pageCursor + 1;
	const continued = db.$client
		.prepare(
			`update collection_imports
			 set page_cursor = ?, added_count = ?, total = ?,
			 	state = case when state = 'paused' then 'paused' when ? = 1 then 'succeeded' else 'queued' end,
			 	error = null, lease_until = null, updated_at = ?
			 where id = ? and page_cursor = ? and (
			 	(state = 'leased' and lease_until = ?) or state = 'paused'
			 )`
		)
		.run(
			nextCursor,
			added,
			total,
			done ? 1 : 0,
			now,
			row.id,
			row.pageCursor,
			row.leaseUntil
		);
	if (continued.changes > 0) return;
	db.$client
		.prepare(
			`update collection_imports
			 set added_count = ?, updated_at = ?
			 where id = ? and state = 'cancelled' and page_cursor = ?`
		)
		.run(added, now, row.id, row.pageCursor);
}

async function fetchGelbooru(services: CollectionImportContext, row: ImportRow, applied: AppliedSearch) {
	if (gelbooruCredentialState(services.db, services.secretPath) === 'unavailable') {
		return { ok: false as const, error: 'source auth required' };
	}
	const base = services.fixtureOrigin ?? 'https://gelbooru.com';
	let result: Awaited<ReturnType<typeof gelbooruJson>>;
	try {
		result = await gelbooruJson(
			base,
			{
				s: 'post',
				q: 'index',
				tags: upstreamTags(applied, row.randomSeed),
				limit: String(COLLECTION_PAGE_LIMIT),
				pid: String(row.pageCursor),
				...readGelbooruAuth(services.db, services.secretPath)
			},
			services.fetchUpstream,
			logOf(services)
		);
	} catch {
		return { ok: false as const, error: 'source unavailable' };
	}
	if (!result.ok) {
		return {
			ok: false as const,
			error: result.reason === 'auth' ? 'source auth required' : 'source response was unreadable'
		};
	}
	return { ok: true as const, posts: gelbooruPosts(result.json), total: gelbooruCount(result.json) };
}

function filterLocal(applied: AppliedSearch, excluded: Set<string>, rows: LocalPost[]) {
	const matched = matchSavedPosts(
		rows.map((item) => ({ item, tags: item.tags, rating: item.rating })),
		applied.query,
		lowercaseRatings(applied.rating)
	);
	return matched.posts
		.map((item) => item.item)
		.filter((item) => allowsMedia(applied.media, item.metadata.fileUrl))
		.filter((item) => !excluded.has(item.itemId));
}

async function runClaimedPage(services: CollectionImportContext, row: ImportRow) {
	const now = services.now();
	const missing = targetError(services.db, row);
	if (missing) {
		markFailed(services.db, row, now, missing);
		return;
	}
	const applied = storedApplied(row);
	if (!applied) {
		markFailed(services.db, row, now, 'import could not be read');
		return;
	}
	const excluded = excludedSet(row);
	let total = row.total;
	let done: boolean;
	let added = row.addedCount;
	const posts: Array<{ metadata: PostMetadata; itemId: string | null }> = [];

	if (remoteSource(row.sourceKind)) {
		const page = await fetchGelbooru(services, row, applied);
		const state = liveState(services.db, row.id);
		if (state === 'cancelled') return;
		if (!page.ok) {
			if (state === 'leased') markFailed(services.db, row, services.now(), page.error);
			return;
		}
		if (page.total != null) total = page.total;
		for (const post of page.posts) {
			if (!excluded.has(post.id)) posts.push({ metadata: post.metadata, itemId: null });
		}
		const seen = (row.pageCursor + 1) * COLLECTION_PAGE_LIMIT;
		done = page.posts.length < COLLECTION_PAGE_LIMIT || (total != null && seen >= total);
	} else {
		if (total == null) total = scopeCount(services.db, row);
		const page = localRows(services.db, row, applied);
		const loaded: LocalPost[] = [];
		for (const item of page) {
			const metadata = metadataFromSnapshot(item.snapshot);
			if (!metadata) continue;
			loaded.push({
				itemId: item.itemId,
				metadata,
				tags: metadata.tags,
				rating: metadata.rating ?? null
			});
		}
		for (const item of filterLocal(applied, excluded, loaded)) {
			posts.push({ metadata: item.metadata, itemId: item.itemId });
		}
		done = page.length < COLLECTION_PAGE_LIMIT;
	}

	for (const post of posts) {
		if (!stillOpen(services.db, row)) break;
		added += applyMetadata(services, row, post.metadata, post.itemId, services.now());
	}
	commitPage(services.db, row, services.now(), added, total, done && stillOpen(services.db, row));
}

/**
 * Claims one queued import and processes a single page.
 * The upstream read is not wrapped in a write transaction.
 * Returns true when another queued page is waiting.
 */
export async function runCollectionImportPass(services: CollectionImportContext) {
	if (inMaintenance(services.dataDir)) return false;
	const row = claimImport(services.db, services.now());
	if (!row) return false;
	try {
		await runClaimedPage(services, row);
	} catch (error) {
		markFailed(services.db, row, services.now(), 'import failed');
		logOf(services)(error instanceof Error ? error.message : 'collection import failed');
	}
	return hasQueued(services.db);
}
