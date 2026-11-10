import * as devalue from 'devalue';
import type {
	AppliedView,
	ExplorationPost,
	ExplorationView,
	ScrollAnchor,
	ViewMode
} from '#lib/navigation.ts';

/** Checkpoint key inside the shared browser record, and the old sessionStorage copy. */
export const WORKSPACE_KEY = 'panbooru-workspace';

/** One set of searches for every tab in this browser. */
export const SHARED_WORKSPACE_KEY = 'panbooru-shared-workspace';

/** Previous per-tab catalog. Read once when the shared record is missing. */
const OLD_CATALOG_KEY = 'panbooru-workspaces';

/** Unflushed checkpoint from the per-tab session. Preferred over a stale catalog body. */
const OLD_PENDING_KEY = 'panbooru-workspace-pending';

const VERSION = 1;
const CLOSED_LIMIT = 30;

export type WorkspaceStore = {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem?(key: string): void;
};

export type CheckpointView = {
	id: string;
	query: string;
	/** Result order. List order is the views array. */
	sort: string;
	posts: ExplorationPost[];
	postId: string | null;
	mode: ViewMode;
	scroll: number;
	scrollAnchor: ScrollAnchor | null;
	applied?: AppliedView;
};

/** A temporary album open in this tab, or one waiting on Shift+T. */
export type TemporaryAlbumEntry = {
	id: string;
	query: string;
	sort: string;
	scroll: number;
	scrollAnchor: ScrollAnchor | null;
	postId: string | null;
	mode: ViewMode;
};

export type ClosedCheckpoint =
	{ kind: 'view'; view: CheckpointView } | ({ kind: 'album' } & TemporaryAlbumEntry);

export type WorkspaceCheckpoint = {
	version: typeof VERSION;
	views: CheckpointView[];
	activeId: string;
	temporaryAlbums: TemporaryAlbumEntry[];
	closed: ClosedCheckpoint[];
};

export type WorkspaceDraft = {
	views: readonly unknown[];
	activeId: unknown;
	temporaryAlbums?: readonly unknown[];
	closed?: readonly unknown[];
};

export function readCheckpoint(store: WorkspaceStore): WorkspaceCheckpoint | null {
	try {
		const raw = store.getItem(WORKSPACE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object') return null;
		if ((parsed as { version?: unknown }).version !== VERSION) return null;
		return sanitize(parsed as WorkspaceDraft);
	} catch {
		return null;
	}
}

export function saveCheckpoint(store: WorkspaceStore, draft: WorkspaceDraft): WorkspaceCheckpoint {
	const checkpoint = sanitize(draft);
	write(store, checkpoint);
	return checkpoint;
}

/** Merge one part of the checkpoint without dropping the rest. */
export function patchCheckpoint(
	store: WorkspaceStore,
	patch: Partial<WorkspaceDraft>
): WorkspaceCheckpoint {
	const current = readCheckpoint(store);
	return saveCheckpoint(store, {
		views: patch.views ?? current?.views ?? [],
		activeId: patch.activeId ?? current?.activeId ?? '',
		temporaryAlbums: patch.temporaryAlbums ?? current?.temporaryAlbums ?? [],
		closed: patch.closed ?? current?.closed ?? []
	});
}

export function toCheckpointView(view: ExplorationView): CheckpointView {
	const applied = view.applied
		? {
				query: view.applied.query,
				rating: [...view.applied.rating],
				media: [...view.applied.media],
				sort: view.applied.sort,
				...(view.applied.seed !== undefined ? { seed: view.applied.seed } : {})
			}
		: undefined;
	return {
		id: view.id,
		query: view.query,
		sort: applied?.sort ?? 'Newest',
		posts: view.posts.map((post) => ({
			id: post.id,
			width: post.width,
			height: post.height,
			tags: [...post.tags],
			mediaRef: post.mediaRef,
			...(post.rating ? { rating: post.rating } : {}),
			...(typeof post.score === 'number' && Number.isFinite(post.score)
				? { score: post.score }
				: {}),
			...(typeof post.fileSize === 'number' && Number.isFinite(post.fileSize) && post.fileSize >= 0
				? { fileSize: post.fileSize }
				: {}),
			...(typeof post.postedAt === 'number' && Number.isFinite(post.postedAt)
				? { postedAt: post.postedAt }
				: {}),
			...(post.kind ? { kind: post.kind } : {}),
			...(post.mediaType ? { mediaType: post.mediaType } : {})
		})),
		postId: view.postId,
		mode: view.mode,
		scroll: view.scroll,
		scrollAnchor: view.scrollAnchor ? { ...view.scrollAnchor } : null,
		...(applied ? { applied } : {})
	};
}

export function checkpointFromViews(
	views: readonly ExplorationView[],
	activeId: string
): WorkspaceDraft {
	return { views: views.map((view) => toCheckpointView(view)), activeId };
}

export function explorationViews(views: readonly CheckpointView[]): ExplorationView[] {
	return views.map((view) => ({
		id: view.id,
		query: view.query,
		posts: view.posts.map((post) => ({ ...post })),
		postId: view.postId,
		mode: view.mode,
		scroll: view.scroll,
		scrollAnchor: view.scrollAnchor ? { ...view.scrollAnchor } : null,
		...(view.applied
			? {
					applied: {
						query: view.applied.query,
						rating: [...view.applied.rating],
						media: [...view.applied.media],
						sort: view.applied.sort,
						...(view.applied.seed !== undefined ? { seed: view.applied.seed } : {})
					}
				}
			: {})
	}));
}

/** Keep album workspace fields while the sidebar order changes. */
export function retainTemporaryAlbums(store: WorkspaceStore, ids: readonly string[]) {
	const current = readCheckpoint(store);
	const previous = new Map((current?.temporaryAlbums ?? []).map((album) => [album.id, album]));
	const temporaryAlbums = ids.map((id) => previous.get(id) ?? blankAlbum(id));
	patchCheckpoint(store, { temporaryAlbums });
}

export function temporaryAlbum(store: WorkspaceStore, id: string): TemporaryAlbumEntry | null {
	return readCheckpoint(store)?.temporaryAlbums.find((album) => album.id === id) ?? null;
}

/** SvelteKit stores shallow `page.state` here, serialized with devalue. */
const HISTORY_METADATA_KEY = 'sveltekit:metadata';

export type HistoryCursor = { cursor: number };

export function readHistoryCursor(state: unknown): number {
	const direct = cursorOf(state);
	if (direct !== null) return direct;
	if (!isRecord(state)) return 0;
	const metadata = state[HISTORY_METADATA_KEY];
	if (!isRecord(metadata) || typeof metadata.state !== 'string') return 0;
	try {
		return cursorOf(devalue.parse(metadata.state)) ?? 0;
	} catch {
		return 0;
	}
}

/**
 * Mark the current history entry with its cursor.
 * Replace, never push: a reload must not add a second copy of this entry.
 * The entry only carries a cursor, which is not enough to rebuild earlier result snapshots.
 */
export function rehydrateHistory(state: unknown, replace: (state: HistoryCursor) => void): number {
	const cursor = readHistoryCursor(state);
	replace({ cursor });
	return cursor;
}

function write(store: WorkspaceStore, checkpoint: WorkspaceCheckpoint) {
	store.setItem(WORKSPACE_KEY, JSON.stringify(checkpoint));
}

function sanitize(draft: WorkspaceDraft): WorkspaceCheckpoint {
	const views = draft.views.map(viewFrom).filter((view): view is CheckpointView => view !== null);
	const activeId = typeof draft.activeId === 'string' ? draft.activeId : '';
	return {
		version: VERSION,
		views,
		activeId: views.some((view) => view.id === activeId) ? activeId : (views[0]?.id ?? ''),
		temporaryAlbums: (draft.temporaryAlbums ?? []).map(albumFrom).filter((album) => album !== null),
		closed: (draft.closed ?? [])
			.map(closedFrom)
			.filter((entry): entry is ClosedCheckpoint => entry !== null)
			.slice(0, CLOSED_LIMIT)
	};
}

function viewFrom(value: unknown): CheckpointView | null {
	if (!isRecord(value)) return null;
	if (typeof value.id !== 'string' || typeof value.query !== 'string') return null;
	const applied = appliedFrom(value.applied);
	const sort = typeof value.sort === 'string' ? value.sort : (applied?.sort ?? 'Newest');
	return {
		id: value.id,
		query: value.query,
		sort,
		posts: postsFrom(value.posts),
		postId: typeof value.postId === 'string' ? value.postId : null,
		mode: value.mode === 'viewer' ? 'viewer' : 'gallery',
		scroll: scrollFrom(value.scroll),
		scrollAnchor: anchorFrom(value.scrollAnchor),
		...(applied ? { applied: { ...applied, sort: applied.sort } } : {})
	};
}

function albumFrom(value: unknown): TemporaryAlbumEntry | null {
	if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return null;
	const query = typeof value.query === 'string' ? value.query : '';
	return {
		id: value.id,
		query,
		sort: typeof value.sort === 'string' ? value.sort : 'Newest',
		scroll: scrollFrom(value.scroll),
		scrollAnchor: anchorFrom(value.scrollAnchor),
		postId: typeof value.postId === 'string' ? value.postId : null,
		mode: value.mode === 'viewer' ? 'viewer' : 'gallery'
	};
}

function closedFrom(value: unknown): ClosedCheckpoint | null {
	if (!isRecord(value)) return null;
	if (value.kind === 'view') {
		const view = viewFrom(value.view);
		return view ? { kind: 'view', view } : null;
	}
	if (value.kind !== 'album') return null;
	const album = albumFrom(value);
	return album ? { kind: 'album', ...album } : null;
}

function postsFrom(value: unknown): ExplorationPost[] {
	if (!Array.isArray(value)) return [];
	return value.map(postFrom).filter((post): post is ExplorationPost => post !== null);
}

function postFrom(value: unknown): ExplorationPost | null {
	if (!isRecord(value)) return null;
	if (typeof value.id !== 'string' || typeof value.mediaRef !== 'string') return null;
	if (typeof value.width !== 'number' || typeof value.height !== 'number') return null;
	if (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== 'string')) return null;
	const kind = value.kind === 'image' || value.kind === 'video' ? value.kind : undefined;
	const score = value.score;
	const fileSize = value.fileSize;
	const postedAt = value.postedAt;
	return {
		id: value.id,
		width: value.width,
		height: value.height,
		tags: [...value.tags],
		mediaRef: value.mediaRef,
		...(typeof value.rating === 'string' ? { rating: value.rating } : {}),
		...(typeof score === 'number' && Number.isFinite(score) ? { score } : {}),
		...(typeof fileSize === 'number' && Number.isFinite(fileSize) && fileSize >= 0
			? { fileSize }
			: {}),
		...(typeof postedAt === 'number' && Number.isFinite(postedAt) ? { postedAt } : {}),
		...(kind ? { kind } : {}),
		...(typeof value.mediaType === 'string' ? { mediaType: value.mediaType } : {})
	};
}

function appliedFrom(value: unknown): AppliedView | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.query !== 'string' || typeof value.sort !== 'string') return undefined;
	if (!stringArray(value.rating) || !stringArray(value.media)) return undefined;
	return {
		query: value.query,
		rating: [...value.rating],
		media: [...value.media],
		sort: value.sort,
		...(typeof value.seed === 'number' && Number.isFinite(value.seed) ? { seed: value.seed } : {})
	};
}

function anchorFrom(value: unknown): ScrollAnchor | null {
	if (!isRecord(value) || typeof value.id !== 'string') return null;
	return { id: value.id, offset: scrollFrom(value.offset) };
}

function scrollFrom(value: unknown) {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function blankAlbum(id: string): TemporaryAlbumEntry {
	return {
		id,
		query: '',
		sort: 'Newest',
		scroll: 0,
		scrollAnchor: null,
		postId: null,
		mode: 'gallery'
	};
}

function cursorOf(state: unknown): number | null {
	if (!isRecord(state)) return null;
	const cursor = state.cursor;
	return typeof cursor === 'number' && Number.isFinite(cursor) ? cursor : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

const SHARED_VERSION = 1;

/** The searches every tab in this browser shares. `updatedAt` is milliseconds. */
export type SharedWorkspace = {
	version: typeof SHARED_VERSION;
	updatedAt: number;
	checkpoint: WorkspaceCheckpoint;
};

export function readSharedWorkspace(store: WorkspaceStore): SharedWorkspace | null {
	try {
		const raw = store.getItem(SHARED_WORKSPACE_KEY);
		if (!raw) return null;
		return sharedFrom(JSON.parse(raw) as unknown);
	} catch {
		return null;
	}
}

/**
 * Write the shared searches. An unchanged checkpoint is left in place so other tabs
 * are not notified again.
 */
export function writeSharedWorkspace(
	store: WorkspaceStore,
	checkpoint: WorkspaceCheckpoint,
	updatedAt: number
): { shared: SharedWorkspace; persisted: boolean } {
	const shared: SharedWorkspace = {
		version: SHARED_VERSION,
		updatedAt,
		checkpoint: sanitize(checkpoint)
	};
	const existing = readSharedWorkspace(store);
	if (existing && JSON.stringify(existing.checkpoint) === JSON.stringify(shared.checkpoint)) {
		return { shared: existing, persisted: true };
	}
	try {
		store.setItem(SHARED_WORKSPACE_KEY, JSON.stringify(shared));
		return { shared, persisted: true };
	} catch {
		return { shared, persisted: false };
	}
}

/**
 * Use the shared record when it exists. Otherwise keep the newest leftover from the
 * per-tab catalog, an unflushed session copy, or the original session checkpoint.
 */
export function adoptSharedWorkspace(
	local: WorkspaceStore,
	session: WorkspaceStore,
	now: number
): SharedWorkspace | null {
	const current = readSharedWorkspace(local);
	if (current) return current;
	const pending = readCheckpoint({
		getItem: (key) => (key === WORKSPACE_KEY ? session.getItem(OLD_PENDING_KEY) : null),
		setItem() {
			// Adoption only reads the leftover pending checkpoint.
		}
	});
	const catalog = newestCatalogCheckpoint(local);
	const legacy = readCheckpoint(session);
	const chosen = checkpointIsSearch(pending)
		? { updatedAt: now, checkpoint: pending }
		: catalog
			? catalog
			: pending?.views.length
				? { updatedAt: now, checkpoint: pending }
				: legacy?.views.length
					? { updatedAt: now, checkpoint: legacy }
					: null;
	if (!chosen) return null;
	const saved = writeSharedWorkspace(local, chosen.checkpoint, chosen.updatedAt);
	if (!saved.persisted) return saved.shared;
	session.removeItem?.(WORKSPACE_KEY);
	session.removeItem?.(OLD_PENDING_KEY);
	return saved.shared;
}

function newestCatalogCheckpoint(
	store: WorkspaceStore
): { updatedAt: number; checkpoint: WorkspaceCheckpoint } | null {
	try {
		const raw = store.getItem(OLD_CATALOG_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as unknown;
		if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.entries)) return null;
		let best: { updatedAt: number; checkpoint: WorkspaceCheckpoint } | null = null;
		for (const entry of parsed.entries) {
			if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id) continue;
			if (typeof entry.updatedAt !== 'number' || !Number.isFinite(entry.updatedAt)) continue;
			const body = store.getItem(`${OLD_CATALOG_KEY}:${entry.id}`);
			if (!body) continue;
			const checkpoint = sharedCheckpoint(JSON.parse(body) as unknown);
			if (!checkpoint || !checkpointHasContent(checkpoint)) continue;
			if (!best || entry.updatedAt >= best.updatedAt) {
				best = { updatedAt: entry.updatedAt, checkpoint };
			}
		}
		return best;
	} catch {
		return null;
	}
}

function sharedFrom(value: unknown): SharedWorkspace | null {
	if (!isRecord(value) || value.version !== SHARED_VERSION) return null;
	if (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)) return null;
	const checkpoint = sharedCheckpoint(value.checkpoint);
	if (!checkpoint) return null;
	return { version: SHARED_VERSION, updatedAt: value.updatedAt, checkpoint };
}

function sharedCheckpoint(value: unknown): WorkspaceCheckpoint | null {
	if (!isRecord(value)) return null;
	return sanitize({
		views: Array.isArray(value.views) ? value.views : [],
		activeId: value.activeId,
		temporaryAlbums: Array.isArray(value.temporaryAlbums) ? value.temporaryAlbums : [],
		closed: Array.isArray(value.closed) ? value.closed : []
	});
}

function checkpointHasContent(checkpoint: WorkspaceCheckpoint) {
	return (
		checkpoint.views.length > 0 ||
		checkpoint.temporaryAlbums.length > 0 ||
		checkpoint.closed.length > 0
	);
}

function checkpointIsSearch(checkpoint: WorkspaceCheckpoint | null) {
	if (!checkpoint) return false;
	return (
		checkpoint.views.some((view) => view.query.trim().length > 0 || view.posts.length > 0) ||
		checkpoint.temporaryAlbums.some((album) => album.query.trim().length > 0) ||
		checkpoint.closed.length > 0
	);
}
