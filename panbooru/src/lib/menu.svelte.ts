import type { IconName } from '#lib/Icon.svelte';

export type MenuItem = {
	id: string;
	label: string;
	icon?: IconName;
	danger?: boolean;
	separator?: boolean;
};

type MenuHandler = (id: string) => void;

export const contextMenu = $state({
	open: false,
	x: 0,
	y: 0,
	items: [] as MenuItem[],
	choose: null as MenuHandler | null,
	opener: null as HTMLElement | null
});

export function openContextMenu(event: MouseEvent, items: MenuItem[], choose: MenuHandler) {
	event.preventDefault();
	event.stopPropagation();
	const opener = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
	contextMenu.items = items;
	contextMenu.choose = choose;
	contextMenu.opener = opener;
	contextMenu.x = event.clientX;
	contextMenu.y = event.clientY;
	contextMenu.open = true;
}

export function closeContextMenu(focus = false) {
	const opener = contextMenu.opener;
	contextMenu.open = false;
	contextMenu.choose = null;
	contextMenu.opener = null;
	if (focus && opener?.isConnected) opener.focus();
}
