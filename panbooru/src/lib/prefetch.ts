import type { ExplorationPost } from '#lib/navigation.ts';
import { warmTagMeta } from '#lib/tag-meta.ts';
import type { Attachment } from 'svelte/attachments';

const warmed = new Set<string>();

export function withRecipe(base: string, recipe: string) {
	return `${base}${base.includes('?') ? '&' : '?'}recipe=${recipe}`;
}

export function warmPost(mediaRef: string, kind?: string) {
	if (!mediaRef) return;
	const base = `/api/media/${mediaRef}`;
	if (kind === 'video') {
		warm(withRecipe(base, 'display'));
		warm(base, 'HEAD');
		return;
	}
	warm(withRecipe(base, 'display'));
	warm(withRecipe(base, 'backdrop'));
}

export function neighborPrefetch(
	posts: ExplorationPost[],
	id: string,
	direction: number
): Attachment {
	return () => {
		const at = posts.findIndex((item) => item.id === id);
		warmNeighbor(posts[at]);
		const offsets = direction >= 0 ? [1, -1] : [-1, 1];
		for (const offset of offsets) warmNeighbor(posts[at + offset]);
	};
}

export function warmExplorationPost(post: ExplorationPost | undefined) {
	if (!post) return;
	warmTagMeta(post.tags);
	warmPost(post.mediaRef, post.kind);
}

function warmNeighbor(neighbor: ExplorationPost | undefined) {
	warmExplorationPost(neighbor);
}

function warm(url: string, method: 'GET' | 'HEAD' = 'GET') {
	const key = `${method} ${url}`;
	if (warmed.has(key)) return;
	warmed.add(key);
	if (method === 'HEAD') {
		void fetch(url, { method: 'HEAD' });
		return;
	}
	const image = new Image();
	image.decoding = 'async';
	image.src = url;
}
