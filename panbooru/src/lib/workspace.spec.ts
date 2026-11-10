import * as devalue from 'devalue';
import { describe, expect, it } from 'vitest';
import { back, forward, replaceTag, restoreNavigation } from '#lib/navigation.ts';
import {
	LEASE_STALE_MS,
	WORKSPACE_KEY,
	WORKSPACE_KEEP_LIMIT,
	checkpointFromViews,
	chooseWorkspace,
	emptyCatalog,
	emptyLeases,
	explorationViews,
	importLegacyCheckpoint,
	patchCheckpoint,
	readCatalog,
	readCheckpoint,
	readHistoryCursor,
	rehydrateHistory,
	releaseLease,
	retainTemporaryAlbums,
	saveCheckpoint,
	saveWorkspaceRecord,
	type WorkspaceRecord,
	type WorkspaceStore
} from '#lib/workspace.ts';

function memoryStore(): WorkspaceStore & { raw(): string | null } {
	const items = new Map<string, string>();
	return {
		getItem: (key) => items.get(key) ?? null,
		setItem: (key, value) => {
			items.set(key, value);
		},
		raw: () => items.get(WORKSPACE_KEY) ?? null
	};
}

function keysOf(value: unknown, found = new Set<string>()): Set<string> {
	if (Array.isArray(value)) {
		for (const item of value) keysOf(item, found);
		return found;
	}
	if (value && typeof value === 'object') {
		for (const [key, child] of Object.entries(value)) {
			found.add(key);
			keysOf(child, found);
		}
	}
	return found;
}

const forest = {
	id: 'forest',
	query: 'forest',
	sort: 'Oldest',
	posts: [
		{
			id: 'post-9',
			width: 800,
			height: 600,
			tags: ['forest'],
			mediaRef: 'media-9',
			kind: 'video' as const,
			currentTime: 14.2,
			videoPosition: 14.2
		}
	],
	postId: 'post-9',
	mode: 'viewer' as const,
	scroll: 640,
	scrollAnchor: { id: 'post-3', offset: 12 },
	applied: { query: 'forest', rating: ['General'], media: ['Images'], sort: 'Oldest' },
	zoom: { scale: 2.5, x: 40, y: -18 },
	pan: { x: 40, y: -18 },
	videoPosition: 14.2,
	playbackPosition: 14.2
};

const water = {
	id: 'water',
	query: 'water',
	sort: 'Highest score',
	posts: [],
	postId: null,
	mode: 'gallery' as const,
	scroll: 20,
	scrollAnchor: { id: 'post-1', offset: 4 },
	applied: { query: 'water', rating: ['Sensitive'], media: ['Videos'], sort: 'Highest score' }
};

describe('workspace checkpoint', () => {
	it('saves and restores views, the active context, queries, order, scroll, and the viewer image', () => {
		const store = memoryStore();
		saveCheckpoint(store, {
			views: [water, forest],
			activeId: 'forest',
			temporaryAlbums: [
				{
					id: 'album-birds',
					query: 'birds',
					sort: 'Oldest',
					scroll: 80,
					scrollAnchor: { id: 'bird-1', offset: 6 },
					postId: 'bird-1',
					mode: 'viewer',
					zoom: { scale: 3, x: 1, y: 2 },
					pan: { x: 1, y: 2 },
					videoPosition: 9
				},
				{
					id: 'album-cats',
					query: 'cats',
					sort: 'Newest',
					scroll: 0,
					scrollAnchor: null,
					postId: null,
					mode: 'gallery'
				}
			],
			closed: [{ kind: 'album', id: 'album-closed', query: 'moss', sort: 'Oldest', scroll: 15 }]
		});

		const saved = readCheckpoint(store);
		expect(saved?.views.map((view) => view.query)).toEqual(['water', 'forest']);
		expect(saved?.views.map((view) => view.sort)).toEqual(['Highest score', 'Oldest']);
		expect(saved?.activeId).toBe('forest');
		expect(saved?.views[1]).toMatchObject({
			query: 'forest',
			sort: 'Oldest',
			mode: 'viewer',
			postId: 'post-9',
			scroll: 640,
			scrollAnchor: { id: 'post-3', offset: 12 }
		});
		expect(saved?.views[0]?.scrollAnchor).toEqual({ id: 'post-1', offset: 4 });
		expect(saved?.temporaryAlbums.map((album) => album.id)).toEqual(['album-birds', 'album-cats']);
		expect(saved?.temporaryAlbums[0]).toMatchObject({
			query: 'birds',
			sort: 'Oldest',
			scroll: 80,
			postId: 'bird-1',
			mode: 'viewer'
		});

		const restored = restoreNavigation({
			views: explorationViews(saved?.views ?? []),
			activeId: saved?.activeId ?? ''
		});
		expect(restored.past).toEqual([]);
		expect(restored.future).toEqual([]);
		expect(restored.views.map((view) => view.id)).toEqual(['water', 'forest']);
		expect(restored.activeId).toBe('forest');
		expect(restored.views.find((view) => view.id === restored.activeId)).toMatchObject({
			query: 'forest',
			mode: 'viewer',
			postId: 'post-9',
			scroll: 640,
			scrollAnchor: { id: 'post-3', offset: 12 },
			applied: { sort: 'Oldest' }
		});
		expect(restored.views.map((view) => view.applied?.sort)).toEqual(['Highest score', 'Oldest']);
	});

	it('round-trips the random sort seed on applied filters', () => {
		const store = memoryStore();
		saveCheckpoint(store, {
			views: [
				{
					...water,
					applied: {
						query: 'water',
						rating: ['Sensitive'],
						media: ['Videos'],
						sort: 'Random',
						seed: 4242
					}
				}
			],
			activeId: 'water'
		});
		const restored = explorationViews(readCheckpoint(store)?.views ?? []);
		expect(restored[0]?.applied).toMatchObject({ sort: 'Random', seed: 4242 });
	});

	it('caches score and file size on posts through the write path used for session restore', () => {
		const store = memoryStore();
		const draft = checkpointFromViews(
			[
				{
					id: 'water',
					query: 'water',
					posts: [
						{
							id: 'post-1',
							width: 100,
							height: 50,
							tags: ['water'],
							mediaRef: 'media-1',
							score: 42,
							fileSize: 2048,
							postedAt: 1_734_170_444_000
						}
					],
					postId: 'post-1',
					mode: 'viewer',
					scroll: 0,
					scrollAnchor: null
				}
			],
			'water'
		);
		saveCheckpoint(store, draft);
		const restored = explorationViews(readCheckpoint(store)?.views ?? []);
		expect(restored[0]?.posts[0]).toMatchObject({
			id: 'post-1',
			score: 42,
			fileSize: 2048,
			postedAt: 1_734_170_444_000
		});
	});

	it('leaves zoom, pan, and video position out of the checkpoint', () => {
		const store = memoryStore();
		saveCheckpoint(store, {
			views: [forest, water],
			activeId: 'forest',
			temporaryAlbums: [
				{
					id: 'album-birds',
					query: 'birds',
					sort: 'Oldest',
					scroll: 80,
					postId: 'bird-1',
					mode: 'viewer',
					zoom: { scale: 3 },
					pan: { x: 1 },
					videoPosition: 9,
					playbackPosition: 9,
					currentTime: 9
				}
			]
		});
		const keys = keysOf(JSON.parse(store.raw() ?? '{}'));
		expect(keys.has('zoom')).toBe(false);
		expect(keys.has('pan')).toBe(false);
		expect(keys.has('videoPosition')).toBe(false);
		expect(keys.has('playbackPosition')).toBe(false);
		expect(keys.has('currentTime')).toBe(false);
		expect(keys.has('past')).toBe(false);
		expect(keys.has('future')).toBe(false);
		expect(store.raw()).not.toContain('localStorage');
	});

	it('does not read or write localStorage', () => {
		const store = memoryStore();
		let touched = false;
		const marker = {
			getItem() {
				touched = true;
				return null;
			},
			setItem() {
				touched = true;
			},
			removeItem() {
				touched = true;
			}
		};
		const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
		Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: marker });
		try {
			saveCheckpoint(store, { views: [water], activeId: 'water' });
			expect(readCheckpoint(store)?.views[0]?.query).toBe('water');
			expect(touched).toBe(false);
		} finally {
			if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
			else delete (globalThis as { localStorage?: unknown }).localStorage;
		}
	});

	it('rehydrates the current history entry without pushing another one', () => {
		const replaces: { cursor: number }[] = [];
		expect(rehydrateHistory({ cursor: 4 }, (state) => replaces.push(state))).toBe(4);
		expect(rehydrateHistory(null, (state) => replaces.push(state))).toBe(0);
		expect(replaces).toEqual([{ cursor: 4 }, { cursor: 0 }]);
	});

	it('reads a cursor from the current entry or from SvelteKit shallow history state', () => {
		expect(readHistoryCursor({ cursor: 4 })).toBe(4);
		expect(readHistoryCursor(null)).toBe(0);
		const metadata = 'sveltekit:metadata';
		expect(readHistoryCursor({ [metadata]: { state: devalue.stringify({ cursor: 6 }) } })).toBe(6);
		expect(
			readHistoryCursor({
				cursor: 2,
				[metadata]: { state: devalue.stringify({}) }
			})
		).toBe(2);
		expect(readHistoryCursor({ [metadata]: { state: 'not-history-state' } })).toBe(0);
	});

	it('keeps back and forward on the restored entry instead of inventing earlier snapshots', () => {
		const store = memoryStore();
		saveCheckpoint(store, { views: [forest, water], activeId: 'forest' });
		const saved = readCheckpoint(store);
		const restored = restoreNavigation({
			views: explorationViews(saved?.views ?? []),
			activeId: saved?.activeId ?? ''
		});
		expect(back(restored)).toBe(restored);
		expect(forward(restored)).toBe(restored);

		const changed = replaceTag(restored, 'night');
		expect(changed.views.find((view) => view.id === changed.activeId)?.query).toBe('night');
		const undone = back(changed);
		expect(undone.views.find((view) => view.id === undone.activeId)?.query).toBe('forest');
		const redone = forward(undone);
		expect(redone.views.find((view) => view.id === redone.activeId)?.query).toBe('night');
	});

	it('keeps temporary albums when views are patched, and keeps their saved order', () => {
		const store = memoryStore();
		saveCheckpoint(store, {
			views: [forest],
			activeId: 'forest',
			temporaryAlbums: [
				{
					id: 'album-birds',
					query: 'birds',
					sort: 'Oldest',
					scroll: 80,
					postId: 'bird-1',
					mode: 'viewer'
				}
			]
		});
		patchCheckpoint(store, { views: [water], activeId: 'water' });
		expect(readCheckpoint(store)?.temporaryAlbums[0]?.query).toBe('birds');
		retainTemporaryAlbums(store, ['album-cats', 'album-birds']);
		const albums = readCheckpoint(store)?.temporaryAlbums ?? [];
		expect(albums.map((album) => album.id)).toEqual(['album-cats', 'album-birds']);
		expect(albums[1]).toMatchObject({
			query: 'birds',
			sort: 'Oldest',
			scroll: 80,
			postId: 'bird-1'
		});
		expect(albums[0]).toMatchObject({ query: '', sort: 'Newest', scroll: 0 });
	});
});

function mapStore() {
	const items = new Map<string, string>();
	let fail = false;
	return {
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => {
			if (fail) {
				fail = false;
				throw new Error('quota');
			}
			items.set(key, value);
		},
		removeItem: (key: string) => {
			items.delete(key);
		},
		failNext() {
			fail = true;
		}
	};
}

function contentRecord(id: string, updatedAt: number, query: string): WorkspaceRecord {
	return {
		id,
		updatedAt,
		checkpoint: {
			version: 1,
			views: [
				{
					id: `${id}-view`,
					query,
					sort: 'Newest',
					posts: [],
					postId: null,
					mode: 'gallery',
					scroll: 0,
					scrollAnchor: null
				}
			],
			activeId: `${id}-view`,
			temporaryAlbums: [],
			closed: []
		}
	};
}

describe('workspace catalog', () => {
	it('adopts the newest free workspace and skips one a live tab holds', () => {
		const now = 1_000;
		const catalog = {
			version: 1 as const,
			workspaces: [contentRecord('older', 1, 'older'), contentRecord('newer', 50, 'newer')]
		};
		const before = JSON.stringify(catalog);
		const claim = chooseWorkspace({
			session: { tabId: null, workspaceId: null },
			catalog,
			leases: {
				version: 1,
				leases: [{ workspaceId: 'newer', tabId: 'open-tab', seenAt: now, released: false }]
			},
			now,
			contested: false,
			nextTabId: 'new-tab',
			nextWorkspaceId: 'blank'
		});
		expect(claim.workspaceId).toBe('older');
		expect(claim.checkpoint?.views[0]?.query).toBe('older');
		expect(JSON.stringify(catalog)).toBe(before);
	});

	it('reclaims this tab on reload instead of a newer free workspace', () => {
		const claim = chooseWorkspace({
			session: { tabId: 'tab-a', workspaceId: 'mine' },
			catalog: {
				version: 1,
				workspaces: [contentRecord('mine', 1, 'mine'), contentRecord('newer', 9, 'newer')]
			},
			leases: {
				version: 1,
				leases: [{ workspaceId: 'mine', tabId: 'tab-a', seenAt: 1, released: true }]
			},
			now: 20,
			contested: false,
			nextTabId: 'other',
			nextWorkspaceId: 'other-ws'
		});
		expect(claim.workspaceId).toBe('mine');
		expect(claim.tabId).toBe('tab-a');
		expect(claim.created).toBe(false);
	});

	it('gives a contested duplicate the next free workspace', () => {
		const claim = chooseWorkspace({
			session: { tabId: 'tab-a', workspaceId: 'live' },
			catalog: {
				version: 1,
				workspaces: [contentRecord('live', 5, 'live'), contentRecord('free', 4, 'free')]
			},
			leases: {
				version: 1,
				leases: [{ workspaceId: 'live', tabId: 'tab-a', seenAt: 100, released: false }]
			},
			now: 100,
			contested: true,
			nextTabId: 'tab-b',
			nextWorkspaceId: 'blank'
		});
		expect(claim.tabId).toBe('tab-b');
		expect(claim.workspaceId).toBe('free');
		expect(claim.checkpoint?.views[0]?.query).toBe('free');
	});

	it('starts blank when a contested tab has no other free workspace', () => {
		const claim = chooseWorkspace({
			session: { tabId: 'tab-a', workspaceId: 'live' },
			catalog: { version: 1, workspaces: [contentRecord('live', 5, 'live')] },
			leases: {
				version: 1,
				leases: [{ workspaceId: 'live', tabId: 'tab-a', seenAt: 100, released: false }]
			},
			now: 100,
			contested: true,
			nextTabId: 'tab-b',
			nextWorkspaceId: 'blank'
		});
		expect(claim.created).toBe(true);
		expect(claim.workspaceId).toBe('blank');
		expect(claim.checkpoint).toBeNull();
	});

	it('treats a released or stale lease as free', () => {
		const catalog = { version: 1 as const, workspaces: [contentRecord('water', 10, 'water')] };
		const released = releaseLease(
			{
				version: 1,
				leases: [{ workspaceId: 'water', tabId: 'tab-a', seenAt: 10, released: false }]
			},
			'water',
			'tab-a',
			20
		);
		expect(released.leases[0]).toMatchObject({ released: true, seenAt: 20 });
		const adopted = chooseWorkspace({
			session: { tabId: null, workspaceId: null },
			catalog,
			leases: released,
			now: 20,
			contested: false,
			nextTabId: 'tab-b',
			nextWorkspaceId: 'blank'
		});
		expect(adopted.workspaceId).toBe('water');

		const stale = chooseWorkspace({
			session: { tabId: null, workspaceId: null },
			catalog,
			leases: {
				version: 1,
				leases: [{ workspaceId: 'water', tabId: 'tab-a', seenAt: 0, released: false }]
			},
			now: LEASE_STALE_MS + 1,
			contested: false,
			nextTabId: 'tab-c',
			nextWorkspaceId: 'blank'
		});
		expect(stale.workspaceId).toBe('water');
	});

	it('does not take a workspace another live tab holds, even when this tab remembers it', () => {
		const claim = chooseWorkspace({
			session: { tabId: 'tab-a', workspaceId: 'mine' },
			catalog: { version: 1, workspaces: [contentRecord('mine', 5, 'mine')] },
			leases: {
				version: 1,
				leases: [{ workspaceId: 'mine', tabId: 'tab-b', seenAt: 100, released: false }]
			},
			now: 100,
			contested: false,
			nextTabId: 'tab-c',
			nextWorkspaceId: 'blank'
		});
		expect(claim.created).toBe(true);
		expect(claim.workspaceId).not.toBe('mine');
	});

	it('keeps each workspace body when two tabs save', () => {
		const store = mapStore();
		saveWorkspaceRecord(store, emptyLeases(), contentRecord('a', 1, 'alpha'), 1);
		saveWorkspaceRecord(store, emptyLeases(), contentRecord('b', 2, 'beta'), 2);
		const queries = readCatalog(store)
			.workspaces.map((workspace) => workspace.checkpoint.views[0]?.query)
			.sort();
		expect(queries).toEqual(['alpha', 'beta']);
	});

	it('drops the oldest free workspace past the keep limit and never a leased one', () => {
		const store = mapStore();
		let leases = emptyLeases();
		for (let index = 0; index < WORKSPACE_KEEP_LIMIT; index++) {
			saveWorkspaceRecord(
				store,
				leases,
				contentRecord(`w${index}`, index + 1, `q${index}`),
				index + 1
			);
		}
		leases = {
			version: 1,
			leases: [{ workspaceId: 'w0', tabId: 'tab', seenAt: 100, released: false }]
		};
		saveWorkspaceRecord(store, leases, contentRecord('new', 100, 'new'), 100);
		const ids = readCatalog(store).workspaces.map((workspace) => workspace.id);
		expect(ids).toHaveLength(WORKSPACE_KEEP_LIMIT);
		expect(ids).toContain('w0');
		expect(ids).toContain('new');
		expect(ids).not.toContain('w1');
	});

	it('drops an empty workspace before a saved search when storage is full', () => {
		const store = mapStore();
		saveWorkspaceRecord(
			store,
			emptyLeases(),
			{
				id: 'empty',
				updatedAt: 0,
				checkpoint: { version: 1, views: [], activeId: '', temporaryAlbums: [], closed: [] }
			},
			0
		);
		saveWorkspaceRecord(store, emptyLeases(), contentRecord('kept', 2, 'kept'), 2);
		store.failNext();
		const saved = saveWorkspaceRecord(store, emptyLeases(), contentRecord('added', 3, 'added'), 3);
		expect(saved.persisted).toBe(true);
		const ids = readCatalog(store).workspaces.map((workspace) => workspace.id);
		expect(ids).not.toContain('empty');
		expect(ids).toEqual(expect.arrayContaining(['kept', 'added']));
	});

	it('imports a legacy session checkpoint once into an empty catalog', () => {
		const legacy = contentRecord('old', 1, 'water').checkpoint;
		const imported = importLegacyCheckpoint(emptyCatalog(), legacy, 10, 'migrated');
		expect(imported?.workspaces[0]?.checkpoint.views[0]?.query).toBe('water');
		expect(importLegacyCheckpoint(imported ?? emptyCatalog(), legacy, 11, 'again')).toBeNull();
		expect(importLegacyCheckpoint(emptyCatalog(), null, 11, 'again')).toBeNull();
	});
});
