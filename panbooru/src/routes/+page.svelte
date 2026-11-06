<script lang="ts">
	import SearchField from '#lib/SearchField.svelte';
	import { justifyRows } from '#lib/justify.ts';
	import { activeView, commitQuery, navigation, storePosts } from '#lib/explore.svelte.ts';

	let galleryWidth = $state(960);
	let suggestions = $state<{ name: string; count: number }[]>([]);

	let rows = $derived(justifyRows(activeView().posts, Math.max(galleryWidth, 320), 190));

	async function suggest(value: string) {
		const pattern = value.split(/\s+/).at(-1) ?? '';
		if (pattern.length < 2) {
			suggestions = [];
			return;
		}
		const response = await fetch('/api/source/gelbooru/autocomplete', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ pattern })
		});
		if (!response.ok) return;
		const body = (await response.json()) as {
			data: { suggestions: { name: string; count: number }[] };
		};
		suggestions = body.data.suggestions;
	}

	async function search(draft: string) {
		commitQuery(draft);
		suggestions = [];
		const response = await fetch('/api/source/gelbooru/search', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ query: draft })
		});
		if (!response.ok) return;
		const body = (await response.json()) as {
			data: {
				posts: { id: string; tags: string[]; width: number; height: number; mediaRef: string }[];
			};
		};
		storePosts(body.data.posts);
	}
</script>

<section class="explore">
	{#key navigation.activeId}
		<SearchField initial={activeView().query} {suggestions} oninput={suggest} onsearch={search} />
	{/key}
	<div class="gallery" bind:clientWidth={galleryWidth}>
		{#each rows as row, index (index)}
			<div class="row">
				{#each row as post (post.id)}
					<img
						src={`/api/media/${post.mediaRef}`}
						alt={post.tags.join(' ')}
						width={Math.round(post.width)}
						height={Math.round(post.height)}
						style:width="{post.width}px"
						style:height="{post.height}px"
					/>
				{/each}
			</div>
		{/each}
	</div>
</section>

<style>
	.explore {
		min-height: 100%;
		padding: 16px 26px 24px;
	}

	.gallery {
		display: grid;
		gap: 4px;
	}

	.row {
		display: flex;
		gap: 4px;
	}

	img {
		max-width: none;
		object-fit: cover;
		border-radius: 13px;
		background: #191e25;
	}
</style>
