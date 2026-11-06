<script lang="ts">
	import type { LayoutProps } from './$types';
	import Sidebar from '#lib/Sidebar.svelte';
	import { activeView, viewerChrome } from '#lib/explore.svelte.ts';
	import './layout.css';

	let { data, children }: LayoutProps = $props();

	async function logout() {
		await fetch('/api/auth/logout', { method: 'POST' });
		window.location.href = '/login';
	}
</script>

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
