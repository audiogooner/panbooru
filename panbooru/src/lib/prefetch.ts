import type { ExplorationPost } from '#lib/navigation.ts';
import type { Attachment } from 'svelte/attachments';

const warmed = new Set<string>();

export function neighborPrefetch(
	posts: ExplorationPost[],
	id: string,
	direction: number
): Attachment {
	return () => {
		const at = posts.findIndex((item) => item.id === id);
		const offsets = direction >= 0 ? [1, -1] : [-1, 1];
		for (const offset of offsets) warmNeighbor(posts[at + offset]);
	};
}

function warmNeighbor(neighbor: ExplorationPost | undefined) {
	if (!neighbor?.mediaRef) return;
	const base = `/api/media/${neighbor.mediaRef}`;
	if (neighbor.kind === 'video') {
		warm(`${base}?recipe=display`);
		warm(base, 'HEAD');
		return;
	}
	warm(`${base}?recipe=display`);
	warm(`${base}?recipe=backdrop`);
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
