/** Bounding box in viewport coordinates for the open/close image morph. */
export type MorphRect = {
	left: number;
	top: number;
	width: number;
	height: number;
};

/** Translate + non-uniform scale applied with transform-origin 0 0 on the stage. */
export type MorphTransform = {
	tx: number;
	ty: number;
	sx: number;
	sy: number;
};

export const MORPH_MS = 420;
export const MORPH_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

export function rectFromElement(node: Element | null | undefined): MorphRect | null {
	if (!(node instanceof HTMLElement)) return null;
	const rect = node.getBoundingClientRect();
	if (rect.width < 1 || rect.height < 1) return null;
	return {
		left: rect.left,
		top: rect.top,
		width: rect.width,
		height: rect.height
	};
}

/** Gallery tiles stamp `data-post`; the viewer media does too, so prefer `.gallery .tile`. */
export function readGalleryTileRect(postId: string): MorphRect | null {
	if (!postId || typeof document === 'undefined') return null;
	return rectFromElement(
		document.querySelector(`.gallery .tile[data-post="${CSS.escape(postId)}"]`)
	);
}

/**
 * Map a stage whose box is at `placed` with natural `size` so it visually matches `origin`.
 * Resting state is `{ tx: 0, ty: 0, sx: scale, sy: scale }` with the usual `scale(zoom)`.
 */
export function morphFromOrigin(
	origin: MorphRect,
	placed: { left: number; top: number },
	size: { width: number; height: number }
): MorphTransform {
	const width = Math.max(size.width, 1);
	const height = Math.max(size.height, 1);
	return {
		tx: origin.left - placed.left,
		ty: origin.top - placed.top,
		sx: origin.width / width,
		sy: origin.height / height
	};
}

export function morphRest(scale: number): MorphTransform {
	return { tx: 0, ty: 0, sx: scale, sy: scale };
}

export function prefersReducedMotion() {
	if (typeof window === 'undefined') return false;
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
