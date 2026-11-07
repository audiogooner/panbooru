<script lang="ts">
	import { browser } from '$app/env';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Icon from '#lib/Icon.svelte';
	import type { IconName } from '#lib/Icon.svelte';
	import {
		activeView,
		chooseView,
		navigation,
		persistWorkspace,
		removeView,
		startSearch,
		viewerCreated
	} from '#lib/explore.svelte.ts';
	import { GALLERY_DRAG, type DragPost } from '#lib/selection.svelte.ts';
	import { selectionLabel as viewSelectionLabel } from '#lib/selection.svelte.ts';
	import type { ExplorationView } from '#lib/navigation.ts';
	import {
		explorationViews,
		toCheckpointView,
		patchCheckpoint,
		readCheckpoint,
		retainTemporaryAlbums,
		temporaryAlbum,
		type ClosedCheckpoint,
		type TemporaryAlbumEntry
	} from '#lib/workspace.ts';
	import { tick } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import { SvelteMap } from 'svelte/reactivity';

	let { onlogout }: { onlogout?: () => void } = $props();

	const SIDE_KEY = 'panbooru-sidebar-width';
	const ALBUM_KEY = 'panbooru-album-height';
	const SIDE_MIN = 180;
	const SIDE_MAX = 420;
	const SIDE_DEFAULT = 246;
	const ALBUM_MIN = 70;
	const ALBUM_DEFAULT = 160;
	const RESIZE_STEP = 16;

	const destinations = [
		{ href: '/albums', label: 'Albums', icon: 'book-image', dest: 'albums' },
		{ href: '/favorites', label: 'Favorites', icon: 'heart', dest: 'favorites' },
		{ href: '/saved', label: 'Saved searches', icon: 'saved', dest: 'saved' },
		{ href: '/settings', label: 'Settings', icon: 'settings', dest: 'settings' }
	] as const;

	const categoryNames = [
		'artist',
		'character',
		'copyright',
		'metadata',
		'general',
		'deprecated'
	] as const;

	type CoverRef = { src?: string | null; available?: boolean } | null;
	type SidebarAlbum = {
		id: string;
		name: string;
		pinned?: boolean;
		temporary?: boolean;
		cover?: {
			saved?: boolean;
			slots?: CoverRef[];
			firstItems?: CoverRef[];
		};
	};
	type ClosedEntry = { kind: 'view'; view: ExplorationView } | ({ kind: 'album' } & TemporaryAlbumEntry);

	const knownCategories = new SvelteMap<string, string>();
	const closedStack: ClosedEntry[] = [];

	let sideWidth = $state(SIDE_DEFAULT);
	let albumHeight = $state(ALBUM_DEFAULT);
	let albumMax = $state(480);
	let dropTarget = $state<string | null>(null);
	type DownloadJob = {
		id: string;
		state: string;
		progress: number;
		error: string | null;
		itemId: string;
	};
	type ImportTask = {
		id: string;
		state: string;
		operation: 'add' | 'remove';
		destinationName: string;
		addedCount: number;
		total: number | null;
		error: string | null;
	};

	let tasksActive = $state(false);
	let taskProgress = $state(0);
	let taskIndeterminate = $state(false);
	let taskTone = $state<'running' | 'failed' | 'done'>('running');
	let tasksOpen = $state(false);
	let taskJobs = $state.raw<DownloadJob[]>([]);
	let taskImports = $state.raw<ImportTask[]>([]);
	let sawActivity = false;
	let suppressCompletion = false;

	const importsPausable = $derived(
		taskImports.some((task) => task.state === 'queued' || task.state === 'leased')
	);

	let dragKind: 'view' | 'album' | null = null;
	let dragId: string | null = null;

	const pathname = $derived(page.url.pathname);
	const routeAlbumId = $derived(albumIdFrom(pathname));
	const exploring = $derived(pathname === '/');
	const viewing = $derived(activeView().mode === 'viewer');
	const categoryKey = $derived(
		[
			...new Set(
				navigation.views.map((view) => firstTag(view.query)).filter((tag) => tag.length > 0)
			)
		]
			.sort()
			.join('\n')
	);
	const watchCategories = $derived.by((): Attachment<HTMLElement> => {
		const key = categoryKey;
		return () => {
			const names = key.split('\n').filter((tag) => tag.length > 0 && !knownCategories.has(tag));
			if (names.length === 0) return;
			const controller = new AbortController();
			void lookupCategories(names, controller.signal);
			return () => controller.abort();
		};
	});
	const syncTemporaryAlbums = $derived.by((): Attachment<HTMLElement> => {
		const ids = [...readLibrary().temporary];
		return () => {
			try {
				retainTemporaryAlbums(sessionStorage, ids);
			} catch {
				// sessionStorage is unavailable in this browser context.
			}
		};
	});
	const sidebarAlbums = $derived.by(() => {
		const { albums, temporary, pinned } = readLibrary();
		const byId = new Map(albums.map((album) => [album.id, album]));
		const ordered: SidebarAlbum[] = [];
		for (const id of [...temporary, ...pinned]) {
			if (ordered.some((album) => album.id === id)) continue;
			const album = byId.get(id);
			if (!album) continue;
			ordered.push(album);
		}
		return ordered;
	});

	function readLibrary() {
		const data = page.data as {
			albums?: SidebarAlbum[];
			albumSidebar?: { temporary?: string[]; pinned?: string[] };
		};
		return {
			albums: data.albums ?? [],
			temporary: data.albumSidebar?.temporary ?? [],
			pinned: data.albumSidebar?.pinned ?? []
		};
	}

	function albumIdFrom(path: string) {
		const match = /^\/albums\/([^/]+)\/?$/.exec(path);
		if (!match?.[1]) return null;
		try {
			return decodeURIComponent(match[1]);
		} catch {
			return match[1];
		}
	}

	function clamp(value: number, min: number, max: number) {
		return Math.min(max, Math.max(min, Math.round(value)));
	}

	function albumCeiling() {
		return Math.max(ALBUM_MIN, Math.round(window.innerHeight * 0.6));
	}

	function readSide() {
		const inline = document.documentElement.style.getPropertyValue('--side');
		const raw = inline || getComputedStyle(document.documentElement).getPropertyValue('--side');
		const value = Number.parseFloat(raw);
		return Number.isFinite(value) ? clamp(value, SIDE_MIN, SIDE_MAX) : SIDE_DEFAULT;
	}

	function publishSide(width: number) {
		const next = clamp(width, SIDE_MIN, SIDE_MAX);
		sideWidth = next;
		document.documentElement.style.setProperty('--side', `${next}px`);
		try {
			localStorage.setItem(SIDE_KEY, String(next));
		} catch {
			// Preference storage is unavailable in this browser context.
		}
	}

	function publishAlbum(height: number, ceiling = albumMax) {
		const next = clamp(height, ALBUM_MIN, ceiling);
		albumHeight = next;
		document.documentElement.style.setProperty('--album-height', `${next}px`);
		try {
			localStorage.setItem(ALBUM_KEY, String(next));
		} catch {
			// Preference storage is unavailable in this browser context.
		}
	}

	const restorePreferences: Attachment<HTMLElement> = () => {
		// The shell still passes logout. Settings owns the button, so this only keeps the prop live.
		void onlogout;
		const ceiling = albumCeiling();
		albumMax = ceiling;
		try {
			const rawSide = localStorage.getItem(SIDE_KEY);
			if (rawSide !== null && Number.isFinite(Number(rawSide))) publishSide(Number(rawSide));
			else sideWidth = readSide();
			const rawAlbum = localStorage.getItem(ALBUM_KEY);
			if (rawAlbum !== null && Number.isFinite(Number(rawAlbum))) {
				publishAlbum(Number(rawAlbum), ceiling);
			}
		} catch {
			sideWidth = readSide();
		}
	};

	function bindResize(axis: 'side' | 'album'): Attachment<HTMLElement> {
		return (element) => {
			function onPointerDown(event: PointerEvent) {
				if (event.button !== 0) return;
				event.preventDefault();
				const originX = event.clientX;
				const originY = event.clientY;
				const startSide = readSide();
				const startAlbum = albumHeight;
				const ceiling = albumCeiling();
				albumMax = ceiling;
				element.setPointerCapture(event.pointerId);
				function onPointerMove(move: PointerEvent) {
					if (axis === 'side') publishSide(startSide + move.clientX - originX);
					else publishAlbum(startAlbum - (move.clientY - originY), ceiling);
				}
				function onPointerUp(end: PointerEvent) {
					element.removeEventListener('pointermove', onPointerMove);
					element.removeEventListener('pointerup', onPointerUp);
					element.removeEventListener('pointercancel', onPointerUp);
					if (axis === 'side') publishSide(startSide + end.clientX - originX);
					else publishAlbum(startAlbum - (end.clientY - originY), ceiling);
				}
				element.addEventListener('pointermove', onPointerMove);
				element.addEventListener('pointerup', onPointerUp);
				element.addEventListener('pointercancel', onPointerUp);
			}
			element.addEventListener('pointerdown', onPointerDown);
			return () => element.removeEventListener('pointerdown', onPointerDown);
		};
	}

	const bindSideResize = bindResize('side');
	const bindAlbumResize = bindResize('album');

	function onViewportResize() {
		const ceiling = albumCeiling();
		albumMax = ceiling;
		if (albumHeight > ceiling) publishAlbum(albumHeight, ceiling);
	}

	function onSideKey(event: KeyboardEvent) {
		let next = sideWidth;
		if (event.key === 'ArrowRight') next += RESIZE_STEP;
		else if (event.key === 'ArrowLeft') next -= RESIZE_STEP;
		else if (event.key === 'Home') next = SIDE_MIN;
		else if (event.key === 'End') next = SIDE_MAX;
		else return;
		event.preventDefault();
		event.stopPropagation();
		publishSide(next);
	}

	function onAlbumKey(event: KeyboardEvent) {
		const ceiling = albumCeiling();
		albumMax = ceiling;
		let next = albumHeight;
		if (event.key === 'ArrowUp') next += RESIZE_STEP;
		else if (event.key === 'ArrowDown') next -= RESIZE_STEP;
		else if (event.key === 'Home') next = ALBUM_MIN;
		else if (event.key === 'End') next = ceiling;
		else return;
		event.preventDefault();
		event.stopPropagation();
		publishAlbum(next, ceiling);
	}

	function editingText(target: EventTarget | null) {
		return (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement ||
			(target instanceof HTMLElement && target.isContentEditable)
		);
	}

	function closeTasks(event: KeyboardEvent) {
		if (!tasksOpen || event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		tasksOpen = false;
	}

	function closeTasksPointer(event: PointerEvent) {
		if (!tasksOpen) return;
		const target = event.target;
		if (target instanceof Element && target.closest('[data-task-strip]')) return;
		tasksOpen = false;
	}

	function onShortcut(event: KeyboardEvent) {
		if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
		if (editingText(event.target)) return;
		if (document.querySelector('dialog[open], [role="dialog"]')) return;
		const key = event.key.toLowerCase();
		if (key === 't' && event.shiftKey) {
			event.preventDefault();
			void reopenClosed();
			return;
		}
		if (key === 't') {
			event.preventDefault();
			void openNewSearch();
			return;
		}
		if (key === 'w' && event.shiftKey) {
			event.preventDefault();
			void closeActive();
		}
	}

	function destinationHref(href: (typeof destinations)[number]['href']) {
		if (href === '/albums') return resolve('/albums');
		if (href === '/favorites') return resolve('/favorites');
		if (href === '/saved') return resolve('/saved');
		return resolve('/settings');
	}

	function firstTag(query: string) {
		const token = query.trim().split(/\s+/).find(Boolean) ?? '';
		const bare = token.startsWith('-') ? token.slice(1) : token;
		if (!bare || bare.includes(':')) return '';
		return bare;
	}

	function viewTitle(query: string) {
		const text = query.trim().replaceAll('_', ' ');
		return text || 'Untitled search';
	}

	function categoryFor(query: string) {
		const tag = firstTag(query);
		if (!tag) return '';
		const category = knownCategories.get(tag);
		if (category && categoryNames.some((name) => name === category)) return category;
		return 'general';
	}

	function viewIcon(query: string): IconName {
		return categoryFor(query) === 'artist' ? 'artist' : 'search';
	}

	function coverSrc(album: SidebarAlbum) {
		const cover = album.cover;
		if (!cover) return null;
		const primary = cover.saved ? cover.slots?.[0] : cover.firstItems?.[0];
		if (!primary || primary.available === false) return null;
		const src = primary.src;
		return typeof src === 'string' && src.length > 0 ? src : null;
	}

	function selectionLabel(id: string): string | null {
		if (id === 'albums' || id === 'saved' || id === 'favorites' || id === 'settings') {
			return id === 'settings' ? null : viewSelectionLabel(id);
		}
		return viewSelectionLabel(id);
	}

	function readDroppedPosts(event: DragEvent): DragPost[] {
		const raw =
			event.dataTransfer?.getData(GALLERY_DRAG) || event.dataTransfer?.getData('text/plain') || '';
		if (!raw.startsWith('[')) return [];
		try {
			const parsed = JSON.parse(raw) as unknown;
			if (!Array.isArray(parsed)) return [];
			return parsed.filter(
				(item): item is DragPost =>
					!!item && typeof item === 'object' && typeof (item as DragPost).remoteId === 'string'
			);
		} catch {
			return [];
		}
	}

	async function acceptGalleryDrop(target: string, event: DragEvent) {
		const posts = readDroppedPosts(event);
		if (!posts.length) return;
		await Promise.all(
			posts.map((post) => {
				const body =
					post.itemId && !post.mediaRef
						? { itemId: post.itemId }
						: {
								remoteId: post.remoteId,
								tags: post.tags,
								width: post.width,
								height: post.height,
								...(post.mediaRef ? { mediaRef: post.mediaRef } : {}),
								...(post.rating ? { rating: post.rating } : {})
							};
				const path =
					target === 'favorites'
						? '/api/library/favorites'
						: `/api/library/albums/${encodeURIComponent(target)}/items`;
				return fetch(path, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body)
				});
			})
		);
		await invalidateAll();
	}

	function failureCopy(error: string | null) {
		if (error === 'unavailable') return 'This file is unavailable.';
		if (error === 'verification failed') return 'The download could not be verified.';
		return 'The download failed.';
	}

	function importFailure(error: string | null) {
		if (error === 'source auth required') return 'Gelbooru rejected the import.';
		if (error === 'album was not found') return 'The album is no longer available.';
		return 'The import failed.';
	}

	function importCount(task: ImportTask) {
		const noun = task.operation === 'remove' ? 'removed' : 'added';
		const label = task.addedCount === 1 ? 'post' : 'posts';
		return `${task.addedCount} ${label} ${noun}`;
	}

	function importProgress(task: ImportTask) {
		if (task.total == null) return null;
		if (task.total <= 0) return 100;
		return Math.min(100, Math.round((task.addedCount / task.total) * 100));
	}

	function jobActive(job: DownloadJob) {
		return job.state === 'queued' || job.state === 'leased' || job.state === 'retry';
	}

	function importActive(task: ImportTask) {
		return task.state === 'queued' || task.state === 'leased' || task.state === 'paused';
	}

	async function refreshJobs() {
		try {
			const response = await fetch('/api/library/jobs');
			if (!response.ok) return;
			const body = (await response.json()) as {
				data?: { jobs?: DownloadJob[]; imports?: ImportTask[] };
			};
			const jobs = body.data?.jobs ?? [];
			const imports = body.data?.imports ?? [];
			taskJobs = jobs;
			taskImports = imports;
			const failed =
				jobs.some((job) => job.state === 'failed') ||
				imports.some((task) => task.state === 'failed');
			const active = jobs.some(jobActive) || imports.some(importActive);
			const runningImports = imports.filter(importActive);
			const indeterminate = runningImports.some((task) => task.total == null);
			if (failed || active) suppressCompletion = false;
			if (failed) {
				tasksActive = true;
				taskTone = 'failed';
				taskIndeterminate = indeterminate;
				sawActivity = true;
				taskProgress = stripProgress(jobs, runningImports);
			} else if (active) {
				tasksActive = true;
				taskTone = 'running';
				taskIndeterminate = indeterminate;
				sawActivity = true;
				taskProgress = stripProgress(jobs, runningImports);
			} else if (sawActivity && !suppressCompletion) {
				taskTone = 'done';
				taskIndeterminate = false;
				taskProgress = 100;
				tasksActive = true;
				sawActivity = false;
				window.setTimeout(() => {
					if (taskTone === 'done' && taskJobs.length === 0 && taskImports.length === 0) {
						tasksActive = false;
					}
				}, 2200);
			} else {
				tasksActive = false;
				taskIndeterminate = false;
				suppressCompletion = false;
			}
		} catch {
			// The next poll retries.
		}
	}

	function stripProgress(jobs: DownloadJob[], imports: ImportTask[]) {
		const parts: number[] = [];
		if (jobs.length) {
			const ratio = jobs.reduce((sum, job) => sum + (job.progress || 0), 0) / jobs.length;
			parts.push(ratio * 100);
		}
		const known = imports
			.map((task) => importProgress(task))
			.filter((progress): progress is number => progress != null);
		if (known.length) {
			parts.push(known.reduce((sum, progress) => sum + progress, 0) / known.length);
		}
		if (!parts.length) return 0;
		return Math.round(parts.reduce((sum, part) => sum + part, 0) / parts.length);
	}

	function watchJobs() {
		void refreshJobs();
		const timer = window.setInterval(() => void refreshJobs(), 2000);
		return () => window.clearInterval(timer);
	}

	function toggleTasks(event: MouseEvent) {
		if (tasksOpen) {
			tasksOpen = false;
			return;
		}
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		tasksOpen = true;
		void refreshJobs();
		queueMicrotask(() => {
			const pop = document.querySelector<HTMLElement>('[data-task-popover]');
			if (!pop) return;
			const width = pop.offsetWidth;
			const height = pop.offsetHeight;
			pop.style.left = `${Math.max(10, Math.min(rect.left, window.innerWidth - width - 12))}px`;
			pop.style.top = `${Math.max(10, rect.top - height - 8)}px`;
		});
	}

	async function taskAction(id: string, action: 'cancel' | 'retry' | 'dismiss') {
		const response = await fetch(`/api/library/jobs/${encodeURIComponent(id)}/${action}`, {
			method: 'POST'
		});
		if (response.ok) await refreshJobs();
	}

	async function importAction(
		id: string,
		action: 'pause' | 'resume' | 'cancel' | 'retry' | 'dismiss'
	) {
		if (action === 'cancel') suppressCompletion = true;
		const response = await fetch(`/api/library/imports/${encodeURIComponent(id)}/${action}`, {
			method: 'POST'
		});
		if (response.ok) await refreshJobs();
	}

	async function pauseAllImports() {
		const response = await fetch('/api/library/imports/pause-all', { method: 'POST' });
		if (response.ok) await refreshJobs();
	}

	function loadClosed(): ClosedEntry[] {
		if (!browser) return [];
		try {
			const saved = readCheckpoint(sessionStorage);
			if (!saved) return [];
			return saved.closed.map((entry) =>
				entry.kind === 'album'
					? entry
					: { kind: 'view' as const, view: explorationViews([entry.view])[0]! }
			);
		} catch {
			return [];
		}
	}

	function persistClosed() {
		if (!browser) return;
		try {
			const closed: ClosedCheckpoint[] = closedStack.map((entry) =>
				entry.kind === 'album' ? entry : { kind: 'view', view: toCheckpointView(entry.view) }
			);
			patchCheckpoint(sessionStorage, { closed });
		} catch {
			// sessionStorage is unavailable in this browser context.
		}
	}

	for (const entry of loadClosed()) closedStack.push(entry);

	function snapshot(view: ExplorationView): ExplorationView {
		return {
			id: view.id,
			query: view.query,
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
		};
	}

	function pushClosed(entry: ClosedEntry) {
		closedStack.unshift(entry);
		if (closedStack.length > 30) closedStack.pop();
		persistClosed();
	}

	async function focusSearch() {
		await tick();
		document.querySelector<HTMLInputElement>('input[name="tags"]')?.focus();
	}

	async function openNewSearch() {
		startSearch();
		if (page.url.pathname !== '/') await goto(resolve('/'));
		await focusSearch();
	}

	async function activateView(id: string) {
		chooseView(id);
		if (page.url.pathname !== '/') await goto(resolve('/'));
	}

	function closeExploration(id: string) {
		const view = navigation.views.find((item) => item.id === id);
		if (!view) return;
		const wasActive = navigation.activeId === id;
		const willEmpty = navigation.views.length === 1;
		pushClosed({ kind: 'view', view: snapshot(view) });
		removeView(id);
		if (wasActive && page.url.pathname !== '/') void goto(resolve('/'));
		if (wasActive && willEmpty) void focusSearch();
	}

	async function activateAlbum(id: string) {
		await fetch(`/api/library/albums/${encodeURIComponent(id)}/open`, { method: 'POST' });
		await goto(resolve('/albums/[id]', { id }));
	}

	async function closeTemporary(id: string) {
		let saved: TemporaryAlbumEntry | null = null;
		if (browser) {
			try {
				saved = temporaryAlbum(sessionStorage, id);
			} catch {
				saved = null;
			}
		}
		const response = await fetch(`/api/library/albums/${encodeURIComponent(id)}/open`, {
			method: 'DELETE'
		});
		if (!response.ok) return;
		pushClosed({
			kind: 'album',
			id,
			query: saved?.query ?? '',
			sort: saved?.sort ?? 'Newest',
			scroll: saved?.scroll ?? 0,
			scrollAnchor: saved?.scrollAnchor ?? null,
			postId: saved?.postId ?? null,
			mode: saved?.mode ?? 'gallery'
		});
		if (albumIdFrom(page.url.pathname) === id) await goto(resolve('/'));
		else await invalidateAll();
	}

	async function savePin(id: string, position: number) {
		const response = await fetch(`/api/library/albums/${encodeURIComponent(id)}/pin`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ pinned: true, position })
		});
		if (response.ok) await invalidateAll();
	}

	async function closeActive() {
		const path = page.url.pathname;
		const albumId = albumIdFrom(path);
		if (albumId) {
			const library = readLibrary();
			const temporary =
				library.temporary.includes(albumId) ||
				library.albums.some((album) => album.id === albumId && album.temporary);
			if (temporary) {
				await closeTemporary(albumId);
				return;
			}
			await goto(resolve('/'));
			return;
		}
		if (path === '/favorites') {
			await goto(resolve('/'));
			return;
		}
		if (path === '/') closeExploration(navigation.activeId);
	}

	async function reopenClosed() {
		const entry = closedStack.shift();
		persistClosed();
		if (!entry) return;
		if (entry.kind === 'view') {
			if (!navigation.views.some((view) => view.id === entry.view.id)) {
				navigation.views = [entry.view, ...navigation.views];
			}
			chooseView(entry.view.id);
			if (page.url.pathname !== '/') await goto(resolve('/'));
			return;
		}
		const response = await fetch(`/api/library/albums/${encodeURIComponent(entry.id)}/open`, {
			method: 'POST'
		});
		if (!response.ok) return;
		await goto(resolve('/albums/[id]', { id: entry.id }));
	}

	function preventMiddle(event: MouseEvent) {
		if (event.button === 1) event.preventDefault();
	}

	function onViewAux(event: MouseEvent, id: string) {
		if (event.button !== 1) return;
		event.preventDefault();
		event.stopPropagation();
		closeExploration(id);
	}

	function onAlbumAux(event: MouseEvent, album: SidebarAlbum) {
		if (event.button !== 1) return;
		event.preventDefault();
		event.stopPropagation();
		if (album.pinned) {
			if (albumIdFrom(page.url.pathname) === album.id) void goto(resolve('/'));
			return;
		}
		void closeTemporary(album.id);
	}

	function onFavoritesAux(event: MouseEvent) {
		if (event.button !== 1) return;
		event.preventDefault();
		event.stopPropagation();
		if (page.url.pathname === '/favorites') void goto(resolve('/'));
	}

	function endDrag() {
		dragKind = null;
		dragId = null;
		dropTarget = null;
	}

	function startViewDrag(event: DragEvent, id: string) {
		if (event.target instanceof Element && event.target.closest('.close')) {
			event.preventDefault();
			return;
		}
		dragKind = 'view';
		dragId = id;
		event.dataTransfer?.setData('text/plain', `view:${id}`);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
	}

	function startAlbumDrag(event: DragEvent, id: string) {
		if (event.target instanceof Element && event.target.closest('.close')) {
			event.preventDefault();
			return;
		}
		dragKind = 'album';
		dragId = id;
		event.dataTransfer?.setData('text/plain', `album:${id}`);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
	}

	function hoverView(event: DragEvent) {
		if (dragKind !== 'view') return;
		event.preventDefault();
	}

	function dropView(event: DragEvent, targetId: string) {
		event.preventDefault();
		event.stopPropagation();
		if (dragKind !== 'view' || !dragId || dragId === targetId) return;
		const from = navigation.views.findIndex((view) => view.id === dragId);
		const to = navigation.views.findIndex((view) => view.id === targetId);
		if (from < 0 || to < 0) return;
		const [item] = navigation.views.splice(from, 1);
		if (item) navigation.views.splice(to, 0, item);
		persistWorkspace();
	}

	function hoverCollection(event: DragEvent, id: string) {
		if (dragKind === 'view') return;
		if (dragKind === 'album') {
			if (id === 'favorites' || !readLibrary().pinned.includes(id)) return;
		}
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = dragKind === 'album' ? 'move' : 'copy';
		dropTarget = id;
	}

	function leaveDrop(event: DragEvent, id: string) {
		const next = event.relatedTarget;
		const current = event.currentTarget;
		if (next instanceof Node && current instanceof Node && current.contains(next)) return;
		if (dropTarget === id) dropTarget = null;
	}

	function dropAlbum(event: DragEvent, targetId: string) {
		event.preventDefault();
		event.stopPropagation();
		const kind = dragKind;
		const sourceId = dragId;
		dropTarget = null;
		if (kind === 'album' && sourceId) {
			if (sourceId === targetId) return;
			const pinned = readLibrary().pinned.filter((id) => id !== sourceId);
			const position = pinned.indexOf(targetId);
			if (position < 0) return;
			void savePin(sourceId, position);
			return;
		}
		if (kind === 'view') return;
		acceptGalleryDrop(targetId, event);
	}

	function dropFavorites(event: DragEvent) {
		event.preventDefault();
		dropTarget = null;
		if (dragKind) return;
		acceptGalleryDrop('favorites', event);
	}

	function hoverAlbumNav(event: DragEvent) {
		if (dragKind !== 'album') return;
		event.preventDefault();
	}

	function dropAlbumNav(event: DragEvent) {
		if (dragKind !== 'album' || !dragId) return;
		if (event.target instanceof Element && event.target.closest('[data-album]')) return;
		event.preventDefault();
		void savePin(dragId, 0);
	}

	async function lookupCategories(names: string[], signal: AbortSignal) {
		try {
			const response = await fetch('/api/source/gelbooru/tags', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ names }),
				signal
			});
			if (signal.aborted || !response.ok) return;
			const body = (await response.json()) as {
				data?: { tags?: { name?: string; category?: string }[] };
			};
			const found: string[] = [];
			for (const tag of body.data?.tags ?? []) {
				if (!tag.name || !tag.category) continue;
				found.push(tag.name);
				const category = categoryNames.some((name) => name === tag.category)
					? tag.category
					: 'general';
				if (knownCategories.get(tag.name) !== category) knownCategories.set(tag.name, category);
			}
			for (const name of names) {
				if (!found.includes(name)) knownCategories.set(name, 'general');
			}
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return;
		}
	}
</script>

<svelte:window
	onkeydown={onShortcut}
	onkeydowncapture={closeTasks}
	onpointerdown={closeTasksPointer}
	onresize={onViewportResize}
	ondragend={endDrag}
/>

<nav class="sidebar" aria-label="Main navigation" {@attach restorePreferences}>
	<a class="brand" href={resolve('/')}>
		<span class="brand-placeholder" aria-hidden="true" title="Logo placeholder — artwork undecided"
		></span>
		<strong>Panbooru</strong>
	</a>
	<button class="new-search" type="button" onclick={() => void openNewSearch()}>
		<Icon name="plus" />
		New search
	</button>
	<div class="view-list" {@attach watchCategories}>
		{#each navigation.views as view (view.id)}
			{@const title = viewTitle(view.query)}
			<!-- Middle-click and drag sit on the row; the button inside is the keyboard control. -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div
				class={[
					'nav-row',
					exploring && view.id === navigation.activeId && 'active',
					viewing && viewerCreated.ids.includes(view.id) && 'viewer-created'
				]}
				role="group"
				aria-label={title}
				data-view={view.id}
				draggable="true"
				onmousedown={preventMiddle}
				onauxclick={(event) => onViewAux(event, view.id)}
				ondragstart={(event) => startViewDrag(event, view.id)}
				ondragover={hoverView}
				ondrop={(event) => dropView(event, view.id)}
			>
				<button
					class={['row-main', categoryFor(view.query)]}
					type="button"
					{title}
					aria-current={exploring && view.id === navigation.activeId ? 'true' : undefined}
					onclick={() => void activateView(view.id)}
				>
					<Icon name={viewIcon(view.query)} />
					<span class="label">{title}</span>
				</button>
				{@render selectionBadge(view.id)}
				<button
					class="close"
					type="button"
					aria-label="Close view"
					title="Close · Shift+W"
					onclick={(event) => {
						event.stopPropagation();
						closeExploration(view.id);
					}}
				>
					<Icon name="x" />
				</button>
			</div>
		{/each}
	</div>
	<!-- A valued separator is the ARIA widget for resizing, which Svelte still treats as non-interactive. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="divider"
		role="separator"
		tabindex="0"
		aria-label="Resize album section"
		aria-orientation="horizontal"
		aria-valuemin={ALBUM_MIN}
		aria-valuemax={albumMax}
		aria-valuenow={albumHeight}
		{@attach bindAlbumResize}
		onkeydown={onAlbumKey}
	></div>
	<div class="section-heading">ALBUMS</div>
	<div
		class="album-nav"
		role="group"
		aria-label="Pinned and temporary albums"
		{@attach syncTemporaryAlbums}
		ondragover={hoverAlbumNav}
		ondrop={dropAlbumNav}
	>
		{#each sidebarAlbums as album (album.id)}
			{@const src = coverSrc(album)}
			<!-- Middle-click and drag sit on the row; the button inside is the keyboard control. -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div
				class={[
					'nav-row',
					album.pinned ? 'pinned' : 'temporary',
					routeAlbumId === album.id && 'active',
					dropTarget === album.id && 'drop-target'
				]}
				role="group"
				aria-label={album.name}
				data-album={album.id}
				data-drop-target={album.id}
				draggable="true"
				onmousedown={preventMiddle}
				onauxclick={(event) => onAlbumAux(event, album)}
				ondragstart={(event) => startAlbumDrag(event, album.id)}
				ondragover={(event) => hoverCollection(event, album.id)}
				ondragleave={(event) => leaveDrop(event, album.id)}
				ondrop={(event) => dropAlbum(event, album.id)}
			>
				<button
					class="row-main"
					type="button"
					title={album.name}
					aria-current={routeAlbumId === album.id ? 'page' : undefined}
					onclick={() => void activateAlbum(album.id)}
				>
					{#if src}
						<img class="cover" {src} alt="" width="25" height="25" />
					{:else}
						<Icon name="book-image" />
					{/if}
					<span class="label">{album.name}</span>
				</button>
				{@render selectionBadge(album.id)}
				{#if !album.pinned}
					<button
						class="close"
						type="button"
						aria-label="Close view"
						title="Close"
						onclick={(event) => {
							event.stopPropagation();
							void closeTemporary(album.id);
						}}
					>
						<Icon name="x" />
					</button>
				{/if}
			</div>
		{/each}
	</div>
	<div class="destinations">
		{#each destinations as destination (destination.href)}
			<a
				class={[
					'nav-row',
					pathname === destination.href && 'active',
					destination.dest === 'favorites' && dropTarget === 'favorites' && 'drop-target'
				]}
				href={destinationHref(destination.href)}
				aria-current={pathname === destination.href ? 'page' : undefined}
				data-dest={destination.dest}
				data-drop-target={destination.dest === 'favorites' ? 'favorites' : undefined}
				onmousedown={destination.dest === 'favorites' ? preventMiddle : undefined}
				onauxclick={destination.dest === 'favorites' ? onFavoritesAux : undefined}
				ondragover={destination.dest === 'favorites'
					? (event) => hoverCollection(event, 'favorites')
					: undefined}
				ondragleave={destination.dest === 'favorites'
					? (event) => leaveDrop(event, 'favorites')
					: undefined}
				ondrop={destination.dest === 'favorites' ? dropFavorites : undefined}
			>
				<Icon name={destination.icon} />
				<span class="label">{destination.label}</span>
				{@render selectionBadge(destination.dest)}
			</a>
		{/each}
	</div>
	<div class="taskbar" data-task-strip hidden={!tasksActive} {@attach watchJobs}>
		<button
			class={['task-trigger', taskTone, taskIndeterminate && 'indeterminate']}
			type="button"
			aria-label="Background tasks"
			aria-expanded={tasksOpen}
			style:--task-progress="{taskProgress}%"
			onclick={toggleTasks}
		>
			<span></span>
		</button>
		{#if tasksOpen}
			<div class="popup task-popover" data-task-popover>
				<h3>Background tasks</h3>
				<p class="muted">Cancel stops the remaining download. Saved membership stays.</p>
				{#if importsPausable}
					<button class="menu-item" type="button" onclick={() => void pauseAllImports()}>
						Pause all imports
					</button>
				{/if}
				{#each taskImports as task (task.id)}
					<div class="muted">
						{task.destinationName}
						<br />
						{importCount(task)}
						<br />
						{#if task.state === 'failed'}
							{importFailure(task.error)}
						{:else if task.state === 'paused'}
							Paused
						{:else if task.state === 'leased'}
							{task.operation === 'remove' ? 'Removing posts' : 'Adding posts'}
						{:else if task.state === 'queued'}
							Queued
						{:else}
							{task.state}
						{/if}
					</div>
					<div
						class={['task-bar', importProgress(task) == null && 'indeterminate']}
						style:--task-progress="{importProgress(task) ?? 0}%"
						role="progressbar"
						aria-label="{task.destinationName} import"
						aria-valuemin={0}
						aria-valuemax={task.total ?? undefined}
						aria-valuenow={importProgress(task) == null ? undefined : task.addedCount}
						aria-valuetext={importProgress(task) == null ? 'In progress' : undefined}
					>
						<span></span>
					</div>
					{#if task.state === 'failed'}
						<button class="menu-item" type="button" onclick={() => void importAction(task.id, 'retry')}>
							Retry
						</button>
						<button class="menu-item" type="button" onclick={() => void importAction(task.id, 'dismiss')}>
							Dismiss
						</button>
					{:else if task.state === 'paused'}
						<button class="menu-item" type="button" onclick={() => void importAction(task.id, 'resume')}>
							Resume
						</button>
						<button class="menu-item" type="button" onclick={() => void importAction(task.id, 'cancel')}>
							Cancel
						</button>
					{:else if task.state === 'queued' || task.state === 'leased'}
						<button class="menu-item" type="button" onclick={() => void importAction(task.id, 'pause')}>
							Pause
						</button>
						<button class="menu-item" type="button" onclick={() => void importAction(task.id, 'cancel')}>
							Cancel
						</button>
					{/if}
				{/each}
				{#each taskJobs as job (job.id)}
					<div class="muted">
						Original download
						<br />
						{#if job.state === 'failed'}
							{failureCopy(job.error)}
						{:else if job.state === 'leased'}
							Downloading
						{:else if job.state === 'retry'}
							Waiting to retry
						{:else if job.state === 'queued'}
							Queued
						{:else}
							{job.state}
						{/if}
					</div>
					{#if job.state === 'failed'}
						<button class="menu-item" type="button" onclick={() => taskAction(job.id, 'retry')}>Retry</button>
						<button class="menu-item" type="button" onclick={() => taskAction(job.id, 'dismiss')}>Dismiss</button>
					{:else if job.state === 'queued' || job.state === 'retry'}
						<button class="menu-item" type="button" onclick={() => taskAction(job.id, 'cancel')}>Cancel</button>
					{/if}
				{/each}
				{#if taskJobs.length === 0 && taskImports.length === 0}
					<p class="muted">Completed</p>
				{/if}
			</div>
		{/if}
	</div>
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="side-resize"
		role="separator"
		tabindex="0"
		aria-label="Resize sidebar"
		aria-orientation="vertical"
		aria-valuemin={SIDE_MIN}
		aria-valuemax={SIDE_MAX}
		aria-valuenow={sideWidth}
		{@attach bindSideResize}
		onkeydown={onSideKey}
	></div>
</nav>

{#snippet selectionBadge(id: string)}
	{@const label = selectionLabel(id)}
	<span
		class="selection-badge"
		hidden={label === null}
		aria-label="Multi-select mode"
		title={label === null
			? undefined
			: `Multi-select mode · ${label === 'All' ? 'whole query' : `${label} selected`}`}
	>
		<Icon name="check" />
		<span>{label ?? ''}</span>
	</span>
{/snippet}

<style>
	.sidebar {
		position: relative;
		display: flex;
		flex: none;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		padding: 0 10px 12px;
		border-right: 1px solid #22242b;
		background: #101115;
		z-index: 30;
	}

	.sidebar button {
		width: auto;
		height: auto;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 25px 18px 29px;
		color: inherit;
		text-decoration: none;
	}

	.brand strong {
		font-size: 17px;
		font-weight: 620;
		letter-spacing: -0.5px;
	}

	.brand-placeholder {
		flex: none;
		width: 21px;
		height: 24px;
		border: 1px dashed #575c69;
		border-radius: 7px;
	}

	.new-search {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		margin-bottom: 23px;
		padding: 11px 12px;
		border-radius: 9px;
		background: #1b1d24;
		color: #a5a9b4;
		text-align: left;
		--icon-size: 18px;
	}

	.view-list {
		flex: 1;
		min-height: 85px;
		overflow: auto;
		overscroll-behavior: contain;
		scrollbar-color: #343841 transparent;
	}

	.nav-row {
		display: flex;
		align-items: center;
		gap: 10px;
		position: relative;
		min-height: 39px;
		margin: 2px 0;
		padding: 8px 10px;
		border-radius: 8px;
		color: #a5a9b4;
		--icon-size: 15px;
	}

	.nav-row:hover {
		background: #1b1e25;
	}

	.nav-row.active {
		background: #252a35;
		color: #f1f1f7;
	}

	.nav-row.drop-target {
		outline: 1px solid #90a9c5;
		background: #34465a;
	}

	.nav-row.temporary {
		border: 1px dashed #424957;
	}

	.nav-row.pinned {
		border: 1px solid #303641;
	}

	a.nav-row {
		text-decoration: none;
	}

	.row-main {
		display: flex;
		flex: 1;
		align-items: center;
		gap: 10px;
		min-width: 0;
		text-align: left;
	}

	.nav-row .row-main.artist {
		color: var(--red);
	}

	.nav-row .row-main.character {
		color: var(--green);
	}

	.nav-row .row-main.copyright {
		color: var(--pink);
	}

	.nav-row .row-main.metadata {
		color: var(--yellow);
	}

	.nav-row .row-main.general {
		color: var(--blue);
	}

	.nav-row .row-main.deprecated {
		color: #888f99;
	}

	.label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.cover {
		flex: none;
		width: 25px;
		height: 25px;
		object-fit: cover;
		border-radius: 6px;
	}

	.close {
		display: flex;
		flex: none;
		visibility: hidden;
		padding: 1px;
		color: #999;
	}

	.nav-row:hover .close,
	.nav-row:focus-within .close {
		visibility: visible;
	}

	.selection-badge {
		display: inline-flex;
		flex: none;
		align-items: center;
		gap: 3px;
		padding: 2px 5px;
		border: 1px solid #779bc05c;
		border-radius: 6px;
		background: #344b6866;
		color: #bcd4f1;
		font-size: 10px;
		font-variant-numeric: tabular-nums;
		line-height: 15px;
		--icon-size: 11px;
	}

	.selection-badge :global(.icon) {
		stroke-width: 2;
	}

	.section-heading {
		flex: none;
		padding: 0 12px 11px;
		color: #6e7482;
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 1.6px;
	}

	.divider {
		flex: none;
		height: 12px;
		margin: 8px 5px 11px;
		border-top: 1px solid #282b33;
		cursor: ns-resize;
		touch-action: none;
	}

	.album-nav {
		flex: none;
		height: var(--album-height);
		min-height: 70px;
		margin-bottom: 12px;
		overflow: auto;
		overscroll-behavior: contain;
		scrollbar-color: #343841 transparent;
	}

	.album-nav .nav-row {
		margin-bottom: 6px;
	}

	.destinations {
		flex: none;
		padding-top: 10px;
		border-top: 1px solid #262932;
	}

	.taskbar {
		flex: none;
		padding: 10px 5px 0;
	}

	.task-trigger {
		display: block;
		width: 100%;
		height: 4px;
		overflow: hidden;
		padding: 0;
		border-radius: 3px;
		background: #292f3c;
		cursor: pointer;
	}

	.task-trigger span {
		display: block;
		width: var(--task-progress, 0%);
		height: 100%;
		background: #9cb5dd;
	}

	.task-trigger.failed span {
		background: #e07a86;
	}

	.task-trigger.done span {
		width: 100%;
		background: #86ba96;
	}

	.task-trigger.indeterminate span,
	.task-bar.indeterminate span {
		width: 40%;
		animation: task-indeterminate 1.1s ease-in-out infinite;
	}

	.task-bar {
		height: 4px;
		margin: 0 10px 8px;
		overflow: hidden;
		border-radius: 3px;
		background: #292f3c;
	}

	.task-bar span {
		display: block;
		width: var(--task-progress, 0%);
		height: 100%;
		background: #9cb5dd;
	}

	@keyframes task-indeterminate {
		0% {
			transform: translateX(-130%);
		}

		100% {
			transform: translateX(320%);
		}
	}

	.nav-row.viewer-created {
		border: 1px solid #589272;
		background: #243b2f66;
		box-shadow: inset 3px 0 #73b58d;
	}

	.nav-row.viewer-created:hover {
		background: #29463599;
	}

	.nav-row.viewer-created.active {
		background: #304d3e;
	}

	.side-resize {
		position: absolute;
		top: 0;
		right: -3px;
		z-index: 40;
		width: 6px;
		height: 100%;
		cursor: ew-resize;
		touch-action: none;
	}

	.divider:hover,
	.side-resize:hover {
		background: #8e9eb52b;
	}

	.divider:focus-visible,
	.side-resize:focus-visible {
		outline: 2px solid #a4bbdf;
		outline-offset: 3px;
	}
</style>
