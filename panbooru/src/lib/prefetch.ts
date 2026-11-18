import type { ExplorationPost } from '#lib/navigation.ts';
import { isAnimatedMedia } from '#lib/playable.ts';
import { warmTagMeta } from '#lib/tag-meta.ts';
import type { Attachment } from 'svelte/attachments';

const warmed = new Set<string>();

export function withRecipe(base: string, recipe: string) {
	return `${base}${base.includes('?') ? '&' : '?'}recipe=${recipe}`;
}

export function mediaBaseFor(
	post: Pick<ExplorationPost, 'id' | 'mediaRef'>,
	library = false
) {
	if (library) return `/api/library/originals/${encodeURIComponent(post.id)}`;
	if (!post.mediaRef) return '';
	return `/api/media/${post.mediaRef}`;
}

export function warmPost(mediaRef: string, kind?: string, mediaType?: string) {
	warmMedia(`/api/media/${mediaRef}`, kind, mediaType);
}

export function warmMedia(base: string, kind?: string, mediaType?: string) {
	if (!base) return;
	if (kind === 'video') {
		warm(withRecipe(base, base.includes('/api/library/originals/') ? 'thumb' : 'display'));
		warm(base, 'HEAD');
		return;
	}
	if (base.includes('/api/library/originals/')) {
		warm(withRecipe(base, 'thumb'));
		warm(base);
		return;
	}
	// Animated remotes: warm the gallery thumb + original (skip display/backdrop buffering).
	if (isAnimatedMedia(mediaType ?? '')) {
		warm(withRecipe(base, 'thumb'));
		warm(base);
		return;
	}
	warm(withRecipe(base, 'display'));
	warm(withRecipe(base, 'thumb'));
}

export function neighborPrefetch(
	posts: ExplorationPost[],
	id: string,
	direction: number,
	library = false
): Attachment {
	return () => {
		const at = posts.findIndex((item) => item.id === id);
		warmNeighbor(posts[at], library);
		const offsets = direction >= 0 ? [1, -1] : [-1, 1];
		for (const offset of offsets) warmNeighbor(posts[at + offset], library);
	};
}

export function warmExplorationPost(post: ExplorationPost | undefined, library = false) {
	if (!post) return;
	warmTagMeta(post.tags);
	warmMedia(mediaBaseFor(post, library), post.kind, post.mediaType);
}

function warmNeighbor(neighbor: ExplorationPost | undefined, library = false) {
	warmExplorationPost(neighbor, library);
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
