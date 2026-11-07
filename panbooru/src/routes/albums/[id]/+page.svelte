<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import SearchField from '#lib/SearchField.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let suggestions = $state<{ name: string; count: number }[]>([]);

	async function suggest(value: string) {
		const pattern = value.split(/\s+/).at(-1)?.replace(/^-/, '') ?? '';
		if (pattern.length < 2) {
			suggestions = [];
			return;
		}
		const response = await fetch(
			`/api/library/albums/${encodeURIComponent(data.album.id)}/suggestions?pattern=${encodeURIComponent(pattern)}`
		);
		if (!response.ok) return;
		const body = (await response.json()) as {
			data: { suggestions: { name: string; count: number }[] };
		};
		suggestions = body.data.suggestions;
	}

	async function search(draft: string) {
		suggestions = [];
		await goto(resolve(`albums/${data.album.id}?${new URLSearchParams({ q: draft })}`));
	}

	async function removeFromAlbum(itemId: string) {
		await fetch(`/api/library/albums/${data.album.id}/items/${itemId}`, { method: 'DELETE' });
		await invalidateAll();
	}
</script>

<main>
	<h1>{data.album.name}</h1>
	{#key data.query}
		<SearchField initial={data.query} {suggestions} oninput={suggest} onsearch={search} />
	{/key}
	{#if data.explanation}
		<p>{data.explanation}</p>
	{:else if !data.searched && data.posts.length === 0}
		<p>No posts in this album.</p>
	{:else if data.posts.length === 0}
		<p>No results</p>
	{:else}
		<ul class="saved">
			{#each data.posts as item (item.id)}
				<li>
					<img src={item.src} alt={item.tags} width={item.width} height={item.height} />
					<button type="button" onclick={() => removeFromAlbum(item.id)}>Remove from album</button>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	.saved {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: grid;
		gap: 8px;
		justify-items: start;
	}

	img {
		display: block;
		border-radius: 13px;
		background: #191e25;
	}
</style>
