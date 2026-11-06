<script lang="ts">
	import type { LayoutProps } from './$types';
	import './layout.css';

	let { data, children }: LayoutProps = $props();

	async function logout() {
		await fetch('/api/auth/logout', { method: 'POST' });
		window.location.href = '/login';
	}
</script>

<header>
	<a href="/">Panbooru</a>
	{#if data.authenticated}
		<button type="button" onclick={logout}>Log out</button>
	{/if}
</header>
{@render children()}
