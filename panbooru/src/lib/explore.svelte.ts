import { browser } from '$app/env';
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
