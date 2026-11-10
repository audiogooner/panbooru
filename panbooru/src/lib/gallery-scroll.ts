/** Scroll `#scroll` just enough to bring the post tile into view below the search bar. */
export function scrollGalleryToPost(postId: string, gap = 8): boolean {
	const scroller = document.getElementById('scroll');
	const tile = scroller?.querySelector<HTMLElement>(`[data-post="${CSS.escape(postId)}"]`);
	if (!scroller || !tile) return false;
	const scrollerRect = scroller.getBoundingClientRect();
	// Use layout height so a scrolled-hidden toolbar still reserves space for when it returns.
	const toolbar = document.getElementById('toolbar');
	const topInset = (toolbar?.offsetHeight ?? 0) + gap;
	const tileRect = tile.getBoundingClientRect();
	let delta = 0;
	if (tileRect.top < scrollerRect.top + topInset) {
		delta = tileRect.top - scrollerRect.top - topInset;
	} else if (tileRect.bottom > scrollerRect.bottom - gap) {
		delta = tileRect.bottom - scrollerRect.bottom + gap;
	}
	if (delta !== 0) scroller.scrollTop += delta;
	return true;
}
