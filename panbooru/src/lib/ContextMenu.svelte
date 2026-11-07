<script lang="ts">
	import Icon from '#lib/Icon.svelte';
	import { closeContextMenu, contextMenu } from '#lib/menu.svelte.ts';

	function place(node: HTMLElement) {
		const width = node.offsetWidth;
		const height = node.offsetHeight;
		const padding = 12;
		const gap = 4;
		const left =
			contextMenu.x + gap + width > window.innerWidth - padding
				? contextMenu.x - width - gap
				: contextMenu.x + gap;
		const top =
			contextMenu.y + gap + height > window.innerHeight - padding
				? contextMenu.y - height - gap
				: contextMenu.y + gap;
		node.style.left = `${Math.max(padding, Math.min(left, window.innerWidth - width - padding))}px`;
		node.style.top = `${Math.max(padding, Math.min(top, window.innerHeight - height - padding))}px`;
	}

	function onKey(event: KeyboardEvent) {
		if (!contextMenu.open || event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		closeContextMenu(true);
	}

	function onPointer(event: MouseEvent) {
		if (!contextMenu.open) return;
		const target = event.target;
		if (target instanceof Element && target.closest('.context-menu')) return;
		closeContextMenu(false);
	}

	function choose(id: string) {
		const handler = contextMenu.choose;
		closeContextMenu(false);
		handler?.(id);
	}
</script>

<svelte:window onkeydowncapture={onKey} onpointerdowncapture={onPointer} />

{#if contextMenu.open}
	<div class="popup context-menu" role="menu" {@attach place}>
		{#each contextMenu.items as item (item.id)}
			{@const icon = item.icon}
			{#if item.separator}<hr />{/if}
			<button
				type="button"
				class={['menu-item', item.danger && 'danger']}
				role="menuitem"
				onclick={() => choose(item.id)}
			>
				{#if icon}<Icon name={icon} />{/if}
				{item.label}
			</button>
		{/each}
	</div>
{/if}
