import { browser } from '$app/env';
import { goto } from '$app/navigation';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import {
	appendTag,
	back,
	closeView,
	closeViewer,
	createNavigation,
	forward,
	newView,
	openPost,
	replaceTag,
	restoreNavigation,
	type ExplorationPost,
	type NavigationState,
	type ScrollAnchor
} from '#lib/navigation.ts';
import { showBackgroundNotice } from '#lib/notice.svelte.ts';
import {
	checkpointFromViews,
	explorationViews,
	patchCheckpoint,
	readCheckpoint,
	readHistoryCursor,
	rehydrateHistory
} from '#lib/workspace.ts';

function initialNavigation(): NavigationState {
	if (!browser) return createNavigation();
	try {
		const saved = readCheckpoint(sessionStorage);
		if (!saved?.views.length) return createNavigation();
		return restoreNavigation({
			views: explorationViews(saved.views),
			activeId: saved.activeId
		});
	} catch {
		return createNavigation();
	}
}

export const navigation = $state(initialNavigation());
/** View ids opened from the current viewer. Cleared when that viewer closes. */
export const viewerCreated = $state({ ids: [] as string[] });

let historyCursor = 0;
let historyEpoch = 0;

if (browser) {
	try {
		const url = location.href;
		historyCursor = rehydrateHistory(history.state, ({ cursor }) => {
			const epoch = historyEpoch;
			// The router finishes starting after this module initializes. A shallow replace
			// before that throws, and it must not push a second entry for the reloaded page.
			setTimeout(() => {
				if (epoch !== historyEpoch || location.href !== url) return;
				void goto(url, { state: { cursor }, shallow: true, replace: true });
			}, 0);
		});
	} catch {
		historyCursor = 0;
	}
	persistWorkspace();
}

function apply(next: NavigationState) {
	navigation.views = next.views;
	navigation.activeId = next.activeId;
	navigation.past = next.past;
	navigation.future = next.future;
	navigation.side = next.side;
	persistWorkspace();
}

/** Write the open views. Closed views and temporary albums already in the session store stay put. */
export function persistWorkspace() {
	if (!browser) return;
	try {
		patchCheckpoint(sessionStorage, checkpointFromViews(navigation.views, navigation.activeId));
	} catch {
		// sessionStorage is unavailable in this browser context.
	}
}

/** Record the active view's gallery scroll for the session checkpoint. */
export function rememberGalleryScroll(scroll: number, anchor: ScrollAnchor | null = null) {
	const id = navigation.activeId;
	navigation.views = navigation.views.map((view) =>
		view.id === id ? { ...view, scroll, scrollAnchor: anchor } : view
	);
	persistWorkspace();
}

export function activeView() {
	return navigation.views.find((view) => view.id === navigation.activeId) ?? navigation.views[0]!;
}

export function startSearch() {
	apply(newView(navigation, ''));
}

export function chooseView(id: string) {
	navigation.activeId = id;
	persistWorkspace();
}

export function removeView(id: string) {
	apply(closeView(navigation, id));
}

export function commitNavigation(next: NavigationState) {
	apply(next);
	historyEpoch += 1;
	historyCursor += 1;
	if (!browser) return;
	const cursor = historyCursor;
	void goto(location.href, { state: { cursor }, shallow: true });
}

export function popNavigation(cursor: number) {
	// Shallow entries keep the cursor in SvelteKit's history metadata. A top-level
	// `event.state.cursor` is only present on entries written before that change.
	const next = browser ? readHistoryCursor(history.state) : cursor;
	if (next === historyCursor) return;
	apply(next < historyCursor ? back(navigation) : forward(navigation));
	historyCursor = next;
}

export function branchTag(tag: string) {
	const fromViewer = activeView().mode === 'viewer';
	const before = navigation.views.map((view) => view.id);
	apply(newView(navigation, tag, { background: true }));
	const created = navigation.views.find((view) => !before.includes(view.id));
	if (fromViewer && created && !viewerCreated.ids.includes(created.id)) {
		viewerCreated.ids = [...viewerCreated.ids, created.id];
	}
	return created?.id ?? null;
}

export function queryFromTag(
	tag: string,
	event: {
		shiftKey: boolean;
		metaKey: boolean;
		ctrlKey: boolean;
		altKey: boolean;
		button?: number;
	},
	anchor?: HTMLElement | null
) {
	if (event.metaKey || event.ctrlKey || event.altKey || event.button === 1) {
		const id = branchTag(tag);
		if (id) showBackgroundNotice(anchor ?? null, id);
		return false;
	}
	commitNavigation(event.shiftKey ? appendTag(navigation, tag) : replaceTag(navigation, tag));
	return true;
}

export function showPost(postId: string) {
	apply(openPost(navigation, postId));
}

export function hideViewer() {
	viewerCreated.ids = [];
	apply(closeViewer(navigation));
}

export function storePosts(posts: ExplorationPost[]) {
	const id = navigation.activeId;
	navigation.views = navigation.views.map((view) => (view.id === id ? { ...view, posts } : view));
	persistWorkspace();
}

export function appendPosts(posts: ExplorationPost[]) {
	const id = navigation.activeId;
	navigation.views = navigation.views.map((view) => {
		if (view.id !== id) return view;
		const seen = view.posts.map((post) => post.id);
		const extra = posts.filter((post) => post.id && !seen.includes(post.id));
		return extra.length ? { ...view, posts: [...view.posts, ...extra] } : view;
	});
	persistWorkspace();
}

const resultPages = new SvelteMap<string, number>();
const filledResults = new SvelteSet<string>();

/** Next 0-based Gelbooru page for this view. Already loaded full pages count even if the cursor was reset. */
export function resultPage(viewId: string, loadedCount: number, pageSize: number) {
	const fromLoaded = pageSize > 0 ? Math.floor(loadedCount / pageSize) : 0;
	return Math.max(resultPages.get(viewId) ?? 0, fromLoaded);
}

export function rememberResultPage(viewId: string, page: number) {
	resultPages.set(viewId, page);
}

export function resultsFilled(viewId: string) {
	return filledResults.has(viewId);
}

export function rememberResultsFilled(viewId: string, filled: boolean) {
	if (filled) filledResults.add(viewId);
	else filledResults.delete(viewId);
}

const resultTags = new SvelteMap<string, string>();

/** Tags for every page of this view, including the sort tag and random seed. */
export function resultTagsFor(viewId: string) {
	return resultTags.get(viewId) ?? '';
}

export function rememberResultTags(viewId: string, tags: string) {
	resultTags.set(viewId, tags);
}
