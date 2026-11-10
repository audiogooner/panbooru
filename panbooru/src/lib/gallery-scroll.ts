/** Scroll `#scroll` just enough to bring the post tile into view. */
export function scrollGalleryToPost(postId: string, pad = 8): boolean {
	const scroller = document.getElementById('scroll');
	const tile = scroller?.querySelector<HTMLElement>(`[data-post="${CSS.escape(postId)}"]`);
	if (!scroller || !tile) return false;
	const scrollerRect = scroller.getBoundingClientRect();
	const tileRect = tile.getBoundingClientRect();
	let delta = 0;
	if (tileRect.top < scrollerRect.top + pad) {
		delta = tileRect.top - scrollerRect.top - pad;
	} else if (tileRect.bottom > scrollerRect.bottom - pad) {
		delta = tileRect.bottom - scrollerRect.bottom + pad;
	}
	if (delta !== 0) scroller.scrollTop += delta;
	return true;
}
