import { browser } from '$app/env';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { goto } from '$app/navigation';
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
	type ExplorationPost,
	type NavigationState
} from '#lib/navigation.ts';
import { readHistoryCursor, rehydrateHistory } from '#lib/workspace.ts';

export const navigation = $state(createNavigation());
export const viewerChrome = $state({ edge: false });

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
}

function apply(next: NavigationState) {
	navigation.views = next.views;
	navigation.activeId = next.activeId;
	navigation.past = next.past;
	navigation.future = next.future;
	navigation.side = next.side;
}

export function activeView() {
	return navigation.views.find((view) => view.id === navigation.activeId) ?? navigation.views[0]!;
}

export function startSearch() {
	apply(newView(navigation, ''));
}

export function chooseView(id: string) {
	navigation.activeId = id;
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
	apply(newView(navigation, tag, { background: true }));
}

export function queryFromTag(tag: string, event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }) {
	if (event.metaKey || event.ctrlKey || event.altKey) {
		branchTag(tag);
		return false;
	}
	commitNavigation(event.shiftKey ? appendTag(navigation, tag) : replaceTag(navigation, tag));
	return true;
}

export function showPost(postId: string) {
	viewerChrome.edge = false;
	apply(openPost(navigation, postId));
}

export function hideViewer() {
	viewerChrome.edge = false;
	apply(closeViewer(navigation));
}

export function storePosts(posts: ExplorationPost[]) {
	const id = navigation.activeId;
	navigation.views = navigation.views.map((view) => (view.id === id ? { ...view, posts } : view));
}

export function appendPosts(posts: ExplorationPost[]) {
	const id = navigation.activeId;
	navigation.views = navigation.views.map((view) => {
		if (view.id !== id) return view;
		const seen = view.posts.map((post) => post.id);
		const extra = posts.filter((post) => post.id && !seen.includes(post.id));
		return extra.length ? { ...view, posts: [...view.posts, ...extra] } : view;
	});
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
