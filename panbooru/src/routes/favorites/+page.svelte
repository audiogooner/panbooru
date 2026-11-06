<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	async function removeFavorite(id: string) {
		await fetch(`/api/library/favorites/${id}`, { method: 'DELETE' });
		await invalidateAll();
	}
</script>

<main class={{ 'empty-page': data.favorites.length === 0 }}>
	<h1>Favorites</h1>
	{#if data.favorites.length === 0}
		<p>No favorites yet.</p>
	{:else}
		<ul class="saved">
			{#each data.favorites as item (item.id)}
				<li>
					<img src={item.src} alt={item.tags} width={item.width} height={item.height} />
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
</style>
