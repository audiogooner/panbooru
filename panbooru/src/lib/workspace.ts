import * as devalue from 'devalue';
import type {
	AppliedView,
	ExplorationPost,
	ExplorationView,
	ScrollAnchor,
	ViewMode
} from '#lib/navigation.ts';

/**
 * Legacy session checkpoint key. A tab imports this once into the browser catalog,
 * then deletes it. New writes go to {@link WORKSPACE_CATALOG_KEY}.
 */
export const WORKSPACE_KEY = 'panbooru-workspace';

/**
 * Index of workspace ids in this browser. Each checkpoint is stored on its own key
 * so one tab cannot overwrite another's searches.
 */
export const WORKSPACE_CATALOG_KEY = 'panbooru-workspaces';

/** localStorage key for one workspace checkpoint body. */
export function workspaceRecordKey(id: string) {
	return `${WORKSPACE_CATALOG_KEY}:${id}`;
}

/** Which tab currently holds each workspace. A released or stale lease is free to adopt. */
export const WORKSPACE_LEASES_KEY = 'panbooru-workspace-leases';

/** This tab's id. sessionStorage, so a reload keeps it and a duplicated tab copies it. */
export const WORKSPACE_TAB_KEY = 'panbooru-tab';

/** Workspace this tab claimed. sessionStorage, same lifetime as {@link WORKSPACE_TAB_KEY}. */
export const WORKSPACE_ID_KEY = 'panbooru-workspace-id';

/** Free workspaces beyond this count are dropped, oldest first. A leased record stays. */
export const WORKSPACE_KEEP_LIMIT = 8;

/** A lease with no heartbeat for this long is free. A crash never sends pagehide. */
export const LEASE_STALE_MS = 6_000;

/** How often a live tab refreshes its lease. */
export const LEASE_HEARTBEAT_MS = 2_000;

/** Wait this long for another tab to answer a copied tab id. */
export const WORKSPACE_HELLO_MS = 100;

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

const CATALOG_VERSION = 1;
const LEASE_VERSION = 1;

/** A saved workspace in this browser. `updatedAt` is milliseconds. */
export type WorkspaceRecord = {
	id: string;
	updatedAt: number;
	checkpoint: WorkspaceCheckpoint;
};

export type WorkspaceCatalog = {
	version: typeof CATALOG_VERSION;
	workspaces: WorkspaceRecord[];
};

export type WorkspaceLease = {
	workspaceId: string;
	tabId: string;
	seenAt: number;
	released: boolean;
};

export type WorkspaceLeases = {
	version: typeof LEASE_VERSION;
	leases: WorkspaceLease[];
};

export type SessionIdentity = {
	tabId: string | null;
	workspaceId: string | null;
};

export type WorkspaceClaim = {
	tabId: string;
	workspaceId: string;
	/** True when this tab started a blank workspace instead of adopting one. */
	created: boolean;
	/** Null when the tab should start from a fresh navigation state. */
	checkpoint: WorkspaceCheckpoint | null;
	catalog: WorkspaceCatalog;
	leases: WorkspaceLeases;
};

export function emptyCatalog(): WorkspaceCatalog {
	return { version: CATALOG_VERSION, workspaces: [] };
}

export function emptyLeases(): WorkspaceLeases {
	return { version: LEASE_VERSION, leases: [] };
}

export function readCatalog(store: WorkspaceStore): WorkspaceCatalog {
	try {
		const entries = readIndex(store).entries;
		const workspaces: WorkspaceRecord[] = [];
		for (const entry of entries) {
			try {
				const raw = store.getItem(workspaceRecordKey(entry.id));
				if (!raw) continue;
				const record = recordFrom({
					id: entry.id,
					updatedAt: entry.updatedAt,
					checkpoint: JSON.parse(raw) as unknown
				});
				if (record) workspaces.push(record);
			} catch {
				// Skip a damaged body. The index entry stays until eviction.
			}
		}
		return { version: CATALOG_VERSION, workspaces };
	} catch {
		return emptyCatalog();
	}
}

export function readLeases(store: WorkspaceStore): WorkspaceLeases {
	try {
		const raw = store.getItem(WORKSPACE_LEASES_KEY);
		if (!raw) return emptyLeases();
		return leasesFrom(JSON.parse(raw) as unknown);
	} catch {
		return emptyLeases();
	}
}

export function readSessionIdentity(store: WorkspaceStore): SessionIdentity {
	try {
		return {
			tabId: textOrNull(store.getItem(WORKSPACE_TAB_KEY)),
			workspaceId: textOrNull(store.getItem(WORKSPACE_ID_KEY))
		};
	} catch {
		return { tabId: null, workspaceId: null };
	}
}

export function writeSessionIdentity(store: WorkspaceStore, identity: SessionIdentity) {
	if (identity.tabId) store.setItem(WORKSPACE_TAB_KEY, identity.tabId);
	if (identity.workspaceId) store.setItem(WORKSPACE_ID_KEY, identity.workspaceId);
}

/** A live lease is held by an open tab. Released and stale leases are free. */
export function leaseIsLive(lease: WorkspaceLease, now: number) {
	return !lease.released && now - lease.seenAt <= LEASE_STALE_MS;
}

export function mergeLease(leases: WorkspaceLeases, lease: WorkspaceLease): WorkspaceLeases {
	return {
		version: LEASE_VERSION,
		leases: [
			...leases.leases.filter((item) => item.workspaceId !== lease.workspaceId),
			{ ...lease }
		]
	};
}

/**
 * Refresh this tab's lease. A different live tab keeps the workspace.
 * Returns `held: false` when that happens.
 */
export function holdLease(
	leases: WorkspaceLeases,
	workspaceId: string,
	tabId: string,
	now: number
): { leases: WorkspaceLeases; held: boolean } {
	const existing = leases.leases.find((lease) => lease.workspaceId === workspaceId);
	if (existing && leaseIsLive(existing, now) && existing.tabId !== tabId) {
		return { leases, held: false };
	}
	return {
		held: true,
		leases: mergeLease(leases, { workspaceId, tabId, seenAt: now, released: false })
	};
}

/** Mark this tab's lease free. The checkpoint stays in the catalog. */
export function releaseLease(
	leases: WorkspaceLeases,
	workspaceId: string,
	tabId: string,
	now: number
): WorkspaceLeases {
	const existing = leases.leases.find((lease) => lease.workspaceId === workspaceId);
	if (!existing || existing.tabId !== tabId) return leases;
	return mergeLease(leases, { ...existing, seenAt: now, released: true });
}

export function heartbeatLease(
	leases: WorkspaceLeases,
	workspaceId: string,
	tabId: string,
	now: number
): WorkspaceLeases {
	const existing = leases.leases.find((lease) => lease.workspaceId === workspaceId);
	if (existing && existing.tabId !== tabId) return leases;
	return mergeLease(leases, { workspaceId, tabId, seenAt: now, released: false });
}

/**
 * Pick the workspace this tab may write.
 * A reload keeps its own record. A new tab takes the newest free one.
 * A contested tab id, or a record another live tab holds, adopts a different free record or starts blank.
 */
export function chooseWorkspace(input: {
	session: SessionIdentity;
	catalog: WorkspaceCatalog;
	leases: WorkspaceLeases;
	now: number;
	contested: boolean;
	nextTabId: string;
	nextWorkspaceId: string;
}): WorkspaceClaim {
	const catalog = cloneCatalog(input.catalog);
	const leases = cloneLeases(input.leases);
	const session = input.session;
	if (!input.contested && session.tabId && session.workspaceId) {
		const owned = catalog.workspaces.find((workspace) => workspace.id === session.workspaceId);
		const lease = leases.leases.find((item) => item.workspaceId === session.workspaceId);
		const blocked = !!lease && leaseIsLive(lease, input.now) && lease.tabId !== session.tabId;
		if (owned && !blocked) {
			return claimRecord(catalog, leases, session.tabId, owned, input.now, false);
		}
	}
	const tabId = !input.contested && session.tabId ? session.tabId : input.nextTabId;
	const free = catalog.workspaces
		.filter(
			(workspace) =>
				workspaceHasContent(workspace) && workspaceIsFree(leases, workspace.id, input.now)
		)
		.sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1));
	const chosen = free[0];
	if (!chosen) {
		return claimRecord(
			catalog,
			leases,
			tabId,
			{
				id: input.nextWorkspaceId,
				updatedAt: input.now,
				checkpoint: emptyCheckpoint()
			},
			input.now,
			true
		);
	}
	return claimRecord(catalog, leases, tabId, chosen, input.now, false);
}

/** Insert or replace one record, then drop the oldest free records past the keep limit. */
export function upsertWorkspaceRecord(
	catalog: WorkspaceCatalog,
	leases: WorkspaceLeases,
	record: WorkspaceRecord,
	now: number
): { catalog: WorkspaceCatalog; leases: WorkspaceLeases } {
	const next = cloneCatalog(catalog);
	const leaseCopy = cloneLeases(leases);
	const index = next.workspaces.findIndex((workspace) => workspace.id === record.id);
	const saved = {
		id: record.id,
		updatedAt: record.updatedAt,
		checkpoint: sanitize(record.checkpoint)
	};
	if (index >= 0) next.workspaces[index] = saved;
	else next.workspaces.push(saved);
	return evictWorkspaces(next, leaseCopy, now, record.id);
}

/**
 * Write one workspace body and its index entry. Other records stay as they are.
 * On quota failure, drop the oldest free record and retry. `record.id` is never dropped.
 */
export function saveWorkspaceRecord(
	store: WorkspaceStore,
	leases: WorkspaceLeases,
	record: WorkspaceRecord,
	now: number
): { catalog: WorkspaceCatalog; persisted: boolean } {
	const saved: WorkspaceRecord = {
		id: record.id,
		updatedAt: record.updatedAt,
		checkpoint: sanitize(record.checkpoint)
	};
	let persisted = writeBody(store, saved);
	if (!persisted) {
		for (;;) {
			const catalog = readCatalog(store);
			const shrunk = dropOldestFree(catalog, leases, record.id, now);
			if (shrunk.workspaces.length === catalog.workspaces.length) break;
			const drop = catalog.workspaces.find(
				(workspace) => !shrunk.workspaces.some((item) => item.id === workspace.id)
			);
			if (!drop) break;
			forgetWorkspace(store, drop.id);
			persisted = writeBody(store, saved);
			if (persisted) break;
		}
	}
	if (persisted) noteWorkspace(store, saved.id, saved.updatedAt);
	return { catalog: evictStored(store, leases, now, record.id), persisted };
}

/** Put this workspace back on the index without rewriting its checkpoint. */
export function noteWorkspace(store: WorkspaceStore, id: string, updatedAt: number) {
	mergeIndex(store, { id, updatedAt });
}

export function writeLeases(store: WorkspaceStore, leases: WorkspaceLeases): boolean {
	try {
		store.setItem(WORKSPACE_LEASES_KEY, JSON.stringify(leases));
		return true;
	} catch {
		return false;
	}
}

/**
 * Copy a legacy session checkpoint into an empty catalog.
 * Returns null when the catalog already has workspaces or the legacy checkpoint has no views.
 */
export function importLegacyCheckpoint(
	catalog: WorkspaceCatalog,
	legacy: WorkspaceCheckpoint | null,
	now: number,
	workspaceId: string
): WorkspaceCatalog | null {
	if (catalog.workspaces.length > 0) return null;
	if (!legacy || legacy.views.length === 0) return null;
	return upsertWorkspaceRecord(
		catalog,
		emptyLeases(),
		{ id: workspaceId, updatedAt: now, checkpoint: legacy },
		now
	).catalog;
}

function claimRecord(
	catalog: WorkspaceCatalog,
	leases: WorkspaceLeases,
	tabId: string,
	record: WorkspaceRecord,
	now: number,
	created: boolean
): WorkspaceClaim {
	const next = cloneCatalog(catalog);
	const index = next.workspaces.findIndex((workspace) => workspace.id === record.id);
	const saved = {
		id: record.id,
		updatedAt: record.updatedAt,
		checkpoint: record.checkpoint
	};
	if (index >= 0) next.workspaces[index] = saved;
	else next.workspaces.push(saved);
	const held = holdLease(leases, record.id, tabId, now);
	const evicted = evictWorkspaces(next, held.leases, now, record.id);
	return {
		tabId,
		workspaceId: record.id,
		created,
		checkpoint: created ? null : record.checkpoint,
		catalog: evicted.catalog,
		leases: evicted.leases
	};
}

function evictWorkspaces(
	catalog: WorkspaceCatalog,
	leases: WorkspaceLeases,
	now: number,
	keepId: string
): { catalog: WorkspaceCatalog; leases: WorkspaceLeases } {
	let current = catalog;
	let leaseCopy = leases;
	while (current.workspaces.length > WORKSPACE_KEEP_LIMIT) {
		const shrunk = dropOldestFree(current, leaseCopy, keepId, now);
		if (shrunk.workspaces.length === current.workspaces.length) break;
		current = shrunk;
		leaseCopy = {
			version: LEASE_VERSION,
			leases: leaseCopy.leases.filter((lease) =>
				current.workspaces.some((workspace) => workspace.id === lease.workspaceId)
			)
		};
	}
	return { catalog: current, leases: leaseCopy };
}

function dropOldestFree(
	catalog: WorkspaceCatalog,
	leases: WorkspaceLeases,
	keepId: string,
	now: number
): WorkspaceCatalog {
	const free = catalog.workspaces.filter(
		(workspace) => workspace.id !== keepId && workspaceIsFree(leases, workspace.id, now)
	);
	const empty = free.filter((workspace) => !workspaceHasContent(workspace));
	const pool = (empty.length > 0 ? empty : free).sort(
		(a, b) => a.updatedAt - b.updatedAt || (a.id < b.id ? -1 : 1)
	);
	const drop = pool[0];
	if (!drop) return catalog;
	return {
		version: CATALOG_VERSION,
		workspaces: catalog.workspaces.filter((workspace) => workspace.id !== drop.id)
	};
}

function workspaceIsFree(leases: WorkspaceLeases, workspaceId: string, now: number) {
	const lease = leases.leases.find((item) => item.workspaceId === workspaceId);
	return !lease || !leaseIsLive(lease, now);
}

function workspaceHasContent(record: WorkspaceRecord) {
	const checkpoint = record.checkpoint;
	return (
		checkpoint.views.length > 0 ||
		checkpoint.temporaryAlbums.length > 0 ||
		checkpoint.closed.length > 0
	);
}

function emptyCheckpoint(): WorkspaceCheckpoint {
	return { version: VERSION, views: [], activeId: '', temporaryAlbums: [], closed: [] };
}

function cloneCatalog(catalog: WorkspaceCatalog): WorkspaceCatalog {
	return {
		version: CATALOG_VERSION,
		workspaces: catalog.workspaces.map((record) => ({
			id: record.id,
			updatedAt: record.updatedAt,
			checkpoint: sanitize(record.checkpoint)
		}))
	};
}

function cloneLeases(leases: WorkspaceLeases): WorkspaceLeases {
	return {
		version: LEASE_VERSION,
		leases: leases.leases.map((lease) => ({ ...lease }))
	};
}

type WorkspaceIndexEntry = { id: string; updatedAt: number };

function readIndex(store: WorkspaceStore): { entries: WorkspaceIndexEntry[] } {
	try {
		const raw = store.getItem(WORKSPACE_CATALOG_KEY);
		if (!raw) return { entries: [] };
		const parsed = JSON.parse(raw) as unknown;
		if (!isRecord(parsed) || parsed.version !== CATALOG_VERSION || !Array.isArray(parsed.entries)) {
			return { entries: [] };
		}
		const entries: WorkspaceIndexEntry[] = [];
		for (const entry of parsed.entries) {
			if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id) continue;
			if (typeof entry.updatedAt !== 'number' || !Number.isFinite(entry.updatedAt)) continue;
			entries.push({ id: entry.id, updatedAt: entry.updatedAt });
		}
		return { entries };
	} catch {
		return { entries: [] };
	}
}

function writeBody(store: WorkspaceStore, record: WorkspaceRecord) {
	try {
		store.setItem(workspaceRecordKey(record.id), JSON.stringify(record.checkpoint));
		return true;
	} catch {
		return false;
	}
}

function mergeIndex(store: WorkspaceStore, entry: WorkspaceIndexEntry) {
	for (let attempt = 0; attempt < 5; attempt++) {
		const index = readIndex(store);
		const entries = [...index.entries.filter((item) => item.id !== entry.id), entry];
		try {
			store.setItem(WORKSPACE_CATALOG_KEY, JSON.stringify({ version: CATALOG_VERSION, entries }));
		} catch {
			return;
		}
		const seen = readIndex(store);
		const mine = seen.entries.some(
			(item) => item.id === entry.id && item.updatedAt === entry.updatedAt
		);
		const kept = index.entries.every(
			(item) => item.id === entry.id || seen.entries.some((other) => other.id === item.id)
		);
		if (mine && kept) return;
	}
}

function forgetWorkspace(store: WorkspaceStore, id: string) {
	store.removeItem?.(workspaceRecordKey(id));
	for (let attempt = 0; attempt < 5; attempt++) {
		const index = readIndex(store);
		const entries = index.entries.filter((item) => item.id !== id);
		try {
			store.setItem(WORKSPACE_CATALOG_KEY, JSON.stringify({ version: CATALOG_VERSION, entries }));
		} catch {
			return;
		}
		const seen = readIndex(store);
		if (seen.entries.some((item) => item.id === id)) continue;
		const kept = entries.every((item) => seen.entries.some((other) => other.id === item.id));
		if (kept) return;
	}
}

function evictStored(
	store: WorkspaceStore,
	leases: WorkspaceLeases,
	now: number,
	keepId: string
): WorkspaceCatalog {
	let catalog = readCatalog(store);
	while (catalog.workspaces.length > WORKSPACE_KEEP_LIMIT) {
		const shrunk = dropOldestFree(catalog, leases, keepId, now);
		if (shrunk.workspaces.length === catalog.workspaces.length) break;
		const drop = catalog.workspaces.find(
			(workspace) => !shrunk.workspaces.some((item) => item.id === workspace.id)
		);
		if (!drop) break;
		forgetWorkspace(store, drop.id);
		catalog = readCatalog(store);
	}
	return catalog;
}

function recordFrom(value: unknown): WorkspaceRecord | null {
	if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return null;
	if (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)) return null;
	if (!isRecord(value.checkpoint)) return null;
	return {
		id: value.id,
		updatedAt: value.updatedAt,
		checkpoint: sanitize({
			views: Array.isArray(value.checkpoint.views) ? value.checkpoint.views : [],
			activeId: value.checkpoint.activeId,
			temporaryAlbums: Array.isArray(value.checkpoint.temporaryAlbums)
				? value.checkpoint.temporaryAlbums
				: [],
			closed: Array.isArray(value.checkpoint.closed) ? value.checkpoint.closed : []
		})
	};
}

function leasesFrom(value: unknown): WorkspaceLeases {
	if (!isRecord(value) || value.version !== LEASE_VERSION || !Array.isArray(value.leases)) {
		return emptyLeases();
	}
	return {
		version: LEASE_VERSION,
		leases: value.leases.map(leaseFrom).filter((lease): lease is WorkspaceLease => lease !== null)
	};
}

function leaseFrom(value: unknown): WorkspaceLease | null {
	if (!isRecord(value)) return null;
	if (typeof value.workspaceId !== 'string' || !value.workspaceId) return null;
	if (typeof value.tabId !== 'string' || !value.tabId) return null;
	if (typeof value.seenAt !== 'number' || !Number.isFinite(value.seenAt)) return null;
	return {
		workspaceId: value.workspaceId,
		tabId: value.tabId,
		seenAt: value.seenAt,
		released: value.released === true
	};
}

function textOrNull(value: string | null) {
	return value && value.trim() ? value : null;
}
