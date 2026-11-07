export const backgroundNotice = $state({
	open: false,
	viewId: '',
	anchorLeft: 40,
	anchorTop: 40,
	anchorHeight: 28
});

let timer = 0;

export function showBackgroundNotice(anchor: HTMLElement | null, viewId: string) {
	const rect = anchor?.getBoundingClientRect();
	backgroundNotice.viewId = viewId;
	backgroundNotice.anchorLeft = rect?.left ?? 40;
	backgroundNotice.anchorTop = rect?.top ?? 40;
	backgroundNotice.anchorHeight = rect?.height ?? 28;
	backgroundNotice.open = true;
	window.clearTimeout(timer);
	timer = window.setTimeout(() => {
		if (backgroundNotice.viewId === viewId) backgroundNotice.open = false;
	}, 4500);
}

export function dismissBackgroundNotice() {
	backgroundNotice.open = false;
	window.clearTimeout(timer);
}
