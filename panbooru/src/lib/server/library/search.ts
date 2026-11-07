import type { AppDatabase } from '#lib/server/db/index.ts';
import { matchSavedPosts } from '#lib/server/library/query.ts';
import type { FavoritePost } from '#lib/server/library/save.ts';

type Scope = { kind: 'favorites' } | { kind: 'album'; albumId: string };

type Row = { id: string; snapshot: string };

export type LibrarySearch = {
	posts: FavoritePost[];
	explanation?: string;
};

function rows(db: AppDatabase, scope: Scope): Row[] {
	if (scope.kind === 'favorites') {
		return db.$client
			.prepare(
				`select saved_items.id as id, post_snapshots.snapshot as snapshot
				 from favorites
				 join saved_items on saved_items.id = favorites.item_id
				 join post_snapshots on post_snapshots.id = saved_items.snapshot_id
				 order by favorites.favorited_at, saved_items.id`
			)
			.all() as Row[];
	}
	return db.$client
		.prepare(
			`select saved_items.id as id, post_snapshots.snapshot as snapshot
			 from album_items
			 join saved_items on saved_items.id = album_items.item_id
			 join post_snapshots on post_snapshots.id = saved_items.snapshot_id
			 where album_items.album_id = ?
			 order by album_items.added_at, saved_items.id`
		)
		.all(scope.albumId) as Row[];
}

function parsed(row: Row) {
	const snapshot = JSON.parse(row.snapshot) as {
		tags?: unknown;
		width?: unknown;
		height?: unknown;
		rating?: unknown;
	};
	const tags = Array.isArray(snapshot.tags)
		? snapshot.tags.filter((tag): tag is string => typeof tag === 'string')
		: [];
	const rating = typeof snapshot.rating === 'string' && snapshot.rating ? snapshot.rating : null;
	const post: FavoritePost = {
		id: row.id,
		tags: tags.join(' '),
		src: `/api/library/originals/${row.id}`,
		width: Number(snapshot.width ?? 0),
		height: Number(snapshot.height ?? 0)
	};
	return { post, tags, rating };
}

function searchScope(
	db: AppDatabase,
	scope: Scope,
	query: string,
	ratings: readonly string[]
): LibrarySearch {
	const loaded = rows(db, scope).map(parsed);
	const matched = matchSavedPosts(
		loaded.map((item) => ({ item, tags: item.tags, rating: item.rating })),
		query,
		ratings
	);
	return {
		posts: matched.posts.map((item) => item.item.post),
		...(matched.explanation ? { explanation: matched.explanation } : {})
	};
}

export function searchFavorites(
	db: AppDatabase,
	query: string,
	ratings: readonly string[] = []
): LibrarySearch {
	return searchScope(db, { kind: 'favorites' }, query, ratings);
}

export function searchAlbum(
	db: AppDatabase,
	albumId: string,
	query: string,
	ratings: readonly string[] = []
): LibrarySearch {
	return searchScope(db, { kind: 'album', albumId }, query, ratings);
}

export type TagSuggestion = { name: string; count: number };

function suggestionsFor(
	tagLists: readonly (readonly string[])[],
	pattern: string
): TagSuggestion[] {
	const prefix = pattern.trim().toLowerCase();
	if (!prefix) return [];
	const counts = new Map<string, number>();
	for (const tags of tagLists) {
		for (const tag of new Set(tags)) {
			if (tag.toLowerCase().startsWith(prefix)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
	}
	return [...counts.entries()]
		.map(([name, count]) => ({ name, count }))
		.sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

function scopeTags(db: AppDatabase, scope: Scope) {
	return rows(db, scope).map((row) => parsed(row).tags);
}

export function suggestFavorites(db: AppDatabase, pattern: string): TagSuggestion[] {
	return suggestionsFor(scopeTags(db, { kind: 'favorites' }), pattern);
}

export function suggestAlbum(db: AppDatabase, albumId: string, pattern: string): TagSuggestion[] {
	return suggestionsFor(scopeTags(db, { kind: 'album', albumId }), pattern);
}
