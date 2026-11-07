export type ViewMode = 'gallery' | 'viewer';

export type ExplorationPost = {
	id: string;
	width: number;
	height: number;
	tags: string[];
	mediaRef: string;
	rating?: string;
	kind?: 'image' | 'video';
	mediaType?: string;
};

export type AppliedView = {
	query: string;
	rating: string[];
	media: string[];
	sort: string;
};

/** Item id plus offset inside that item. Pixel `scroll` is only a fallback. */
export type ScrollAnchor = {
	id: string;
	offset: number;
};

export type ExplorationView = {
	id: string;
	query: string;
	posts: ExplorationPost[];
	postId: string | null;
	mode: ViewMode;
	scroll: number;
	scrollAnchor: ScrollAnchor | null;
	/** Filters from an opened saved search. Not a server view row. */
	applied?: AppliedView;
};

export type NavigationState = {
	views: ExplorationView[];
	activeId: string;
	past: { id: string; query: string }[];
	future: { id: string; query: string }[];
	side: number;
};

function view(query = ''): ExplorationView {
	return {
		id: crypto.randomUUID(),
		query,
		posts: [],
		postId: null,
		mode: 'gallery',
		scroll: 0,
		scrollAnchor: null
	};
}

function active(state: NavigationState) {
	return state.views.find((item) => item.id === state.activeId) ?? state.views[0]!;
}

function remember(state: NavigationState): NavigationState {
	const current = active(state);
	return { ...state, past: [...state.past, { id: current.id, query: current.query }], future: [] };
}

function setQuery(state: NavigationState, query: string): NavigationState {
	return {
		...state,
		views: state.views.map((item) =>
			item.id === state.activeId
				? { ...item, query, mode: 'gallery', postId: null, scroll: 0, scrollAnchor: null }
				: item
		)
	};
}

export function createNavigation(): NavigationState {
	const first = view();
	return { views: [first], activeId: first.id, past: [], future: [], side: 246 };
}

export function newView(
	state: NavigationState,
	query: string,
	options: { background?: boolean } = {}
): NavigationState {
	const created = view(query);
	if (options.background) {
		const index = state.views.findIndex((item) => item.id === state.activeId);
		const at = index < 0 ? 0 : index + 1;
		const views = [...state.views.slice(0, at), created, ...state.views.slice(at)];
		return { ...state, views };
	}
	const views = [created, ...state.views];
	return { ...remember(state), views, activeId: created.id };
}

export function closeView(state: NavigationState, id: string): NavigationState {
	const views = state.views.filter((item) => item.id !== id);
	if (!views.length) {
		const empty = view();
		return { ...state, views: [empty], activeId: empty.id };
	}
	const activeId = state.activeId === id ? views[0]!.id : state.activeId;
	return { ...state, views, activeId };
}

export function replaceTag(state: NavigationState, tag: string): NavigationState {
	return setQuery(remember(state), tag);
}

export function appendTag(state: NavigationState, tag: string): NavigationState {
	const query = `${active(state).query} ${tag}`.trim();
	return replaceTag(state, query);
}

export function back(state: NavigationState): NavigationState {
	const previous = state.past.at(-1);
	if (!previous) return state;
	const current = active(state);
	return setQuery(
		{
			...state,
			past: state.past.slice(0, -1),
			future: [{ id: current.id, query: current.query }, ...state.future]
		},
		previous.query
	);
}

export function forward(state: NavigationState): NavigationState {
	const next = state.future[0];
	if (!next) return state;
	const current = active(state);
	return setQuery(
		{
			...state,
			future: state.future.slice(1),
			past: [...state.past, { id: current.id, query: current.query }]
		},
		next.query
	);
}

export function openPost(state: NavigationState, postId: string): NavigationState {
	return {
		...state,
		views: state.views.map((item) =>
			item.id === state.activeId ? { ...item, mode: 'viewer', postId } : item
		)
	};
}

/** Current workspace only. History stacks stay empty: a reload entry has no result snapshots. */
export function restoreNavigation(saved: {
	views: ExplorationView[];
	activeId: string;
}): NavigationState {
	const views = saved.views.map((item) => ({
		...item,
		posts: item.posts.map((post) => ({ ...post })),
		scrollAnchor: item.scrollAnchor ? { ...item.scrollAnchor } : null,
		...(item.applied
			? {
					applied: {
						...item.applied,
						rating: [...item.applied.rating],
						media: [...item.applied.media]
					}
				}
			: {})
	}));
	if (!views.length) return createNavigation();
	const activeId = views.some((item) => item.id === saved.activeId) ? saved.activeId : views[0]!.id;
	return { views, activeId, past: [], future: [], side: 246 };
}

export function closeViewer(state: NavigationState): NavigationState {
	return {
		...state,
		views: state.views.map((item) =>
			item.id === state.activeId ? { ...item, mode: 'gallery' } : item
		)
	};
}
