export type SavedPost = {
	id: string;
	favorite: boolean;
	albumIds: string[];
	originalId: string;
};

export type Removal = {
	itemId: string;
	originalId: string;
};

export type MembershipChange = {
	post: SavedPost | null;
	removeOriginal: boolean;
	removed: Removal | null;
};

function removal(post: SavedPost): Removal {
	return { itemId: post.id, originalId: post.originalId };
}

function settle(post: SavedPost): MembershipChange {
	if (!post.favorite && post.albumIds.length === 0) {
		return { post: null, removeOriginal: true, removed: removal(post) };
	}
	return { post, removeOriginal: false, removed: null };
}

export function favorite(post: SavedPost): SavedPost {
	if (post.favorite) return post;
	return { ...post, favorite: true };
}

export function addAlbumMembership(post: SavedPost, albumId: string): SavedPost {
	if (post.albumIds.includes(albumId)) return post;
	return { ...post, albumIds: [...post.albumIds, albumId] };
}

export function unfavorite(post: SavedPost): MembershipChange {
	return settle({ ...post, favorite: false });
}

export function removeAlbumMembership(post: SavedPost, albumId: string): MembershipChange {
	return settle({ ...post, albumIds: post.albumIds.filter((id) => id !== albumId) });
}

export function deleteAlbum(posts: SavedPost[], albumId: string) {
	const kept: SavedPost[] = [];
	const removed: Removal[] = [];
	for (const post of posts) {
		if (!post.albumIds.includes(albumId)) {
			kept.push(post);
			continue;
		}
		const result = removeAlbumMembership(post, albumId);
		if (result.post) kept.push(result.post);
		else if (result.removed) removed.push(result.removed);
	}
	return { posts: kept, removed };
}
