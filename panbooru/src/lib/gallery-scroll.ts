/** Scroll `#scroll` so the row containing the post sits in the vertical center below the search bar. */
export function scrollGalleryToPost(postId: string): boolean {
	const scroller = document.getElementById('scroll');
	const tile = scroller?.querySelector<HTMLElement>(`[data-post="${CSS.escape(postId)}"]`);
	if (!scroller || !tile) return false;
	const row = tile.closest('.row');
	if (!(row instanceof HTMLElement)) return false;
	const scrollerRect = scroller.getBoundingClientRect();
	// Layout height so a scrolled-hidden toolbar still reserves space for when it returns.
	const toolbar = document.getElementById('toolbar');
	const topInset = toolbar?.offsetHeight ?? 0;
	const viewTop = scrollerRect.top + topInset;
	const viewCenter = (viewTop + scrollerRect.bottom) / 2;
	const rowRect = row.getBoundingClientRect();
	const rowCenter = (rowRect.top + rowRect.bottom) / 2;
	const delta = rowCenter - viewCenter;
	if (Math.abs(delta) >= 0.5) scroller.scrollTop += delta;
	return true;
}
