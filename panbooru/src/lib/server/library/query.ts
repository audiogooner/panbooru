import { ratingOrder } from '#lib/server/library/rating-tags.ts';

export type SavedMatch = {
	tags: readonly string[];
	rating?: string | null;
};

export type MatchResult<T> = {
	posts: T[];
	explanation?: string;
};

const unsupportedExplanation = 'Local search does not support grouping, or, score:, or id:.';

function unsupported(query: string) {
	if (/[(){}]/.test(query)) return true;
	return query
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.some((token) => {
			const name = (token.startsWith('-') ? token.slice(1) : token).toLowerCase();
			return name === 'or' || name.startsWith('score:') || name.startsWith('id:');
		});
}

function ratingsOpen(selected: readonly string[]) {
	const chosen = ratingOrder.filter((rating) => selected.includes(rating));
	return chosen.length === 0 || chosen.length === ratingOrder.length;
}

export function matchSavedPosts<T extends SavedMatch>(
	posts: readonly T[],
	query: string,
	ratings: readonly string[]
): MatchResult<T> {
	if (unsupported(query)) return { posts: [], explanation: unsupportedExplanation };
	const tokens = query.trim().split(/\s+/).filter(Boolean);
	const open = ratingsOpen(ratings);
	const chosen = new Set<string>(ratingOrder.filter((rating) => ratings.includes(rating)));
	const matched = posts.filter((post) => {
		if (!open && !chosen.has(post.rating ?? '')) return false;
		return tokens.every((token) => {
			const excluded = token.startsWith('-');
			const name = excluded ? token.slice(1) : token;
			if (!name) return true;
			const present = post.tags.includes(name);
			return excluded ? !present : present;
		});
	});
	return { posts: [...matched] };
}
