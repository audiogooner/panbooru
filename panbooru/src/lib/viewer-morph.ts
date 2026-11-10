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

/** Matches `backdrop-v1` in `derivative.ts` (before viewer CSS filters). */
export const BACKDROP_RECIPE_EDGE = 48;
export const BACKDROP_RECIPE_BLUR = 6;
/** WebP quality for `backdrop-v1`; stand-in uses the same when the browser supports it. */
export const BACKDROP_RECIPE_QUALITY = 0.4;

function backdropDataUrl(canvas: HTMLCanvasElement) {
	try {
		const webp = canvas.toDataURL('image/webp', BACKDROP_RECIPE_QUALITY);
		if (webp.startsWith('data:image/webp')) return webp;
	} catch {
		/* webp encode unavailable */
	}
	try {
		return canvas.toDataURL('image/jpeg', 0.42);
	} catch {
		return null;
	}
}

/**
 * Approximate server `backdrop-v1`: fit inside 48×48, blur(6). Canvas blur samples empty pixels
 * as black; pad with untinted edge extend (not stretch) so the stand-in matches recipe=backdrop.
 */
export function backdropFromImage(image: CanvasImageSource, width: number, height: number) {
	if (typeof document === 'undefined') return null;
	const w = Math.max(1, Math.round(width));
	const h = Math.max(1, Math.round(height));
	if (w < 1 || h < 1) return null;
	const scale = Math.min(1, BACKDROP_RECIPE_EDGE / w, BACKDROP_RECIPE_EDGE / h);
	const dw = Math.max(1, Math.round(w * scale));
	const dh = Math.max(1, Math.round(h * scale));
	const resized = document.createElement('canvas');
	resized.width = dw;
	resized.height = dh;
	const rctx = resized.getContext('2d');
	if (!rctx) return null;
	rctx.imageSmoothingEnabled = true;
	rctx.imageSmoothingQuality = 'high';
	rctx.drawImage(image, 0, 0, dw, dh);
	const pad = BACKDROP_RECIPE_BLUR * 2;
	const room = document.createElement('canvas');
	room.width = dw + pad * 2;
	room.height = dh + pad * 2;
	const roomCtx = room.getContext('2d');
	if (!roomCtx) return null;
	roomCtx.drawImage(resized, pad, pad);
	// 1px edge + corner replicate (sharp/libvips-style) so blur never samples void.
	roomCtx.drawImage(resized, 0, 0, 1, dh, 0, pad, pad, dh);
	roomCtx.drawImage(resized, dw - 1, 0, 1, dh, pad + dw, pad, pad, dh);
	roomCtx.drawImage(resized, 0, 0, dw, 1, pad, 0, dw, pad);
	roomCtx.drawImage(resized, 0, dh - 1, dw, 1, pad, pad + dh, dw, pad);
	roomCtx.drawImage(resized, 0, 0, 1, 1, 0, 0, pad, pad);
	roomCtx.drawImage(resized, dw - 1, 0, 1, 1, pad + dw, 0, pad, pad);
	roomCtx.drawImage(resized, 0, dh - 1, 1, 1, 0, pad + dh, pad, pad);
	roomCtx.drawImage(resized, dw - 1, dh - 1, 1, 1, pad + dw, pad + dh, pad, pad);
	const canvas = document.createElement('canvas');
	canvas.width = dw;
	canvas.height = dh;
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;
	ctx.filter = `blur(${BACKDROP_RECIPE_BLUR}px)`;
	ctx.drawImage(room, -pad, -pad);
	return backdropDataUrl(canvas);
}

/** True when `url` is already decoded in the HTTP/memory cache (sync after setting Image.src). */
export function backdropUrlWarm(url: string) {
	if (!url || typeof Image === 'undefined') return false;
	const probe = new Image();
	probe.src = url;
	return probe.complete && probe.naturalWidth > 0;
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
