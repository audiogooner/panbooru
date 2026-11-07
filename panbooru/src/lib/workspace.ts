import * as devalue from 'devalue';
import type {
	AppliedView,
	ExplorationPost,
	ExplorationView,
	ScrollAnchor,
	ViewMode
} from '#lib/navigation.ts';

/** Tab session only. A browser restart drops this store; do not copy it to localStorage. */
export const WORKSPACE_KEY = 'panbooru-workspace';

const VERSION = 1;
const CLOSED_LIMIT = 30;

export type WorkspaceStore = {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
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
				sort: view.applied.sort
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
						sort: view.applied.sort
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
	return {
		id: value.id,
		width: value.width,
		height: value.height,
		tags: [...value.tags],
		mediaRef: value.mediaRef,
		...(typeof value.rating === 'string' ? { rating: value.rating } : {}),
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
		sort: value.sort
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
