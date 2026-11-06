<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	async function removeFromAlbum(itemId: string) {
		await fetch(`/api/library/albums/${data.album.id}/items/${itemId}`, { method: 'DELETE' });
		await invalidateAll();
	}
</script>

<main>
	<h1>{data.album.name}</h1>
	{#if data.posts.length === 0}
		<p>No posts in this album.</p>
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
