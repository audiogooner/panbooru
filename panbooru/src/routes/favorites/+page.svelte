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
			`/api/library/favorites/suggestions?pattern=${encodeURIComponent(pattern)}`
		);
		if (!response.ok) return;
		const body = (await response.json()) as {
			data: { suggestions: { name: string; count: number }[] };
		};
		suggestions = body.data.suggestions;
	}

	async function search(draft: string) {
		suggestions = [];
		await goto(resolve(`favorites?${new URLSearchParams({ q: draft })}`));
	}

	async function removeFavorite(id: string) {
		await fetch(`/api/library/favorites/${id}`, { method: 'DELETE' });
		await invalidateAll();
	}
</script>

<main class={{ 'empty-page': data.favorites.length === 0 }}>
	<h1>Favorites</h1>
	{#key data.query}
		<SearchField initial={data.query} {suggestions} oninput={suggest} onsearch={search} />
	{/key}
	{#if data.explanation}
		<p>{data.explanation}</p>
	{:else if !data.searched && data.favorites.length === 0}
		<p>No favorites yet.</p>
	{:else if data.favorites.length === 0}
		<p>No results</p>
	{:else}
		<ul class="saved">
			{#each data.favorites as item (item.id)}
				<li>
					{#if item.availability === 'unavailable'}
						<p>Unavailable</p>
					{:else if item.availability === 'ready'}
						<img src={item.src} alt={item.tags} width={item.width} height={item.height} />
					{/if}
					<ul aria-label="Classifications">
						{#each item.tagList as tag (tag.name)}
							<li data-category={tag.category}>{tag.name}</li>
						{/each}
					</ul>
					<button type="button" onclick={() => removeFavorite(item.id)}>Remove favorite</button>
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

	ul ul {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	[data-category='artist'] {
		color: #e07a9a;
	}

	[data-category='character'] {
		color: #7ec8a3;
	}

	[data-category='copyright'] {
		color: #7ea3e0;
	}

	[data-category='metadata'] {
		color: #d4b36a;
	}
</style>
