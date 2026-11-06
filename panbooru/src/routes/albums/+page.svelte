<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<main class={{ 'empty-page': data.albums.length === 0 }}>
	<h1>Albums</h1>
	{#if data.albums.length === 0}
		<p>No albums yet.</p>
	{:else}
		<ul>
			{#each data.albums as album (album.id)}
				<li><a href={resolve('/albums/[id]', { id: album.id })}>{album.name}</a></li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	ul {
		display: grid;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	a {
		color: inherit;
	}
</style>
