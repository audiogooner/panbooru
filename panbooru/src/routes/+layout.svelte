<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { LayoutProps } from './$types';
	import Sidebar from '#lib/Sidebar.svelte';
	import { activeView, viewerChrome } from '#lib/explore.svelte.ts';
	import './layout.css';

	let { data, children }: LayoutProps = $props();

	async function logout() {
		await fetch('/api/auth/logout', { method: 'POST' });
		window.location.href = '/login';
	}

	function editingText(target: EventTarget | null) {
		return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
	}

	async function restoreRemoval(event: KeyboardEvent) {
		const removalId = data.removalId;
		if (!removalId || event.shiftKey || event.altKey) return;
		if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
		if (editingText(event.target)) return;
		event.preventDefault();
		const response = await fetch(`/api/library/removals/${encodeURIComponent(removalId)}/undo`, {
			method: 'POST'
		});
		if (response.ok) await invalidateAll();
	}
</script>

<svelte:window onkeydown={restoreRemoval} />

{#if data.authenticated}
	<div
		class={{
			app: true,
			viewing: activeView().mode === 'viewer',
			'left-open': viewerChrome.edge
		}}
	>
		<Sidebar onlogout={logout} />
		<div class="content">
			{@render children()}
		</div>
	</div>
{:else}
	{@render children()}
{/if}
