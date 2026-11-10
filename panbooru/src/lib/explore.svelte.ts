import { browser } from '$app/env';
import { afterNavigate, goto } from '$app/navigation';
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
	readHistoryCursor,
	rehydrateHistory
} from '#lib/workspace.ts';
import {
	bootWorkspace,
	onWorkspaceReplaced,
	settleWorkspace,
	workspaceBacking
} from '#lib/workspace-session.svelte.ts';

function initialNavigation(): NavigationState {
	if (!browser) return createNavigation();
	try {
		const saved = bootWorkspace();
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

/** Shallow replace queued until the client router has started. */
let pendingHistoryReplace: { url: string; cursor: number; epoch: number } | null = null;
let historyRehydrateBound = false;

if (browser) {
	try {
		historyCursor = rehydrateHistory(history.state, ({ cursor }) => {
			// Module init runs before SvelteKit sets `started`. Calling goto here throws
			// `navigation_before_start`; bindHistoryRehydrate flushes after the router is ready.
			pendingHistoryReplace = { url: location.href, cursor, epoch: historyEpoch };
		});
	} catch {
		historyCursor = 0;
	}
	onWorkspaceReplaced((checkpoint) => {
		const next = checkpoint?.views.length
			? restoreNavigation({
					views: explorationViews(checkpoint.views),
					activeId: checkpoint.activeId
				})
			: createNavigation();
		apply(next);
	});
	persistWorkspace();
	void settleWorkspace();
}

function flushPendingHistoryReplace() {
	const pending = pendingHistoryReplace;
	pendingHistoryReplace = null;
	if (!pending || !browser) return;
	if (pending.epoch !== historyEpoch || location.href !== pending.url) return;
	void goto(pending.url, {
		state: { cursor: pending.cursor },
		shallow: true,
		replace: true
	});
}

/**
 * Register once from a root layout/page during component init.
 * Flushes any deferred history cursor replace after the client router is ready.
 */
export function bindHistoryRehydrate() {
	if (!browser || historyRehydrateBound) return;
	historyRehydrateBound = true;
	afterNavigate(() => {
		// `afterNavigate` for the initial `enter` runs just before Kit flips `started`.
		// One microtask later, goto is safe and still does not push a second entry.
		void Promise.resolve().then(flushPendingHistoryReplace);
	});
}

function apply(next: NavigationState) {
	navigation.views = next.views;
	navigation.activeId = next.activeId;
	navigation.past = next.past;
	navigation.future = next.future;
	navigation.side = next.side;
	persistWorkspace();
}

/** Write the open views. Closed views and temporary albums already in this workspace stay put. */
export function persistWorkspace() {
	if (!browser) return;
	try {
		patchCheckpoint(workspaceBacking(), checkpointFromViews(navigation.views, navigation.activeId));
	} catch {
		// Workspace storage is unavailable in this browser context.
	}
}

/** Record the active view's gallery scroll for this tab's workspace. */
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

/** Keep a probed or known file size on the post so details reuse it like score. */
export function rememberPostFileSize(postId: string, fileSize: number) {
	if (!Number.isFinite(fileSize) || fileSize < 0) return;
	let changed = false;
	navigation.views = navigation.views.map((view) => {
		const index = view.posts.findIndex((post) => post.id === postId);
		if (index < 0) return view;
		const post = view.posts[index]!;
		if (post.fileSize === fileSize) return view;
		changed = true;
		const posts = [...view.posts];
		posts[index] = { ...post, fileSize };
		return { ...view, posts };
	});
	if (changed) persistWorkspace();
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
