import * as devalue from 'devalue';
import { describe, expect, it } from 'vitest';
import { back, forward, replaceTag, restoreNavigation } from '#lib/navigation.ts';
import {
	SHARED_WORKSPACE_KEY,
	WORKSPACE_KEY,
	adoptSharedWorkspace,
	checkpointFromViews,
	explorationViews,
	patchCheckpoint,
	readCheckpoint,
	readHistoryCursor,
	readSharedWorkspace,
	rehydrateHistory,
	retainTemporaryAlbums,
	saveCheckpoint,
	writeSharedWorkspace,
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

function browserStore() {
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

function searchCheckpoint(query: string) {
	return {
		version: 1 as const,
		views: [
			{
				id: 'view',
				query,
				sort: 'Newest',
				posts: [],
				postId: null,
				mode: 'gallery' as const,
				scroll: 0,
				scrollAnchor: null
			}
		],
		activeId: 'view',
		temporaryAlbums: [],
		closed: []
	};
}

describe('shared workspace', () => {
	it('writes and reads one set of searches', () => {
		const store = browserStore();
		const saved = writeSharedWorkspace(store, searchCheckpoint('forest'), 20);
		expect(saved.persisted).toBe(true);
		expect(readSharedWorkspace(store)?.checkpoint.views[0]?.query).toBe('forest');
		expect(readSharedWorkspace(store)?.updatedAt).toBe(20);
	});

	it('leaves an unchanged checkpoint in place', () => {
		const store = browserStore();
		writeSharedWorkspace(store, searchCheckpoint('forest'), 20);
		const again = writeSharedWorkspace(store, searchCheckpoint('forest'), 40);
		expect(again.shared.updatedAt).toBe(20);
		expect(store.getItem(SHARED_WORKSPACE_KEY)).toContain('"updatedAt":20');
	});

	it('keeps the shared record ahead of an older per-tab catalog', () => {
		const local = browserStore();
		const session = browserStore();
		writeSharedWorkspace(local, searchCheckpoint('shared'), 5);
		local.setItem(
			'panbooru-workspaces',
			JSON.stringify({ version: 1, entries: [{ id: 'old', updatedAt: 99 }] })
		);
		local.setItem('panbooru-workspaces:old', JSON.stringify(searchCheckpoint('catalog')));
		const adopted = adoptSharedWorkspace(local, session, 100);
		expect(adopted?.checkpoint.views[0]?.query).toBe('shared');
	});

	it('adopts the newest per-tab catalog when nothing is shared yet', () => {
		const local = browserStore();
		const session = browserStore();
		local.setItem(
			'panbooru-workspaces',
			JSON.stringify({
				version: 1,
				entries: [
					{ id: 'older', updatedAt: 1 },
					{ id: 'newer', updatedAt: 8 }
				]
			})
		);
		local.setItem('panbooru-workspaces:older', JSON.stringify(searchCheckpoint('older')));
		local.setItem('panbooru-workspaces:newer', JSON.stringify(searchCheckpoint('newer')));
		const adopted = adoptSharedWorkspace(local, session, 10);
		expect(adopted?.checkpoint.views[0]?.query).toBe('newer');
		expect(readSharedWorkspace(local)?.checkpoint.views[0]?.query).toBe('newer');
	});

	it('prefers an unflushed search over a catalog body', () => {
		const local = browserStore();
		const session = browserStore();
		local.setItem(
			'panbooru-workspaces',
			JSON.stringify({ version: 1, entries: [{ id: 'old', updatedAt: 4 }] })
		);
		local.setItem('panbooru-workspaces:old', JSON.stringify(searchCheckpoint('catalog')));
		session.setItem('panbooru-workspace-pending', JSON.stringify(searchCheckpoint('pending')));
		const adopted = adoptSharedWorkspace(local, session, 9);
		expect(adopted?.checkpoint.views[0]?.query).toBe('pending');
		expect(session.getItem('panbooru-workspace-pending')).toBeNull();
	});

	it('imports a legacy session checkpoint once', () => {
		const local = browserStore();
		const session = browserStore();
		saveCheckpoint(session, { views: [searchCheckpoint('water').views[0]!], activeId: 'view' });
		const adopted = adoptSharedWorkspace(local, session, 3);
		expect(adopted?.checkpoint.views[0]?.query).toBe('water');
		expect(session.getItem(WORKSPACE_KEY)).toBeNull();
		expect(adoptSharedWorkspace(local, session, 4)?.updatedAt).toBe(3);
	});

	it('keeps the checkpoint in memory when storage is full', () => {
		const store = browserStore();
		store.failNext();
		const saved = writeSharedWorkspace(store, searchCheckpoint('forest'), 2);
		expect(saved.persisted).toBe(false);
		expect(saved.shared.checkpoint.views[0]?.query).toBe('forest');
		expect(store.getItem(SHARED_WORKSPACE_KEY)).toBeNull();
	});
});
