import {
	closeView,
	createNavigation,
	newView,
	replaceTag,
	type ExplorationPost,
	type NavigationState
} from '#lib/navigation.ts';

export const navigation = $state(createNavigation());

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

export function commitQuery(query: string) {
	apply(replaceTag(navigation, query));
}

export function storePosts(posts: ExplorationPost[]) {
	const id = navigation.activeId;
	navigation.views = navigation.views.map((view) => (view.id === id ? { ...view, posts } : view));
}
