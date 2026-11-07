<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Icon from '#lib/Icon.svelte';
	import { chooseView } from '#lib/explore.svelte.ts';
	import { backgroundNotice, dismissBackgroundNotice } from '#lib/notice.svelte.ts';

	function place(node: HTMLElement) {
		const width = node.offsetWidth;
		const height = node.offsetHeight;
		const left = Math.max(12, backgroundNotice.anchorLeft - width - 14);
		const top = Math.max(
			12,
			Math.min(
				window.innerHeight - height - 12,
				backgroundNotice.anchorTop + (backgroundNotice.anchorHeight - height) / 2
			)
		);
		node.style.left = `${left}px`;
		node.style.top = `${top}px`;
	}

	async function openView() {
		const id = backgroundNotice.viewId;
		dismissBackgroundNotice();
		if (!id) return;
		chooseView(id);
		if (page.url.pathname !== '/') await goto(resolve('/'));
	}
</script>

{#if backgroundNotice.open}
	<div class="background-notice" role="status" {@attach place}>
		<Icon name="check" />
		<strong>Opened in background</strong>
		<button class="toast-open" type="button" onclick={openView}>Open</button>
	</div>
{/if}

<style>
	.background-notice {
		position: fixed;
		z-index: 90;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 10px;
		border: 1px solid #78bf9380;
		border-radius: 10px;
		background: #15241ccc;
		color: #b7f0cd;
		font-weight: 600;
		pointer-events: auto;
		backdrop-filter: blur(16px);
		--icon-size: 16px;
	}

	.toast-open {
		margin-left: 5px;
		padding: 4px 9px;
		border: 1px solid #78bf9380;
		border-radius: 6px;
		background: #79c49622;
		color: #b7f0cd;
		font-size: 12px;
		font-weight: 600;
	}

	.toast-open:hover {
		background: #79c49640;
	}

	@media (prefers-reduced-motion: no-preference) {
		.background-notice {
			animation: notice-out 180ms ease;
		}
	}

	@keyframes notice-out {
		from {
			transform: translateX(8px);
			opacity: 0;
		}

		to {
			transform: none;
			opacity: 1;
		}
	}
</style>
