import { randomUUID } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import type { AppDatabase } from '#lib/server/db/index.ts';
import { matchCoverColors, type CoverColorCandidate } from '#lib/server/library/cover-color.ts';
import { limitInputPixels, recipeNames } from '#lib/server/media/derivative.ts';

export const ratingChoices = ['General', 'Sensitive', 'Questionable', 'Explicit'] as const;
export const mediaChoices = ['Images', 'Animated images', 'Videos'] as const;
export const sortChoices = ['Newest', 'Oldest', 'Highest score', 'Random'] as const;
export const savedSearchTypes = ['search', 'artist', 'character'] as const;

export type RatingChoice = (typeof ratingChoices)[number];
export type MediaChoice = (typeof mediaChoices)[number];
export type SortChoice = (typeof sortChoices)[number];
export type SavedSearchType = (typeof savedSearchTypes)[number];

export type AppliedSearch = {
	query: string;
	rating: RatingChoice[];
	media: MediaChoice[];
	sort: SortChoice;
};

export type CoverItem = {
	itemId: string;
	src: string | null;
	available: boolean;
};

export type CoverState = {
	/** True after the cover editor saves. That manual lock never moves. */
	saved: boolean;
	/** `first-items` until automatic or manual slots are stored. Null once the fan should use slots. */
	fallback: 'first-items' | null;
	/**
	 * Album fans use membership order. Saved-search fans use the first results of the
	 * applied query; those results are not stored here.
	 */
	fallbackSource: 'album-membership' | 'applied-query' | null;
	/** Slot 0 is the large primary. Slots 1–3 are the supports, left to right. */
	primaryIndex: 0;
	slots: Array<CoverItem | null>;
	firstItems: CoverItem[];
};

export type AlbumRecord = {
	id: string;
	name: string;
	createdAt: number;
	updatedAt: number;
	itemCount: number;
	pinned: boolean;
	pinOrder: number | null;
	temporary: boolean;
	temporaryOpenedAt: number | null;
	cover: CoverState;
};

export type AlbumSidebar = {
	temporary: string[];
	pinned: string[];
};

export type AlbumCollection = {
	albums: AlbumRecord[];
	albumSidebar: AlbumSidebar;
};

export type AlbumPlacement = {
	album: AlbumRecord;
	albumSidebar: AlbumSidebar;
};

export type ExplorationOpen = {
	action: 'new-view';
	reuse: false;
	background: false;
	placement: 'top';
	recordHistory: true;
	query: string;
	rating: RatingChoice[];
	media: MediaChoice[];
	sort: SortChoice;
};

export type SavedSearchRecord = {
	id: string;
	name: string;
	type: SavedSearchType;
	bookmarkLabel: 'Save search' | 'Save artist' | 'Save character';
	query: string;
	rating: RatingChoice[];
	media: MediaChoice[];
	sort: SortChoice;
	createdAt: number;
	updatedAt: number;
	cover: CoverState;
	exploration: ExplorationOpen;
};

type AlbumRow = {
	id: string;
	name: string;
	createdAt: number;
	updatedAt: number;
	pinned: number;
	pinOrder: number | null;
	temporaryOpen: number;
	temporaryOpenedAt: number | null;
	coverSaved: number;
	coverPrimary: string | null;
	coverSupport1: string | null;
	coverSupport2: string | null;
	coverSupport3: string | null;
	coverAutoStopped: number;
};

type SavedSearchRow = {
	id: string;
	name: string;
	type: string;
	query: string;
	rating: string;
	media: string;
	sort: string;
	createdAt: number;
	updatedAt: number;
	coverSaved: number;
	coverPrimary: string | null;
	coverSupport1: string | null;
	coverSupport2: string | null;
	coverSupport3: string | null;
	coverAutoStopped: number;
};

const albumSelect = `
	select id, name,
		created_at as createdAt,
		updated_at as updatedAt,
		pinned,
		pin_order as pinOrder,
		temporary_open as temporaryOpen,
		temporary_opened_at as temporaryOpenedAt,
		cover_saved as coverSaved,
		cover_primary as coverPrimary,
		cover_support_1 as coverSupport1,
		cover_support_2 as coverSupport2,
		cover_support_3 as coverSupport3,
		cover_auto_stopped as coverAutoStopped
	from albums
`;

const savedSearchSelect = `
	select id, name, type, query, rating, media, sort,
		created_at as createdAt,
		updated_at as updatedAt,
		cover_saved as coverSaved,
		cover_primary as coverPrimary,
		cover_support_1 as coverSupport1,
		cover_support_2 as coverSupport2,
		cover_support_3 as coverSupport3,
		cover_auto_stopped as coverAutoStopped
	from saved_searches
`;

const queryLimit = 2000;
const nameLimit = 2000;
const slotLimit = 200;

export function bookmarkLabel(type: SavedSearchType) {
	if (type === 'artist') return 'Save artist' as const;
	if (type === 'character') return 'Save character' as const;
	return 'Save search' as const;
}

export function readAppliedSearch(
	body: unknown
): { ok: true; applied: AppliedSearch } | { ok: false; message: string } {
	if (!body || typeof body !== 'object') {
		return { ok: false, message: 'Applied query is invalid' };
	}
	const record = body as Record<string, unknown>;
	if (typeof record.query !== 'string') return { ok: false, message: 'Applied query is invalid' };
	const query = record.query.trim();
	if (query.length > queryLimit) return { ok: false, message: 'Applied query is invalid' };
	const ratingInput = record.rating !== undefined ? record.rating : record.ratings;
	const rating = readChoiceList(ratingInput, ratingChoices);
	if (!rating) return { ok: false, message: 'Rating is invalid' };
	const media = readChoiceList(record.media, mediaChoices);
	if (!media) return { ok: false, message: 'Media is invalid' };
	const sort = readSort(record.sort);
	if (!sort) return { ok: false, message: 'Sort is invalid' };
	return { ok: true, applied: { query, rating, media, sort } };
}

export function readSavedSearchType(
	value: unknown
): { ok: true; type: SavedSearchType | null } | { ok: false } {
	if (value === undefined) return { ok: true, type: null };
	if (typeof value !== 'string') return { ok: false };
	const type = savedSearchTypes.find((item) => item === value.trim().toLowerCase());
	return type ? { ok: true, type } : { ok: false };
}

export function readSavedSearchName(
	value: unknown
): { ok: true; name: string | null } | { ok: false } {
	if (value === undefined) return { ok: true, name: null };
	if (typeof value !== 'string') return { ok: false };
	const name = value.trim();
	if (!name || name.length > nameLimit) return { ok: false };
	return { ok: true, name };
}

export function parseCoverSlots(input: unknown): Array<string | null> | null {
	if (!Array.isArray(input) || input.length !== 4) return null;
	const slots = input.map(slotId);
	if (slots.some((slot) => slot === undefined)) return null;
	const ids = slots.filter((slot): slot is string => typeof slot === 'string');
	if (!ids.length || new Set(ids).size !== ids.length) return null;
	return slots as Array<string | null>;
}

export function listAlbumCollection(db: AppDatabase): AlbumCollection {
	releaseUnreferencedCoverPreviews(db);
	const albums = loadAlbums(db);
	return { albums, albumSidebar: sidebarFor(albums) };
}

export function readAlbum(db: AppDatabase, albumId: string) {
	return loadAlbums(db, albumId)[0];
}

export function renameAlbum(db: AppDatabase, albumId: string, name: string, now: number) {
	const trimmed = name.trim();
	if (!trimmed || trimmed.length > 80) return 'invalid' as const;
	if (!albumExists(db, albumId)) return null;
	db.$client
		.prepare('update albums set name = ?, updated_at = ? where id = ?')
		.run(trimmed, now, albumId);
	return readAlbum(db, albumId) ?? null;
}

export function pinAlbum(
	db: AppDatabase,
	albumId: string,
	input: { pinned: boolean; position?: number; keepOpen?: boolean },
	now: number
): AlbumPlacement | 'invalid' | null {
	if (!albumExists(db, albumId)) return null;
	if (input.position !== undefined && (!Number.isInteger(input.position) || input.position < 0)) {
		return 'invalid';
	}
	db.$client.transaction(() => {
		if (input.pinned) {
			const others = db.$client
				.prepare('select id from albums where pinned = 1 and id != ? order by pin_order, id')
				.all(albumId) as { id: string }[];
			const ids = others.map((row) => row.id);
			const index = input.position === undefined ? 0 : Math.min(input.position, ids.length);
			ids.splice(index, 0, albumId);
			const update = db.$client.prepare(
				`update albums
				 set pinned = 1, pin_order = ?, temporary_open = 0, temporary_opened_at = null
				 where id = ?`
			);
			ids.forEach((id, pinOrder) => update.run(pinOrder, id));
			return;
		}
		db.$client.prepare('update albums set pinned = 0, pin_order = null where id = ?').run(albumId);
		if (input.keepOpen) {
			db.$client
				.prepare('update albums set temporary_open = 1, temporary_opened_at = ? where id = ?')
				.run(now, albumId);
		}
		const remaining = db.$client
			.prepare('select id from albums where pinned = 1 order by pin_order, id')
			.all() as { id: string }[];
		const update = db.$client.prepare('update albums set pin_order = ? where id = ?');
		remaining.forEach((row, pinOrder) => update.run(pinOrder, row.id));
	})();
	return placement(db, albumId);
}

export function openTemporaryAlbum(db: AppDatabase, albumId: string, now: number) {
	const row = albumRow(db, albumId);
	if (!row) return null;
	if (!row.pinned && !row.temporaryOpen) {
		db.$client
			.prepare('update albums set temporary_open = 1, temporary_opened_at = ? where id = ?')
			.run(now, albumId);
	}
	return placement(db, albumId);
}

export function closeTemporaryAlbum(db: AppDatabase, albumId: string) {
	if (!albumExists(db, albumId)) return null;
	db.$client
		.prepare('update albums set temporary_open = 0, temporary_opened_at = null where id = ?')
		.run(albumId);
	return placement(db, albumId);
}

export function saveAlbumCover(
	db: AppDatabase,
	albumId: string,
	slots: Array<string | null>,
	now: number
) {
	if (!albumExists(db, albumId)) return null;
	const members = new Set(
		(
			db.$client
				.prepare('select item_id as itemId from album_items where album_id = ?')
				.all(albumId) as {
				itemId: string;
			}[]
		).map((row) => row.itemId)
	);
	if (slots.some((id) => id !== null && !members.has(id))) return 'not-member' as const;
	writeCover(db, 'albums', albumId, slots, now);
	return readAlbum(db, albumId) ?? null;
}

export function listSavedSearches(
	db: AppDatabase,
	filter: { q?: string; type?: SavedSearchType } = {}
) {
	releaseUnreferencedCoverPreviews(db);
	const rows = db.$client
		.prepare(`${savedSearchSelect} order by updated_at desc, created_at desc, id`)
		.all() as SavedSearchRow[];
	const needle = filter.q?.trim().toLowerCase() ?? '';
	return rows
		.filter((row) => !filter.type || row.type === filter.type)
		.filter((row) => !needle || row.name.toLowerCase().includes(needle))
		.map((row) => presentSavedSearch(db, row));
}

export function readSavedSearch(db: AppDatabase, id: string) {
	const row = savedSearchRow(db, id);
	return row ? presentSavedSearch(db, row) : undefined;
}

/**
 * Saved-search covers recalculate here, when an open has fetched results.
 * Reading or listing a saved search does not. Passing no results leaves the cover alone.
 * The primary is the first fetched image and is never replaced. Supports change only while
 * the cover is still automatic and `cover_auto_stopped` is clear, and only when at least
 * four distinct images can be sampled.
 */
export async function openSavedSearch(
	db: AppDatabase,
	id: string,
	results?: readonly CoverColorCandidate[] | null
): Promise<SavedSearchRecord | null> {
	if (!savedSearchRow(db, id)) return null;
	if (results && results.length) {
		await enqueueCoverWork(`saved:${id}`, () => recalculateSavedSearch(db, id, results));
	}
	const fresh = savedSearchRow(db, id);
	return fresh ? presentSavedSearch(db, fresh) : null;
}

export function matchSavedSearch(db: AppDatabase, applied: AppliedSearch) {
	const row = findApplied(db, applied);
	return row ? presentSavedSearch(db, row) : null;
}

export function createSavedSearch(
	db: AppDatabase,
	input: { applied: AppliedSearch; type: SavedSearchType; name: string | null },
	now: number
):
	| { ok: true; savedSearch: SavedSearchRecord }
	| { ok: false; reason: 'conflict'; matchId: string }
	| { ok: false; reason: 'invalid'; message: string } {
	const name = input.name ?? (input.applied.query || 'All posts');
	if (!name.trim() || name.length > nameLimit) {
		return { ok: false, reason: 'invalid', message: 'Saved search name is invalid' };
	}
	const existing = findApplied(db, input.applied);
	if (existing) return { ok: false, reason: 'conflict', matchId: existing.id };
	const id = randomUUID();
	try {
		db.$client
			.prepare(
				`insert into saved_searches (
					id, name, type, query, rating, media, sort, cover_saved, created_at, updated_at
				) values (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
			)
			.run(
				id,
				name,
				input.type,
				input.applied.query,
				JSON.stringify(input.applied.rating),
				JSON.stringify(input.applied.media),
				input.applied.sort,
				now,
				now
			);
	} catch (error) {
		if (!isUniqueConstraint(error)) throw error;
		const match = findApplied(db, input.applied);
		if (match) return { ok: false, reason: 'conflict', matchId: match.id };
		throw error;
	}
	const savedSearch = readSavedSearch(db, id);
	if (!savedSearch) throw new Error('saved search was not stored');
	return { ok: true, savedSearch };
}

export function updateSavedSearch(
	db: AppDatabase,
	id: string,
	patch: { name?: string; type?: SavedSearchType },
	now: number
) {
	const current = savedSearchRow(db, id);
	if (!current) return null;
	if (patch.name === undefined && patch.type === undefined) return 'invalid' as const;
	let name = current.name;
	if (patch.name !== undefined) {
		const trimmed = patch.name.trim();
		if (!trimmed || trimmed.length > nameLimit) return 'invalid' as const;
		name = trimmed;
	}
	const type = patch.type ?? current.type;
	db.$client
		.prepare('update saved_searches set name = ?, type = ?, updated_at = ? where id = ?')
		.run(name, type, now, id);
	return readSavedSearch(db, id) ?? null;
}

export function deleteSavedSearch(db: AppDatabase, id: string) {
	const result = db.$client.prepare('delete from saved_searches where id = ?').run(id);
	if (result.changes > 0) releaseUnreferencedCoverPreviews(db);
	return result.changes > 0;
}

export function saveSavedSearchCover(
	db: AppDatabase,
	id: string,
	slots: Array<string | null>,
	now: number
) {
	if (!savedSearchRow(db, id)) return null;
	writeCover(db, 'saved_searches', id, slots, now);
	return readSavedSearch(db, id) ?? null;
}

function placement(db: AppDatabase, albumId: string): AlbumPlacement | null {
	const collection = listAlbumCollection(db);
	const album = collection.albums.find((item) => item.id === albumId);
	if (!album) return null;
	return { album, albumSidebar: collection.albumSidebar };
}

function loadAlbums(db: AppDatabase, albumId?: string) {
	const rows = db.$client
		.prepare(`${albumSelect} ${albumId ? 'where id = ?' : ''} order by updated_at desc, id`)
		.all(...(albumId ? [albumId] : [])) as AlbumRow[];
	const counts = itemCounts(db, albumId);
	const first = firstItemIds(db, albumId);
	const known = knownItems(
		db,
		rows.flatMap((row) => storedIds(row)).filter((id): id is string => id !== null)
	);
	for (const ids of first.values()) {
		for (const id of ids) known.add(id);
	}
	const previews = coverPreviewSources(
		db,
		rows
			.flatMap((row) => storedIds(row))
			.filter((id): id is string => id !== null && !known.has(id))
	);
	return rows.map((row) =>
		presentAlbum(row, counts.get(row.id) ?? 0, first.get(row.id) ?? [], known, previews)
	);
}

function presentAlbum(
	row: AlbumRow,
	itemCount: number,
	firstIds: string[],
	known: Set<string>,
	previews: Map<string, string>
): AlbumRecord {
	return {
		id: row.id,
		name: row.name,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		itemCount,
		pinned: row.pinned === 1,
		pinOrder: row.pinned === 1 ? row.pinOrder : null,
		temporary: row.temporaryOpen === 1,
		temporaryOpenedAt: row.temporaryOpen === 1 ? row.temporaryOpenedAt : null,
		cover: presentCover(
			row.coverSaved === 1,
			'album-membership',
			storedIds(row),
			firstIds,
			known,
			previews
		)
	};
}

function presentSavedSearch(db: AppDatabase, row: SavedSearchRow): SavedSearchRecord {
	const rating = readStoredList(row.rating, ratingChoices);
	const media = readStoredList(row.media, mediaChoices);
	const sort = sortChoices.find((item) => item === row.sort) ?? 'Newest';
	const type = savedSearchTypes.find((item) => item === row.type) ?? 'search';
	const stored = storedIds(row);
	const storedIdsPresent = stored.filter((id): id is string => id !== null);
	const known = knownItems(db, storedIdsPresent);
	const previews = coverPreviewSources(
		db,
		storedIdsPresent.filter((id) => !known.has(id))
	);
	const applied = { query: row.query, rating, media, sort };
	return {
		id: row.id,
		name: row.name,
		type,
		bookmarkLabel: bookmarkLabel(type),
		query: row.query,
		rating,
		media,
		sort,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		cover: presentCover(row.coverSaved === 1, 'applied-query', stored, [], known, previews),
		exploration: explorationOpen(applied)
	};
}

function presentCover(
	saved: boolean,
	source: 'album-membership' | 'applied-query',
	stored: Array<string | null>,
	firstIds: string[],
	known: Set<string>,
	previews: Map<string, string>
): CoverState {
	const useStored = saved || stored.some((itemId) => itemId !== null);
	const slots = (useStored ? stored : [null, null, null, null]).map((itemId) =>
		itemId ? itemView(itemId, known, previews) : null
	);
	return {
		saved,
		fallback: useStored ? null : 'first-items',
		fallbackSource: useStored ? null : source,
		primaryIndex: 0,
		slots,
		firstItems: firstIds.map((itemId) => itemView(itemId, known, previews))
	};
}

function explorationOpen(applied: AppliedSearch): ExplorationOpen {
	return {
		action: 'new-view',
		reuse: false,
		background: false,
		placement: 'top',
		recordHistory: true,
		query: applied.query,
		rating: applied.rating,
		media: applied.media,
		sort: applied.sort
	};
}

function itemView(itemId: string, known: Set<string>, previews: Map<string, string>): CoverItem {
	const available = known.has(itemId);
	return {
		itemId,
		available,
		src: available
			? `/api/library/originals/${encodeURIComponent(itemId)}`
			: (previews.get(itemId) ?? null)
	};
}

function sidebarFor(albums: AlbumRecord[]): AlbumSidebar {
	return {
		temporary: albums
			.filter((album) => album.temporary)
			.sort(
				(left, right) =>
					(right.temporaryOpenedAt ?? 0) - (left.temporaryOpenedAt ?? 0) ||
					left.id.localeCompare(right.id)
			)
			.map((album) => album.id),
		pinned: albums
			.filter((album) => album.pinned)
			.sort(
				(left, right) =>
					(left.pinOrder ?? 0) - (right.pinOrder ?? 0) || left.id.localeCompare(right.id)
			)
			.map((album) => album.id)
	};
}

function storedIds(row: {
	coverPrimary: string | null;
	coverSupport1: string | null;
	coverSupport2: string | null;
	coverSupport3: string | null;
}) {
	return [row.coverPrimary, row.coverSupport1, row.coverSupport2, row.coverSupport3];
}

function writeCover(
	db: AppDatabase,
	table: 'albums' | 'saved_searches',
	id: string,
	slots: Array<string | null>,
	now: number
) {
	db.$client
		.prepare(
			`update ${table}
			 set cover_saved = 1,
				 cover_primary = ?,
				 cover_support_1 = ?,
				 cover_support_2 = ?,
				 cover_support_3 = ?,
				 updated_at = ?
			 where id = ?`
		)
		.run(slots[0], slots[1], slots[2], slots[3], now, id);
	void enqueueCoverWork(`manual:${table}:${id}`, () => persistSlotPreviews(db, slots));
}

function itemCounts(db: AppDatabase, albumId?: string) {
	const rows = db.$client
		.prepare(
			`select album_id as albumId, count(*) as itemCount
			 from album_items
			 ${albumId ? 'where album_id = ?' : ''}
			 group by album_id`
		)
		.all(...(albumId ? [albumId] : [])) as { albumId: string; itemCount: number }[];
	return new Map(rows.map((row) => [row.albumId, row.itemCount]));
}

function firstItemIds(db: AppDatabase, albumId?: string) {
	const rows = db.$client
		.prepare(
			`select album_items.album_id as albumId, album_items.item_id as itemId
			 from album_items
			 join saved_items on saved_items.id = album_items.item_id
			 ${albumId ? 'where album_items.album_id = ?' : ''}
			 order by album_items.added_at, saved_items.id`
		)
		.all(...(albumId ? [albumId] : [])) as { albumId: string; itemId: string }[];
	const grouped = new Map<string, string[]>();
	for (const row of rows) {
		const list = grouped.get(row.albumId) ?? [];
		if (list.length >= 4) continue;
		list.push(row.itemId);
		grouped.set(row.albumId, list);
	}
	return grouped;
}

function knownItems(db: AppDatabase, ids: string[]) {
	const unique = [...new Set(ids)];
	const found = new Set<string>();
	for (let index = 0; index < unique.length; index += 400) {
		const chunk = unique.slice(index, index + 400);
		if (!chunk.length) continue;
		const marks = chunk.map(() => '?').join(', ');
		const rows = db.$client
			.prepare(`select id from saved_items where id in (${marks})`)
			.all(...chunk) as { id: string }[];
		for (const row of rows) found.add(row.id);
	}
	return found;
}

function albumRow(db: AppDatabase, albumId: string) {
	return db.$client.prepare(`${albumSelect} where id = ?`).get(albumId) as AlbumRow | undefined;
}

function albumExists(db: AppDatabase, albumId: string) {
	return Boolean(db.$client.prepare('select id from albums where id = ?').get(albumId));
}

function savedSearchRow(db: AppDatabase, id: string) {
	return db.$client.prepare(`${savedSearchSelect} where id = ?`).get(id) as
		SavedSearchRow | undefined;
}

function findApplied(db: AppDatabase, applied: AppliedSearch) {
	return db.$client
		.prepare(`${savedSearchSelect} where query = ? and rating = ? and media = ? and sort = ?`)
		.get(
			applied.query,
			JSON.stringify(applied.rating),
			JSON.stringify(applied.media),
			applied.sort
		) as SavedSearchRow | undefined;
}

function readChoiceList<T extends string>(value: unknown, allowed: readonly T[]): T[] | null {
	if (value === undefined) return [...allowed];
	if (!Array.isArray(value)) return null;
	const chosen: T[] = [];
	for (const item of value) {
		if (typeof item !== 'string') return null;
		const match = allowed.find((option) => option.toLowerCase() === item.trim().toLowerCase());
		if (!match) return null;
		if (!chosen.includes(match)) chosen.push(match);
	}
	if (!chosen.length || chosen.length === allowed.length) return [...allowed];
	return allowed.filter((option) => chosen.includes(option));
}

function readSort(value: unknown): SortChoice | null {
	if (value === undefined) return 'Newest';
	if (typeof value !== 'string') return null;
	return sortChoices.find((item) => item.toLowerCase() === value.trim().toLowerCase()) ?? null;
}

function readStoredList<T extends string>(value: string, allowed: readonly T[]): T[] {
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!Array.isArray(parsed)) return [...allowed];
		const list = readChoiceList(parsed, allowed);
		return list ?? [...allowed];
	} catch {
		return [...allowed];
	}
}

function slotId(value: unknown): string | null | undefined {
	const raw = value && typeof value === 'object' && 'itemId' in value ? value.itemId : value;
	if (raw === null) return null;
	if (typeof raw !== 'string') return undefined;
	const id = raw.trim();
	if (!id || id.length > slotLimit || !/^[\w-]+$/.test(id)) return undefined;
	return id;
}

function isUniqueConstraint(error: unknown) {
	return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}

const previewEdge = 96;
const coverChains = new Map<string, Promise<void>>();
const coverPending = new Set<Promise<void>>();

type CoverColumns = {
	coverSaved: number;
	coverAutoStopped: number;
	coverPrimary: string | null;
	coverSupport1: string | null;
	coverSupport2: string | null;
	coverSupport3: string | null;
};

function enqueueCoverWork(key: string, work: () => Promise<void>) {
	const previous = coverChains.get(key) ?? Promise.resolve();
	const task = previous.then(work, work).then(
		() => undefined,
		() => undefined
	);
	coverChains.set(key, task);
	coverPending.add(task);
	void task.finally(() => {
		coverPending.delete(task);
		if (coverChains.get(key) === task) coverChains.delete(key);
	});
	return task;
}

export function settledCoverRefreshes() {
	return Promise.all([...coverPending]).then(() => undefined);
}

/** Run after a post is added. Manual covers and stopped automatic covers stay put. */
export function refreshAutomaticAlbumCover(db: AppDatabase, albumId: string) {
	return enqueueCoverWork(`album:${albumId}`, () => recalculateAlbumCover(db, albumId));
}

export function coverPreviewFile(dataDir: string, itemId: string) {
	if (!/^[\w-]+$/.test(itemId)) return null;
	return join(dataDir, 'media', 'cover-previews', `${itemId}.webp`);
}

export function releaseUnreferencedCoverPreviews(db: AppDatabase) {
	let dataDir: string;
	try {
		dataDir = libraryRoot(db);
	} catch {
		return;
	}
	const directory = join(dataDir, 'media', 'cover-previews');
	let names: string[];
	try {
		names = readdirSync(directory);
	} catch {
		return;
	}
	const referenced = referencedCoverIds(db);
	for (const name of names) {
		if (!name.endsWith('.webp')) continue;
		const itemId = name.slice(0, -'.webp'.length);
		if (referenced.has(itemId)) continue;
		try {
			unlinkSync(join(directory, name));
		} catch {
			/* the preview is already gone */
		}
	}
}

async function recalculateAlbumCover(db: AppDatabase, albumId: string) {
	try {
		const row = albumRow(db, albumId);
		if (!row || row.coverSaved === 1 || row.coverAutoStopped === 1) return;
		const ids = albumMembershipIds(db, albumId);
		const primaryId = row.coverPrimary ?? ids[0];
		if (!primaryId) return;
		const dataDir = libraryRoot(db);
		const primaryImage = localCoverImage(db, dataDir, primaryId);
		if (!primaryImage) return;
		const others: CoverColorCandidate[] = [];
		const seen = new Set<string>([primaryId]);
		for (const id of ids) {
			if (seen.has(id)) continue;
			const image = localCoverImage(db, dataDir, id);
			if (!image) continue;
			seen.add(id);
			others.push({ id, image });
		}
		if (others.length + 1 < 4) return;
		await commitAutomaticCover(
			db,
			'albums',
			albumId,
			row,
			{ id: primaryId, image: primaryImage },
			others
		);
	} catch {
		/* a missing image leaves the automatic cover for the next add */
	}
}

async function recalculateSavedSearch(
	db: AppDatabase,
	id: string,
	results: readonly CoverColorCandidate[]
) {
	try {
		const row = savedSearchRow(db, id);
		if (!row || row.coverSaved === 1 || row.coverAutoStopped === 1) return;
		if (!row.coverPrimary) {
			const first = results.find((item) => item && typeof item.id === 'string' && item.id);
			if (!first || !usableCandidate(first)) return;
		}
		const ordered = distinctUsable(results);
		const primaryId = row.coverPrimary ?? ordered[0]?.id;
		if (!primaryId) return;
		const carried = ordered.find((item) => item.id === primaryId);
		const dataDir = libraryRoot(db);
		const primaryImage = carried?.image ?? localCoverImage(db, dataDir, primaryId);
		if (!primaryImage) return;
		const others = ordered.filter((item) => item.id !== primaryId);
		if (others.length + 1 < 4) return;
		await commitAutomaticCover(
			db,
			'saved_searches',
			id,
			row,
			{ id: primaryId, image: primaryImage },
			others
		);
	} catch {
		/* the next open with results can try again */
	}
}

async function commitAutomaticCover(
	db: AppDatabase,
	table: 'albums' | 'saved_searches',
	id: string,
	row: CoverColumns,
	primary: CoverColorCandidate,
	others: readonly CoverColorCandidate[]
) {
	const match = await matchCoverColors(primary, others);
	const supports = [0, 1, 2].map((index) => match.supports[index]?.id ?? null);
	const stopped = match.stopped ? 1 : 0;
	const changed =
		row.coverPrimary !== primary.id ||
		row.coverSupport1 !== supports[0] ||
		row.coverSupport2 !== supports[1] ||
		row.coverSupport3 !== supports[2] ||
		row.coverAutoStopped !== stopped;
	if (changed) {
		const updated = db.$client
			.prepare(
				`update ${table}
				 set cover_primary = ?,
					 cover_support_1 = ?,
					 cover_support_2 = ?,
					 cover_support_3 = ?,
					 cover_auto_stopped = ?
				 where id = ? and cover_saved = 0 and cover_auto_stopped = 0`
			)
			.run(primary.id, supports[0], supports[1], supports[2], stopped, id);
		if (updated.changes === 0) return;
	}
	const images = new Map<string, Buffer | string>([[primary.id, primary.image]]);
	for (const other of others) images.set(other.id, other.image);
	const dataDir = libraryRoot(db);
	for (const itemId of [primary.id, ...supports]) {
		if (!itemId) continue;
		const image = images.get(itemId) ?? localCoverImage(db, dataDir, itemId);
		if (!image) continue;
		await ensurePreview(dataDir, itemId, image);
	}
	releaseUnreferencedCoverPreviews(db);
}

async function persistSlotPreviews(db: AppDatabase, slots: Array<string | null>) {
	const dataDir = libraryRoot(db);
	for (const itemId of slots) {
		if (!itemId) continue;
		const existing = coverPreviewFile(dataDir, itemId);
		if (existing && existsSync(existing)) continue;
		const image = localCoverImage(db, dataDir, itemId);
		if (!image) continue;
		await ensurePreview(dataDir, itemId, image);
	}
	releaseUnreferencedCoverPreviews(db);
}

async function ensurePreview(dataDir: string, itemId: string, image: Buffer | string) {
	const target = coverPreviewFile(dataDir, itemId);
	if (!target || existsSync(target)) return;
	try {
		const bytes = await sharp(image, {
			limitInputPixels,
			sequentialRead: true,
			pages: 1,
			animated: false
		})
			.rotate()
			.resize(previewEdge, previewEdge, { fit: 'inside', withoutEnlargement: true })
			.webp({ lossless: true })
			.toBuffer();
		const directory = join(dataDir, 'media', 'cover-previews');
		mkdirSync(directory, { recursive: true });
		mkdirSync(join(dataDir, 'tmp'), { recursive: true });
		const tempPath = join(dataDir, 'tmp', `cover-preview-${randomUUID()}`);
		writeFileSync(tempPath, bytes);
		renameSync(tempPath, target);
	} catch {
		/* the slot can still point at the library file until a preview exists */
	}
}

function albumMembershipIds(db: AppDatabase, albumId: string) {
	const rows = db.$client
		.prepare(
			`select album_items.item_id as itemId
			 from album_items
			 join saved_items on saved_items.id = album_items.item_id
			 where album_items.album_id = ?
			 order by album_items.added_at, saved_items.id`
		)
		.all(albumId) as { itemId: string }[];
	return rows.map((row) => row.itemId);
}

function localCoverImage(db: AppDatabase, dataDir: string, itemId: string) {
	const fileUrl = itemFileUrl(db, itemId);
	if (fileUrl) {
		const derivative = derivativePath(db, dataDir, fileUrl);
		if (derivative) return derivative;
	}
	const original = originalPath(db, dataDir, itemId);
	if (original) return original;
	const preview = coverPreviewFile(dataDir, itemId);
	if (preview && existsSync(preview)) return preview;
	return null;
}

function itemFileUrl(db: AppDatabase, itemId: string) {
	const row = db.$client
		.prepare(
			`select post_snapshots.snapshot as snapshot
			 from saved_items
			 join post_snapshots on post_snapshots.id = saved_items.snapshot_id
			 where saved_items.id = ?`
		)
		.get(itemId) as { snapshot: string } | undefined;
	if (!row) return null;
	try {
		const parsed = JSON.parse(row.snapshot) as { fileUrl?: unknown };
		return typeof parsed.fileUrl === 'string' ? parsed.fileUrl : null;
	} catch {
		return null;
	}
}

function derivativePath(db: AppDatabase, dataDir: string, fileUrl: string) {
	let identity: string;
	try {
		identity = canonicalCoverUrl(fileUrl);
	} catch {
		return null;
	}
	const row = db.$client
		.prepare(
			`select relative_path as relativePath
			 from derivatives
			 where source_identity = ? and recipe = ?`
		)
		.get(identity, recipeNames.thumb) as { relativePath: string } | undefined;
	if (!row?.relativePath) return null;
	const path = safeDataPath(dataDir, row.relativePath);
	return path && existsSync(path) ? path : null;
}

function originalPath(db: AppDatabase, dataDir: string, itemId: string) {
	const row = db.$client
		.prepare(
			`select media_objects.relative_path as relativePath
			 from saved_items
			 join media_objects on media_objects.id = saved_items.media_id
			 where saved_items.id = ? and media_objects.state = 'ready'`
		)
		.get(itemId) as { relativePath: string | null } | undefined;
	if (!row?.relativePath) return null;
	const path = safeDataPath(dataDir, row.relativePath);
	return path && existsSync(path) ? path : null;
}

function canonicalCoverUrl(fileUrl: string) {
	const url = new URL(fileUrl);
	url.search = '';
	url.hash = '';
	url.username = '';
	url.password = '';
	return url.toString();
}

function safeDataPath(dataDir: string, relativePath: string) {
	if (!relativePath || relativePath.startsWith('/') || relativePath.includes('..')) return null;
	const absolute = join(dataDir, relativePath);
	const root = join(dataDir, 'media');
	return absolute.startsWith(`${root}/`) || absolute.startsWith(`${root}\\`) ? absolute : null;
}

function referencedCoverIds(db: AppDatabase) {
	const ids = new Set<string>();
	for (const table of ['albums', 'saved_searches'] as const) {
		const rows = db.$client
			.prepare(
				`select cover_primary as coverPrimary,
					cover_support_1 as coverSupport1,
					cover_support_2 as coverSupport2,
					cover_support_3 as coverSupport3
				 from ${table}`
			)
			.all() as Array<Record<string, string | null>>;
		for (const row of rows) {
			for (const id of Object.values(row)) {
				if (id) ids.add(id);
			}
		}
	}
	return ids;
}

function coverPreviewSources(db: AppDatabase, ids: string[]) {
	const sources = new Map<string, string>();
	let dataDir: string;
	try {
		dataDir = libraryRoot(db);
	} catch {
		return sources;
	}
	for (const itemId of new Set(ids)) {
		const path = coverPreviewFile(dataDir, itemId);
		if (!path || !existsSync(path)) continue;
		const bytes = readFileSync(path);
		sources.set(itemId, `data:image/webp;base64,${bytes.toString('base64')}`);
	}
	return sources;
}

function libraryRoot(db: AppDatabase) {
	const file = (db.$client as { name?: string }).name ?? '';
	if (!file || file === ':memory:') throw new Error('cover previews need a database file');
	return dirname(dirname(file));
}

function usableCandidate(candidate: CoverColorCandidate) {
	if (typeof candidate.id !== 'string' || !/^[\w-]+$/.test(candidate.id)) return false;
	if (typeof candidate.image === 'string') {
		return candidate.image.length > 0 && existsSync(candidate.image);
	}
	return Buffer.isBuffer(candidate.image) && candidate.image.length > 0;
}

function distinctUsable(results: readonly CoverColorCandidate[]) {
	const seen = new Set<string>();
	const ordered: CoverColorCandidate[] = [];
	for (const candidate of results) {
		if (!usableCandidate(candidate) || seen.has(candidate.id)) continue;
		seen.add(candidate.id);
		ordered.push(candidate);
	}
	return ordered;
}
