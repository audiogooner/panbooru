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
 * Transform (origin 0 0) that maps a box laid out at `to` so it visually matches `from`.
 * Animate that transform to identity for a FLIP shared-element morph.
 */
export function flipTransform(from: MorphRect, to: MorphRect): MorphTransform {
	return {
		tx: from.left - to.left,
		ty: from.top - to.top,
		sx: from.width / Math.max(to.width, 1),
		sy: from.height / Math.max(to.height, 1)
	};
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

/**
 * Approximate server `backdrop-v1`: fit inside 48×48, blur(6). Avoid black letterboxing — canvas
 * blur samples empty pixels as black and made the open stand-in darker than recipe=backdrop.
 */
export function backdropFromImage(image: CanvasImageSource, width: number, height: number) {
	if (typeof document === 'undefined') return null;
	const w = Math.max(1, Math.round(width));
	const h = Math.max(1, Math.round(height));
	if (w < 1 || h < 1) return null;
	const maxEdge = 48;
	const scale = Math.min(1, maxEdge / w, maxEdge / h);
	const dw = Math.max(1, Math.round(w * scale));
	const dh = Math.max(1, Math.round(h * scale));
	const resized = document.createElement('canvas');
	resized.width = dw;
	resized.height = dh;
	const rctx = resized.getContext('2d');
	if (!rctx) return null;
	rctx.drawImage(image, 0, 0, dw, dh);
	// Extend edges before blur so transparent/black void does not crush luminance.
	const pad = 12;
	const room = document.createElement('canvas');
	room.width = dw + pad * 2;
	room.height = dh + pad * 2;
	const roomCtx = room.getContext('2d');
	if (!roomCtx) return null;
	roomCtx.drawImage(resized, -pad, -pad, dw + pad * 2, dh + pad * 2);
	const canvas = document.createElement('canvas');
	canvas.width = dw;
	canvas.height = dh;
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;
	ctx.filter = 'blur(6px)';
	ctx.drawImage(room, -pad, -pad);
	try {
		return canvas.toDataURL('image/jpeg', 0.55);
	} catch {
		return null;
	}
}

/** Prefer the decoded gallery tile bitmap so open morph has a backdrop on the first frame. */
export function backdropFromGalleryThumb(postId: string) {
	if (!postId || typeof document === 'undefined') return null;
	const tile = document.querySelector(
		`.gallery .tile[data-post="${CSS.escape(postId)}"]`
	);
	if (!(tile instanceof HTMLElement)) return null;
	const imgs = tile.querySelectorAll('img');
	for (const img of imgs) {
		if (!(img instanceof HTMLImageElement)) continue;
		if (img.naturalWidth < 1 || img.naturalHeight < 1) continue;
		const painted = backdropFromImage(img, img.naturalWidth, img.naturalHeight);
		if (painted) return painted;
	}
	return null;
}
