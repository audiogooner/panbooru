<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { tick, untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import SearchField from '#lib/SearchField.svelte';
	import Icon from '#lib/Icon.svelte';
	import Thumbnail from '#lib/Thumbnail.svelte';
	import Viewer from '#lib/Viewer.svelte';
	import { playAdd, playRemove } from '#lib/sounds.ts';
	import { favoriteOutline, justifyRows, squirclePath, squircleRadius } from '#lib/justify.ts';
	import { replaceTag } from '#lib/navigation.ts';
	import type { ExplorationPost } from '#lib/navigation.ts';
	import {
		activeView,
		appendPosts,
		commitNavigation,
		hideViewer,
		navigation,
		popNavigation,
		queryFromTag,
		rememberGalleryScroll,
		rememberResultPage,
		rememberResultTags,
		rememberResultsFilled,
		resultPage,
		resultTagsFor,
		resultsFilled,
		showPost,
		storePosts
	} from '#lib/explore.svelte.ts';
	import { openContextMenu } from '#lib/menu.svelte.ts';
	import {
		GALLERY_DRAG,
		adoptLoaded,
		applyAlbumChoice,
		carryDrag,
		createAlbumRequest,
		deselectAll as clearSelection,
		exitSelection as leaveSelection,
		exportRequest,
		galleryClick,
		importRequest,
		isSelected,
		loadAlbumChoices,
		saveDownload,
		selectLoaded,
		selectedIds,
		selectionQuery,
		selectionSnapshot,
		submitImport,
		type DragPost,
		type SelectionQuery
	} from '#lib/selection.svelte.ts';
	import { editingText, matchesShortcut } from '#lib/shortcuts.ts';
	import { ROW_HEIGHT_KEY, bindShellToolbar, getShell } from './+layout.svelte';

	const ratingChoices = ['General', 'Sensitive', 'Questionable', 'Explicit'] as const;
	const mediaChoices = ['Images', 'Animated images', 'Videos'] as const;
	const sortChoices = ['Newest', 'Oldest', 'Highest score', 'Random'] as const;
	let galleryScope: 'exploration' | 'favorites' = 'exploration';
	const pageSize = 20;

	type Sort = (typeof sortChoices)[number];
	type Filters = { rating: string[]; media: string[]; sort: string };
	type BookmarkLabel = 'Save search' | 'Save artist' | 'Save character';
	type StoredFilters = Filters & { seed: number };

	const defaultFilters: StoredFilters = {
		rating: [...ratingChoices],
		media: [...mediaChoices],
		sort: 'Newest',
		seed: 0
	};

	const shell = getShell();
	shell.settings = false;
	shell.overlay = false;
	shell.hidden = false;

	let galleryWidth = $state(960);
	let rowHeight = $state(190);
	let suggestions = $state<{ name: string; count: number; category?: string }[]>([]);
	let storedFilters = $state<Record<string, StoredFilters>>({});
	let savedMatch = $state(false);
	let savedId = $state<string | null>(null);
	let confirmSaved = $state(false);
	let savedLabel = $state<BookmarkLabel | null>(null);
	let tagCategory = $state<string | null>(null);
	let fieldFocused = $state(false);
	let popoverOpen = $state(false);
	let loading = $state(false);
	let error = $state('');
	let settled = $state('');
	let requestId = 0;
	let broken = $state<Record<string, boolean>>({});
	let thumbNonce = $state<Record<string, number>>({});
	const thumbRetries = new SvelteMap<string, number>();
	const favoriteItems = new SvelteMap<string, string>();
	let paging = false;
	let albumPicker = $state<{
		posts: DragPost[];
		left: number;
		top: number;
		whole: boolean;
		albums: { id: string; name: string }[];
		memberships: { albumId: string; itemId: string }[];
	} | null>(null);
	let albumTitle = $state('');
	let albumError = $state('');
	let albumBusy = $state(false);
	let albumToken = 0;
	let downloadError = $state('');

	let rows = $derived(justifyRows(activeView().posts, Math.max(galleryWidth, 320), rowHeight));
	let currentPost = $derived(
		activeView().posts.find((post) => post.id === activeView().postId) ?? null
	);
	let searchKey = $derived(`${navigation.activeId}:${activeView().query}`);
	let showEmpty = $derived(
		!loading &&
			!error &&
			settled === `${activeView().id}:${activeView().query}` &&
			activeView().posts.length === 0 &&
			activeView().query !== ''
	);
	let applied = $derived(filtersFor(activeView().id, activeView().query));
	let selectionKey = $derived(activeView().id);
	let selection = $derived(selectionSnapshot(selectionKey));
	let selecting = $derived(selection.active);
	let orderedIds = $derived(activeView().posts.map((post) => post.id));
	let selectedCount = $derived(selectedIds(selectionKey, orderedIds).length);
	let bookmarkLabel = $derived.by((): BookmarkLabel => {
		if (savedMatch && savedLabel) return savedLabel;
		if (!loneTag(activeView().query)) return 'Save search';
		if (tagCategory === 'artist') return 'Save artist';
		if (tagCategory === 'character') return 'Save character';
		return 'Save search';
	});
	/** Stable across scroll saves so recording position does not refetch the bookmark. */
	let savedMatchKey = $derived.by(() => {
		const view = activeView();
		const filters = filtersFor(view.id, view.query);
		return JSON.stringify({
			query: view.query.trim(),
			rating: filters.rating.length < ratingChoices.length ? filters.rating : null,
			media: filters.media.length < mediaChoices.length ? filters.media : null,
			sort: filters.sort !== 'Newest' ? filters.sort : null
		});
	});
	let tagToken = $derived(loneTag(activeView().query));
	/** Changes when the restored gallery layout is ready, not when scroll is saved. */
	let galleryRestoreKey = $derived.by(() => {
		const view = activeView();
		if (view.mode === 'viewer' || view.posts.length === 0) return '';
		return `${view.id}:${view.posts[0]?.id ?? ''}:${galleryWidth}:${rowHeight}`;
	});

	bindShellToolbar(toolbar);

	function viewKey(id: string, query: string) {
		return `${id}\0${query}`;
	}

	function filtersFor(id: string, query: string) {
		const stored = storedFilters[viewKey(id, query)];
		if (stored) return stored;
		const view = navigation.views.find((item) => item.id === id);
		if (view?.applied && view.applied.query === query) {
			return {
				rating: [...view.applied.rating],
				media: [...view.applied.media],
				sort: view.applied.sort,
				seed: 0
			};
		}
		return defaultFilters;
	}

	function loneTag(query: string) {
		const tokens = query.trim().split(/\s+/).filter(Boolean);
		const token = tokens[0];
		if (tokens.length !== 1 || !token || token.startsWith('-') || token.includes(':')) return null;
		return token;
	}

	$effect(() => {
		const payload = JSON.parse(savedMatchKey) as {
			query: string;
			rating: string[] | null;
			media: string[] | null;
			sort: string | null;
		};
		const controller = new AbortController();
		savedMatch = false;
		savedId = null;
		savedLabel = null;
		void highlightSaved(
			{
				query: payload.query,
				...(payload.rating ? { rating: payload.rating } : {}),
				...(payload.media ? { media: payload.media } : {}),
				...(payload.sort ? { sort: payload.sort } : {})
			},
			controller.signal
		);
		return () => controller.abort();
	});

	$effect(() => {
		const token = tagToken;
		tagCategory = null;
		if (!token) return;
		const controller = new AbortController();
		void (async () => {
			try {
				const response = await fetch('/api/source/gelbooru/tags', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ names: [token] }),
					signal: controller.signal
				});
				if (!response.ok || controller.signal.aborted) return;
				const body = (await response.json()) as {
					data: { tags: { name: string; category: string }[] };
				};
				const match = body.data.tags.find((tag) => tag.name === token);
				if (!controller.signal.aborted) tagCategory = match?.category ?? null;
			} catch {
				// An unknown category keeps the bookmark on Save search.
			}
		})();
		return () => controller.abort();
	});

	function scopeMatches(stored: SelectionQuery, scope: SelectionQuery) {
		return (
			stored.source === scope.source &&
			stored.sourceAlbumId === scope.sourceAlbumId &&
			stored.query === scope.query &&
			stored.sort === scope.sort &&
			stored.rating.join('\0') === scope.rating.join('\0') &&
			stored.media.join('\0') === scope.media.join('\0')
		);
	}

	function currentScope(): SelectionQuery {
		return {
			source: 'gelbooru',
			sourceAlbumId: null,
			query: activeView().query.trim(),
			rating: [...applied.rating],
			media: [...applied.media],
			sort: applied.sort,
			seed: applied.seed
		};
	}

	const anchorInset = 8;
	/** False until the restored position has been written, so the first scroll event cannot wipe it. */
	let acceptingGalleryScroll = false;

	$effect.pre(() => {
		// Block scroll recording before the gallery DOM swaps to another view or layout.
		void galleryRestoreKey;
		acceptingGalleryScroll = false;
	});

	function watchScroll() {
		const scroller = document.getElementById('scroll');
		if (!scroller) return;
		let last = scroller.scrollTop;
		let frame = 0;
		const publish = () => {
			if (!acceptingGalleryScroll || activeView().mode === 'viewer') return;
			const anchor = captureAnchor();
			rememberGalleryScroll(scroller.scrollTop, anchor?.id ? anchor : null);
		};
		const onScroll = () => {
			const top = scroller.scrollTop;
			shell.overlay = top > 24;
			if (!acceptingGalleryScroll || activeView().mode === 'viewer') {
				last = top;
				return;
			}
			const locked = fieldFocused || popoverOpen || selecting;
			shell.hidden = !locked && top > last && top > 100;
			last = top;
			if (!frame) {
				const viewId = navigation.activeId;
				frame = requestAnimationFrame(() => {
					frame = 0;
					if (navigation.activeId !== viewId) return;
					publish();
				});
			}
			if (scroller.scrollTop + scroller.clientHeight > scroller.scrollHeight - 900) {
				void loadMore();
			}
		};
		const onHide = () => {
			if (frame) cancelAnimationFrame(frame);
			frame = 0;
			publish();
		};
		scroller.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('pagehide', onHide);
		// Read after this attachment's setup so scroll saves do not rebind the listener.
		queueMicrotask(() => {
			shell.overlay = scroller.scrollTop > 24;
		});
		return () => {
			scroller.removeEventListener('scroll', onScroll);
			window.removeEventListener('pagehide', onHide);
			if (frame) cancelAnimationFrame(frame);
		};
	}

	function applyGalleryScroll(scroll: number, anchor: { id: string; offset: number } | null) {
		const scroller = document.getElementById('scroll');
		if (!scroller) return;
		acceptingGalleryScroll = false;
		scroller.scrollTop = scroll;
		restoreAnchor(anchor);
		shell.overlay = scroller.scrollTop > 24;
		acceptingGalleryScroll = true;
		if (scroller.scrollTop + scroller.clientHeight > scroller.scrollHeight - 900) {
			queueMicrotask(() => {
				void loadMore();
			});
		}
	}

	/** After the restored view's posts are in the gallery, put its scroll back on `#scroll`. */
	function restoreGalleryPosition() {
		const key = galleryRestoreKey;
		if (!key) return;
		const scroll = untrack(() => activeView().scroll);
		const anchor = untrack(() => {
			const saved = activeView().scrollAnchor;
			return saved ? { id: saved.id, offset: saved.offset } : null;
		});
		applyGalleryScroll(scroll, anchor);
	}

	function readRowHeight() {
		try {
			const value = Number(localStorage.getItem(ROW_HEIGHT_KEY));
			if (!Number.isFinite(value)) return 190;
			return Math.min(300, Math.max(110, Math.round(value)));
		} catch {
			return 190;
		}
	}

	function publishRow(value: number) {
		rowHeight = value;
		document.documentElement.style.setProperty('--row', `${value}px`);
	}

	function applyStoredRow() {
		publishRow(readRowHeight());
	}

	async function onrowheight(value: number) {
		const anchor = captureAnchor();
		publishRow(value);
		try {
			localStorage.setItem(ROW_HEIGHT_KEY, String(value));
		} catch {
			// Preference storage is unavailable in this browser context.
		}
		await tick();
		restoreAnchor(anchor);
	}

	function captureAnchor() {
		const scroller = document.getElementById('scroll');
		if (!scroller) return null;
		const line = scroller.getBoundingClientRect().top + anchorInset;
		for (const tile of scroller.querySelectorAll<HTMLElement>('[data-post]')) {
			const rect = tile.getBoundingClientRect();
			if (rect.bottom > line) return { id: tile.dataset.post ?? '', offset: rect.top - line };
		}
		return null;
	}

	function restoreAnchor(anchor: { id: string; offset: number } | null) {
		if (!anchor?.id) return;
		const scroller = document.getElementById('scroll');
		const tile = scroller?.querySelector<HTMLElement>(`[data-post="${CSS.escape(anchor.id)}"]`);
		if (!scroller || !tile) return;
		const line = scroller.getBoundingClientRect().top + anchorInset;
		scroller.scrollTop += tile.getBoundingClientRect().top - line - anchor.offset;
	}

	function onchrome(state: { focused: boolean; popover: boolean }) {
		fieldFocused = state.focused;
		popoverOpen = state.popover;
		if (state.focused || state.popover || selecting) shell.hidden = false;
	}

	function favorited(post: ExplorationPost) {
		return (post as ExplorationPost & { favorite?: boolean }).favorite === true;
	}

	function showOutline(post: ExplorationPost) {
		return favorited(post) && (galleryScope as string) !== 'favorites';
	}

	function fillHeart(post: ExplorationPost) {
		return (galleryScope as string) === 'favorites' || favorited(post);
	}

	function kindIcon(post: ExplorationPost): 'film' | 'animate' | null {
		if (post.kind === 'video') return 'film';
		const type = post.mediaType ?? '';
		if (type.includes('gif') || type.includes('webp') || type.includes('apng')) return 'animate';
		return null;
	}

	function sortTag(sort: string, seed: number) {
		if (sort === 'Oldest') return 'sort:id:asc';
		if (sort === 'Highest score') return 'sort:score';
		if (sort === 'Random') return `sort:random:${seed}`;
		return '';
	}

	function mediaTag(selected: readonly string[]) {
		const images = selected.includes('Images');
		const animated = selected.includes('Animated images');
		const videos = selected.includes('Videos');
		if ((images && animated && videos) || (!images && !animated && !videos)) return '';
		if (videos && !images && !animated) return 'video';
		if (animated && !images && !videos) return 'animated';
		if (!images) return '';
		return [videos ? '' : '-video', animated ? '' : '-animated'].filter(Boolean).join(' ');
	}

	function upstreamQuery(query: string) {
		const extra = [sortTag(applied.sort, applied.seed), mediaTag(applied.media)].filter(Boolean);
		return extra.length ? `${query} ${extra.join(' ')}`.trim() : query;
	}

	async function highlightSaved(
		payload: { query: string; rating?: string[]; media?: string[]; sort?: string },
		signal: AbortSignal
	) {
		try {
			const response = await fetch('/api/library/saved-searches/match', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload),
				signal
			});
			if (!response.ok || signal.aborted) return;
			const body = (await response.json()) as {
				data: { id?: string; bookmarkLabel?: BookmarkLabel } | null;
			};
			if (signal.aborted) return;
			savedMatch = body.data != null;
			savedId = body.data?.id ?? null;
			savedLabel = body.data?.bookmarkLabel ?? null;
		} catch {
			// A replaced search match is aborted.
		}
	}

	async function suggest(value: string) {
		const pattern = (value.split(/\s+/).at(-1) ?? '').replace(/^-/, '');
		if (pattern.length < 2) {
			suggestions = [];
			return;
		}
		const response = await fetch('/api/source/gelbooru/autocomplete', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ pattern })
		});
		if (!response.ok) return;
		const body = (await response.json()) as {
			data: { suggestions: { name: string; count: number; category?: string }[] };
		};
		suggestions = body.data.suggestions;
	}

	async function fetchPage(tags: string, page: number) {
		const response = await fetch('/api/source/gelbooru/search', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				query: tags,
				page,
				...(applied.rating.length < ratingChoices.length
					? { ratings: applied.rating.map((item) => item.toLowerCase()) }
					: {})
			})
		});
		if (!response.ok) return null;
		const body = (await response.json()) as {
			data: {
				posts: {
					id: string;
					tags: string[];
					width: number;
					height: number;
					mediaRef: string;
					rating?: string;
					kind?: 'image' | 'video';
					mediaType?: string;
				}[];
			};
		};
		return body.data.posts;
	}

	async function load(query: string) {
		const id = ++requestId;
		// A page already in flight belongs to the previous query. Its finally
		// leaves `paging` set when the request id moves on, which blocks every
		// later pid. This search owns the pager now.
		paging = false;
		const viewId = activeView().id;
		loading = true;
		error = '';
		const tags = upstreamQuery(query);
		rememberResultTags(viewId, tags);
		rememberResultPage(viewId, 0);
		rememberResultsFilled(viewId, false);
		let follow = false;
		try {
			const posts = await fetchPage(tags, 0);
			if (id !== requestId) return;
			if (!posts) {
				error = 'Search failed';
				return;
			}
			storePosts(posts);
			const filled = posts.length < pageSize;
			rememberResultsFilled(viewId, filled);
			rememberResultPage(viewId, filled ? 0 : 1);
			adoptLoaded(viewId, posts.map((post) => post.id));
			settled = `${activeView().id}:${activeView().query}`;
			follow = !filled;
		} catch {
			if (id !== requestId) return;
			error = 'Search failed';
		} finally {
			if (id === requestId) loading = false;
		}
		if (follow && id === requestId) await ensureFilled();
	}

	async function loadMore() {
		const view = activeView();
		if (paging || resultsFilled(view.id) || loading || error || view.posts.length === 0) return;
		const id = requestId;
		const viewId = view.id;
		const page = resultPage(viewId, view.posts.length, pageSize);
		const tags = resultTagsFor(viewId) || upstreamQuery(view.query);
		paging = true;
		let follow = false;
		try {
			const posts = await fetchPage(tags, page);
			if (id !== requestId || !posts) return;
			appendPosts(posts);
			const filled = posts.length < pageSize;
			rememberResultsFilled(viewId, filled);
			if (!filled) rememberResultPage(viewId, page + 1);
			adoptLoaded(viewId, activeView().posts.map((post) => post.id));
			follow = !filled;
		} catch {
			// The next scroll can try this page again.
		} finally {
			if (id === requestId) paging = false;
		}
		if (follow && id === requestId) await ensureFilled();
	}

	/** Keep asking for the next pid while the lookahead is still inside the loaded posts. */
	async function ensureFilled() {
		await tick();
		const view = activeView();
		if (paging || resultsFilled(view.id) || loading || error || view.posts.length === 0) return;
		const scroller = document.getElementById('scroll');
		if (!scroller) return;
		if (scroller.scrollTop + scroller.clientHeight > scroller.scrollHeight - 900) {
			await loadMore();
		}
	}

	async function search(draft: string, filters?: Filters) {
		suggestions = [];
		leaveSelection(navigation.activeId);
		const sort = sortChoices.find((item) => item === filters?.sort) ?? applied.sort;
		storedFilters[viewKey(navigation.activeId, draft)] = {
			rating: filters?.rating ?? [...applied.rating],
			media: filters?.media ?? [...applied.media],
			sort,
			seed: sort === 'Random' ? Math.floor(Math.random() * 10001) : 0
		};
		broken = {};
		thumbNonce = {};
		thumbRetries.clear();
		storePosts([]);
		error = '';
		loading = true;
		const scroller = document.getElementById('scroll');
		if (scroller) scroller.scrollTop = 0;
		shell.overlay = false;
		shell.hidden = false;
		commitNavigation(replaceTag(navigation, draft));
		await load(draft);
	}

	function appliedPayload() {
		return {
			query: activeView().query.trim(),
			...(applied.rating.length < ratingChoices.length ? { rating: applied.rating } : {}),
			...(applied.media.length < mediaChoices.length ? { media: applied.media } : {}),
			...(applied.sort !== 'Newest' ? { sort: applied.sort } : {})
		};
	}

	function postBody(post: ExplorationPost) {
		return {
			remoteId: post.id,
			tags: post.tags,
			width: post.width,
			height: post.height,
			mediaRef: post.mediaRef,
			...(post.rating ? { rating: post.rating } : {})
		};
	}

	function toDrag(post: ExplorationPost): DragPost {
		return {
			remoteId: post.id,
			tags: post.tags,
			width: post.width,
			height: post.height,
			mediaRef: post.mediaRef,
			...(post.rating ? { rating: post.rating } : {}),
			...(favoriteItems.get(post.id) ? { itemId: favoriteItems.get(post.id) } : {})
		};
	}

	function saveType(): 'search' | 'artist' | 'character' {
		if (bookmarkLabel === 'Save artist') return 'artist';
		if (bookmarkLabel === 'Save character') return 'character';
		return 'search';
	}

	async function requestSaveSearch() {
		if (savedMatch) {
			confirmSaved = savedId !== null;
			return;
		}
		const response = await fetch('/api/library/saved-searches', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				...appliedPayload(),
				type: saveType(),
				name: activeView().query.trim() || 'All posts'
			})
		});
		if (response.status === 409) {
			const conflict = (await response.json().catch(() => null)) as { matchId?: string } | null;
			savedMatch = true;
			savedId = conflict?.matchId ?? savedId;
			return;
		}
		if (!response.ok) return;
		const body = (await response.json().catch(() => null)) as {
			data?: { id?: string; bookmarkLabel?: BookmarkLabel };
		} | null;
		savedMatch = true;
		savedId = body?.data?.id ?? null;
		savedLabel = body?.data?.bookmarkLabel ?? savedLabel;
	}

	async function deleteSavedSearch() {
		if (!savedId) return;
		const response = await fetch(`/api/library/saved-searches/${encodeURIComponent(savedId)}`, {
			method: 'DELETE'
		});
		if (!response.ok) return;
		savedMatch = false;
		savedId = null;
		savedLabel = null;
		confirmSaved = false;
	}

	function exitSelection() {
		hideAlbumPicker();
		leaveSelection(selectionKey);
	}

	function toggleSelectAll() {
		selectLoaded(selectionKey, orderedIds, currentScope());
	}

	function deselectAll() {
		clearSelection(selectionKey);
	}

	function hideAlbumPicker() {
		albumToken += 1;
		albumPicker = null;
	}

	function membershipCount(albumId: string) {
		if (!albumPicker) return 0;
		return new Set(
			albumPicker.memberships.filter((item) => item.albumId === albumId).map((item) => item.itemId)
		).size;
	}

	async function openAlbumPicker(posts: DragPost[], anchor: HTMLElement | null, whole: boolean) {
		if (!whole && !posts.length) return;
		const token = ++albumToken;
		const rect = anchor?.getBoundingClientRect();
		albumTitle = '';
		albumError = '';
		albumPicker = {
			posts,
			left: rect?.left ?? 80,
			top: (rect?.bottom ?? 64) + 8,
			whole,
			albums: [],
			memberships: []
		};
		const loaded = await loadAlbumChoices(whole ? [] : posts);
		if (token !== albumToken || !albumPicker || !loaded) return;
		albumPicker.albums = loaded.albums;
		albumPicker.memberships = loaded.memberships;
	}

	async function toggleListedAlbum(albumId: string) {
		if (!albumPicker || albumPicker.whole || albumBusy) return;
		albumBusy = true;
		albumError = '';
		const token = albumToken;
		const posts = albumPicker.posts;
		try {
			const result = await applyAlbumChoice(albumId, posts, albumPicker.memberships);
			if (result === 'add') playAdd();
			else if (result === 'remove') playRemove();
			else if (result === 'failed') albumError = 'Album could not be updated';
			const loaded = await loadAlbumChoices(posts);
			if (token === albumToken && albumPicker && loaded) {
				albumPicker.albums = loaded.albums;
				albumPicker.memberships = loaded.memberships;
			}
			await invalidateAll();
		} finally {
			albumBusy = false;
		}
	}

	async function addQueryToAlbum(albumId: string) {
		if (!albumPicker?.whole || albumBusy) return;
		const body = importRequest(selectionKey, { operation: 'add', destination: 'album', albumId });
		if (!body) return;
		albumBusy = true;
		albumError = '';
		try {
			const ok = await submitImport(body);
			if (!ok) {
				albumError = 'Album could not be updated';
				return;
			}
			playAdd();
			hideAlbumPicker();
			await invalidateAll();
		} finally {
			albumBusy = false;
		}
	}

	async function createFromPicker() {
		if (!albumPicker || albumBusy) return;
		const created = await createAlbumRequest(albumTitle);
		if (!('id' in created)) {
			albumError = created.message;
			return;
		}
		albumTitle = '';
		if (albumPicker.whole) await addQueryToAlbum(created.id);
		else await toggleListedAlbum(created.id);
	}

	function requestBulkAlbum(anchor?: HTMLElement | null) {
		const target =
			anchor ?? document.querySelector<HTMLElement>('[data-selection-bar] [data-action="add-album"]');
		if (selectionQuery(selectionKey)) {
			void openAlbumPicker([], target, true);
			return;
		}
		const posts = carryDrag(
			selectionKey,
			orderedIds.find((id) => isSelected(selectionKey, id)) ?? '',
			activeView().posts
		).map(toDrag);
		void openAlbumPicker(posts, target, false);
	}

	async function requestBulkFavorite() {
		const posts = activeView().posts.filter((post) => isSelected(selectionKey, post.id));
		const removing = posts.length > 0 && posts.every((post) => favoriteItems.has(post.id));
		const body = importRequest(selectionKey, {
			operation: removing ? 'remove' : 'add',
			destination: 'favorite'
		});
		if (body) {
			downloadError = '';
			const ok = await submitImport(body);
			if (!ok) {
				downloadError = 'Favorites could not be updated.';
				return;
			}
			if (removing) playRemove();
			else playAdd();
			return;
		}
		if (!posts.length) return;
		const results = await Promise.all(
			posts.map((post) => requestTileFavorite(post.id, removing ? 'remove' : 'add'))
		);
		if (results.some((result) => result === 'failed')) return;
		if (removing && results.some((result) => result === 'remove')) playRemove();
		else if (results.some((result) => result === 'add')) playAdd();
	}

	async function requestBulkDownload() {
		const ids = selectedIds(selectionKey, orderedIds);
		if (!selectionQuery(selectionKey) && ids.length === 1) {
			const post = activeView().posts.find((item) => item.id === ids[0]);
			if (post) await downloadPost(post);
			return;
		}
		const body = exportRequest(selectionKey, ids);
		if (body) await downloadExport(body);
	}

	function requestTileAlbum(postId: string, anchor?: HTMLElement | null) {
		const post = activeView().posts.find((item) => item.id === postId);
		if (!post) return;
		void openAlbumPicker([toDrag(post)], anchor ?? null, false);
	}

	async function requestTileFavorite(
		postId: string,
		force?: 'add' | 'remove'
	): Promise<'add' | 'remove' | 'noop' | 'failed'> {
		const post = activeView().posts.find((item) => item.id === postId);
		if (!post) return 'noop';
		const existing = favoriteItems.get(postId);
		if (existing && force !== 'add') {
			const response = await fetch(`/api/library/favorites/${encodeURIComponent(existing)}`, {
				method: 'DELETE'
			});
			if (!response.ok) return 'failed';
			favoriteItems.delete(postId);
			return 'remove';
		}
		if (existing) return 'noop';
		const response = await fetch('/api/library/favorites', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(postBody(post))
		});
		if (!response.ok) return 'failed';
		const body = (await response.json().catch(() => null)) as { data?: { itemId?: string } } | null;
		if (body?.data?.itemId) favoriteItems.set(postId, body.data.itemId);
		return 'add';
	}

	async function finishFavorite(postId: string) {
		const result = await requestTileFavorite(postId);
		if (result === 'add') playAdd();
		else if (result === 'remove') playRemove();
	}

	async function downloadExport(body: Record<string, unknown>) {
		downloadError = '';
		try {
			const response = await fetch('/api/library/exports', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (response.status === 413) {
				downloadError = 'That selection is too large to download.';
				return;
			}
			if (!response.ok) {
				downloadError = 'The download could not be prepared.';
				return;
			}
			await saveDownload(response, 'panbooru.zip');
		} catch {
			downloadError = 'The download could not be prepared.';
		}
	}

	async function downloadPost(post: ExplorationPost) {
		const response = await fetch(`/api/media/${post.mediaRef}?download=1`);
		if (!response.ok) return;
		await saveDownload(response, 'original');
	}

	function onTileClick(postId: string, event: MouseEvent) {
		const result = galleryClick(selectionKey, postId, orderedIds, event);
		if (result === 'open') showPost(postId);
	}

	function onTileDrag(event: DragEvent, post: ExplorationPost) {
		if (event.target instanceof Element && event.target.closest('.tile-action, .retry-thumb')) {
			event.preventDefault();
			return;
		}
		const posts = carryDrag(selectionKey, post.id, activeView().posts).map(toDrag);
		event.dataTransfer?.setData(GALLERY_DRAG, JSON.stringify(posts));
		event.dataTransfer?.setData('text/plain', JSON.stringify(posts));
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
	}

	function onTileMenu(event: MouseEvent, post: ExplorationPost) {
		const saved = favoriteItems.has(post.id);
		openContextMenu(
			event,
			[
				{ id: 'album', label: 'Add to album', icon: 'book-image' },
				{ id: 'favorite', label: saved ? 'Unfavorite' : 'Favorite', icon: 'heart' },
				{ id: 'download', label: 'Download', icon: 'download' },
				{ id: 'source', label: 'Open booru page', icon: 'external' }
			],
			(action) => {
				if (action === 'album') requestTileAlbum(post.id, event.currentTarget as HTMLElement);
				else if (action === 'favorite') void finishFavorite(post.id);
				else if (action === 'download') void downloadPost(post);
				else if (action === 'source') {
					window.open(
						`https://gelbooru.com/index.php?page=post&s=view&id=${encodeURIComponent(post.id)}`,
						'_blank',
						'noopener'
					);
				}
			}
		);
	}

	function closeAlbumPicker(event: PointerEvent) {
		if (!albumPicker) return;
		const target = event.target;
		if (target instanceof Element && target.closest('.album-picker, [data-action="add-album"]')) return;
		hideAlbumPicker();
	}

	function onGalleryKey(event: KeyboardEvent) {
		if (editingText(event.target)) return;
		if (document.querySelector('dialog[open]')) return;
		if (activeView().mode === 'viewer') return;
		if (event.key === 'Escape' && albumPicker) {
			event.preventDefault();
			hideAlbumPicker();
			return;
		}
		if (matchesShortcut(event, 'select-all')) {
			event.preventDefault();
			toggleSelectAll();
			return;
		}
		if (matchesShortcut(event, 'deselect')) {
			event.preventDefault();
			if (selecting) deselectAll();
			return;
		}
		if (event.key === 'Escape' && confirmSaved) {
			event.preventDefault();
			confirmSaved = false;
			return;
		}
		if (event.key === 'Escape' && selecting) {
			event.preventDefault();
			exitSelection();
		}
	}

	async function onTag(
		tag: string,
		event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean; button?: number },
		anchor?: HTMLElement
	) {
		suggestions = [];
		const id = activeView().id;
		const previous = filtersFor(id, activeView().query);
		if (!queryFromTag(tag, event, anchor)) return;
		leaveSelection(id);
		const next = activeView().query;
		storedFilters[viewKey(id, next)] ??= {
			rating: [...previous.rating],
			media: [...previous.media],
			sort: previous.sort,
			seed: previous.seed
		};
		await load(next);
	}

	function onPop(event: PopStateEvent) {
		const cursor = typeof event.state?.cursor === 'number' ? event.state.cursor : 0;
		popNavigation(cursor);
		const stored = selectionQuery(activeView().id);
		if (stored && !scopeMatches(stored, currentScope())) leaveSelection(activeView().id);
		void load(activeView().query);
	}

	function onImageError(postId: string, img: HTMLImageElement) {
		const count = thumbRetries.get(postId) ?? 0;
		if (count >= 1) {
			broken[postId] = true;
			return;
		}
		thumbRetries.set(postId, 1);
		window.setTimeout(() => {
			if (!img.isConnected) return;
			const next = new URL(img.src, window.location.origin);
			next.searchParams.set('retry', '1');
			img.src = `${next.pathname}${next.search}`;
		}, 1000);
	}

	function retryThumb(postId: string) {
		delete broken[postId];
		thumbRetries.delete(postId);
		thumbNonce[postId] = (thumbNonce[postId] ?? 0) + 1;
	}

	function tilePreview(post: ExplorationPost) {
		const nonce = thumbNonce[post.id] ?? 0;
		const base = `/api/media/${post.mediaRef}?recipe=thumb`;
		return nonce ? `${base}&retry=${nonce}` : base;
	}
</script>

<svelte:window
	onpopstate={onPop}
	onkeydown={onGalleryKey}
	onpointerdown={closeAlbumPicker}
	onstorage={(event) => event.key === ROW_HEIGHT_KEY && applyStoredRow()}
/>

{#snippet toolbar()}
	<div class="toolbar-slot" {@attach watchScroll}>
		{#key searchKey}
			<SearchField
				initial={activeView().query}
				{suggestions}
				{selecting}
				{selectedCount}
				allQuery={selection.allQuery && selection.excluded === 0}
				applied={{ rating: applied.rating, media: applied.media, sort: applied.sort }}
				saved={savedMatch}
				{bookmarkLabel}
				{rowHeight}
				oninput={suggest}
				onsearch={search}
				{onchrome}
				{onrowheight}
				onbookmark={requestSaveSearch}
				onexitselection={exitSelection}
				onselectall={toggleSelectAll}
				ondeselect={deselectAll}
				onalbum={requestBulkAlbum}
				onfavorite={requestBulkFavorite}
				ondownload={requestBulkDownload}
			/>
		{/key}
	</div>
{/snippet}

{#if activeView().mode === 'viewer' && currentPost}
	<Viewer
		post={currentPost}
		posts={activeView().posts}
		onclose={hideViewer}
		ontag={onTag}
		onmove={showPost}
	/>
{:else}
	<section class="explore" {@attach applyStoredRow}>
		{#if downloadError}
			<p class="notice" role="alert">{downloadError}</p>
		{/if}
		<div class="frame" bind:clientWidth={galleryWidth}>
			{#if error}
				<p class="notice">
					{error}
					<button type="button" onclick={() => void load(activeView().query)}>Retry</button>
				</p>
			{:else if loading && activeView().posts.length === 0}
				<div class="gallery" aria-hidden="true">
					<div class="row">
						{#each [0, 1, 2, 3, 4, 5] as item (item)}
							<div class="tile placeholder" style:width="180px" style:height="{rowHeight}px"></div>
						{/each}
					</div>
				</div>
			{:else if showEmpty}
				<p class="notice">No results</p>
			{:else}
				<div class="gallery" data-scope={galleryScope} {@attach restoreGalleryPosition}>
					{#each rows as row (row.map((post) => post.id).join(','))}
						<div class="row">
							{#each row as post (post.id)}
								{@const width = Math.max(post.width, 1)}
								{@const height = Math.max(post.height, 1)}
								{@const icon = kindIcon(post)}
								{@const outline = showOutline(post)}
								<article
									class={[
										'tile',
										outline && 'favorite',
										isSelected(selectionKey, post.id) && 'selected',
										broken[post.id] && 'broken'
									]}
									data-post={post.id}
									draggable="true"
									style:width="{width}px"
									style:height="{height}px"
									style:--squircle={`path('${squirclePath(width, height, squircleRadius)}')`}
									ondragstart={(event) => onTileDrag(event, post)}
									oncontextmenu={(event) => onTileMenu(event, post)}
								>
									<span class="selection-badge" aria-hidden="true"><Icon name="check" /></span>
									<button type="button" class="open" onclick={(event) => onTileClick(post.id, event)}>
										<Thumbnail
											src={tilePreview(post)}
											alt={post.tags.join(' ')}
											width={Math.round(width)}
											height={Math.round(height)}
											onerror={(event) => {
												const img = event.currentTarget;
												if (img instanceof HTMLImageElement) onImageError(post.id, img);
											}}
										/>
									</button>
									{#if outline}
										<svg
											class="favorite-outline"
											viewBox="0 0 {width} {height}"
											aria-hidden="true"
										>
											<path
												d={favoriteOutline(width, height)}
												transform="translate(1 1)"
												fill="none"
												stroke="#d86d7d"
												stroke-width="2"
												stroke-linejoin="round"
											/>
										</svg>
									{/if}
									{#if icon}
										<span class="kind"><Icon name={icon} /></span>
									{/if}
									<div class="tile-actions">
										<button
											type="button"
											class="tile-action"
											data-action="add-album"
											title="Add to album"
											aria-label="Add to album"
											onclick={(event) => {
												event.stopPropagation();
												requestTileAlbum(post.id, event.currentTarget);
											}}
										>
											<Icon name="book-image" />
										</button>
										<button
											type="button"
											class={[
												'tile-action',
												fillHeart(post) && 'hearted'
											]}
											data-action="favorite"
											title="Favorite"
											aria-label="Favorite"
											onclick={() => void finishFavorite(post.id)}
										>
											<Icon name="heart" />
										</button>
									</div>
									{#if broken[post.id]}
										<button
											type="button"
											class="retry-thumb"
											aria-label="Retry thumbnail"
											onclick={() => retryThumb(post.id)}
										>
											<Icon name="image" />
										</button>
									{/if}
								</article>
							{/each}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</section>
{/if}

{#if albumPicker}
	<div
		class="popup album-picker"
		style:left="{albumPicker.left}px"
		style:top="{albumPicker.top}px"
	>
		<h3>{albumPicker.whole ? 'Add matching posts' : 'Albums'}</h3>
		{#each albumPicker.albums as album (album.id)}
			{@const count = membershipCount(album.id)}
			{@const total = albumPicker.posts.length}
			{@const complete = count === total && total > 0}
			{@const partial = count > 0 && count < total}
			{#if albumPicker.whole}
				<button type="button" class="menu-item" onclick={() => void addQueryToAlbum(album.id)}>
					{album.name}
				</button>
			{:else}
				<label>
					<input
						type="checkbox"
						checked={complete}
						onchange={() => void toggleListedAlbum(album.id)}
						{@attach (node) => {
							node.indeterminate = partial;
							node.checked = complete;
						}}
					/>
					{album.name}
				</label>
			{/if}
		{:else}
			<p class="muted">No albums yet</p>
		{/each}
		<form
			onsubmit={(event) => {
				event.preventDefault();
				void createFromPicker();
			}}
		>
			<input
				bind:value={albumTitle}
				aria-label="New album title"
				placeholder="New album"
				maxlength="80"
			/>
			<button type="submit">Create</button>
		</form>
		{#if albumError}<p class="notice" role="alert">{albumError}</p>{/if}
	</div>
{/if}

{#if confirmSaved}
	<div class="popup confirm-saved" role="dialog" aria-label="Delete this saved search?">
		<h3>Delete this saved search?</h3>
		<button type="button" onclick={() => (confirmSaved = false)}>Cancel</button>
		<button type="button" class="danger" onclick={() => void deleteSavedSearch()}>Delete</button>
	</div>
{/if}

<style>
	.toolbar-slot {
		display: contents;
	}

	.confirm-saved {
		top: 38%;
		left: 50%;
		display: grid;
		gap: 6px;
		transform: translateX(-50%);
	}

	.explore {
		min-height: 100%;
		padding: 0 26px 24px;
	}

	.frame,
	.gallery {
		width: 100%;
	}

	.gallery {
		display: grid;
		gap: 4px;
	}

	.row {
		display: flex;
		gap: 4px;
	}

	.notice {
		margin: 28px 0;
		color: #8d98ac;
	}

	.notice button {
		margin-left: 8px;
		padding: 0 12px;
		border: 1px solid #343842;
		border-radius: 8px;
		background: #20232b;
		color: inherit;
	}

	.tile {
		position: relative;
		flex: none;
		overflow: hidden;
		border: 0;
		border-radius: 17px;
		background: #191e25;
	}

	.tile.placeholder {
		opacity: 0.45;
	}

	@supports (corner-shape: squircle) {
		.tile {
			border-radius: 23px;
			corner-shape: squircle;
		}
	}

	@supports not (corner-shape: squircle) {
		.tile {
			border-radius: 0;
			clip-path: var(--squircle);
		}
	}

	.open {
		position: absolute;
		inset: 0;
		z-index: 1;
		width: 100%;
		height: 100%;
		padding: 0;
		border: 0;
		background: transparent;
	}

	.tile.selected :global(.thumb) {
		filter: brightness(0.68);
	}

	.selection-badge {
		display: none;
		position: absolute;
		top: 9px;
		left: 9px;
		z-index: 5;
		width: 20px;
		height: 20px;
		place-items: center;
		border-radius: 50%;
		background: #bfd3f5;
		color: #172238;
		--icon-size: 12px;
	}

	.tile.selected .selection-badge {
		display: grid;
	}

	.favorite-outline {
		position: absolute;
		inset: 0;
		z-index: 3;
		width: 100%;
		height: 100%;
		overflow: visible;
		pointer-events: none;
	}

	.favorite-outline path {
		filter: none;
		opacity: 1;
	}

	.kind {
		position: absolute;
		bottom: 7px;
		left: 7px;
		z-index: 2;
		color: white;
		pointer-events: none;
		--icon-size: 16px;
	}

	.tile-actions {
		position: absolute;
		top: 7px;
		right: 7px;
		z-index: 4;
		display: flex;
		gap: 5px;
		opacity: 0;
	}

	.tile:hover .tile-actions,
	.tile:focus-within .tile-actions {
		opacity: 1;
	}

	.tile-action,
	.retry-thumb {
		display: grid;
		place-items: center;
		width: 29px;
		height: 29px;
		padding: 0;
		border: 0;
		border-radius: 9px;
		background: #10131c9c;
		color: white;
		backdrop-filter: blur(12px);
		--icon-size: 16px;
	}

	.tile-action:hover,
	.retry-thumb:hover {
		background: #292e3bd9;
	}

	.tile-action.hearted {
		color: var(--red);
	}

	.tile-action.hearted :global(svg) {
		fill: currentColor;
	}

	.retry-thumb {
		position: absolute;
		right: 8px;
		bottom: 8px;
		z-index: 5;
		width: 36px;
		height: 36px;
	}

	.gallery[data-scope='favorites'] .favorite-outline {
		display: none;
	}
</style>
