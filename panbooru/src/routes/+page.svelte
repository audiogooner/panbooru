<script lang="ts">
	import SearchField from '#lib/SearchField.svelte';
	import Viewer from '#lib/Viewer.svelte';
	import { justifyRows } from '#lib/justify.ts';
	import { replaceTag } from '#lib/navigation.ts';
	import {
		activeView,
		commitNavigation,
		hideViewer,
		navigation,
		popNavigation,
		queryFromTag,
		showPost,
		storePosts
	} from '#lib/explore.svelte.ts';

	let galleryWidth = $state(960);
	let suggestions = $state<{ name: string; count: number }[]>([]);

	let rows = $derived(justifyRows(activeView().posts, Math.max(galleryWidth, 320), 190));
	let currentPost = $derived(
		activeView().posts.find((post) => post.id === activeView().postId) ?? null
	);

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

	async function load(query: string) {
		const response = await fetch('/api/source/gelbooru/search', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ query })
		});
		if (!response.ok) return;
		const body = (await response.json()) as {
			data: {
				posts: {
					id: string;
					tags: string[];
					width: number;
					height: number;
					mediaRef: string;
					rating?: string;
				}[];
			};
		};
		storePosts(body.data.posts);
	}

	async function search(draft: string) {
		suggestions = [];
		commitNavigation(replaceTag(navigation, draft));
		await load(draft);
	}

	async function onTag(
		tag: string,
		event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }
	) {
		suggestions = [];
		if (queryFromTag(tag, event)) await load(activeView().query);
	}

	function onPop(event: PopStateEvent) {
		const cursor = typeof event.state?.cursor === 'number' ? event.state.cursor : 0;
		popNavigation(cursor);
		void load(activeView().query);
	}
</script>

<svelte:window onpopstate={onPop} />

{#if activeView().mode === 'viewer' && currentPost}
	<Viewer
		post={currentPost}
		posts={activeView().posts}
		onclose={hideViewer}
		ontag={onTag}
		onmove={showPost}
	/>
{:else}
	<section class="explore">
		{#key `${navigation.activeId}:${activeView().query}`}
			<SearchField initial={activeView().query} {suggestions} oninput={suggest} onsearch={search} />
		{/key}
		<div class="gallery" bind:clientWidth={galleryWidth}>
			{#each rows as row, index (index)}
				<div class="row">
					{#each row as post (post.id)}
						<button type="button" onclick={() => showPost(post.id)}>
							<img
								src={`/api/media/${post.mediaRef}?recipe=thumb`}
								alt={post.tags.join(' ')}
								width={Math.round(post.width)}
								height={Math.round(post.height)}
								style:width="{post.width}px"
								style:height="{post.height}px"
							/>
						</button>
					{/each}
				</div>
			{/each}
		</div>
	</section>
{/if}

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

	button {
		width: auto;
		height: auto;
		padding: 0;
		border: 0;
		background: transparent;
	}

	img {
		max-width: none;
		object-fit: cover;
		border-radius: 13px;
		background: #191e25;
	}
</style>
