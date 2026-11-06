<script lang="ts">
	import { viewerChrome } from '#lib/explore.svelte.ts';
	import type { ExplorationPost } from '#lib/navigation.ts';

	let {
		post,
		onclose,
		ontag
	}: {
		post: ExplorationPost;
		onclose: () => void;
		ontag: (tag: string, event: MouseEvent) => void;
	} = $props();
	let tagsOpen = $state(false);

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onclose();
	}
</script>

<svelte:window {onkeydown} />

<div class="viewer">
	<img class="backdrop" src={`/api/media/${post.mediaRef}`} alt="" />
	<img class="full" src={`/api/media/${post.mediaRef}`} alt={post.tags.join(' ')} />
	<button class="back" type="button" onclick={onclose}>Back</button>
	<button class="tags" type="button" onclick={() => (tagsOpen = !tagsOpen)}>Show tags</button>
	{#if tagsOpen}
		<ul aria-label="Post tags">
			{#each post.tags as tag (tag)}
				<li><button type="button" onclick={(event) => ontag(tag, event)}>{tag}</button></li>
			{/each}
		</ul>
	{/if}
	<div class="resize" role="separator" aria-orientation="vertical" aria-label="Resize details"></div>
	<div
		class="edge-left"
		role="region"
		aria-label="Sidebar edge"
		onpointerenter={() => (viewerChrome.edge = true)}
	></div>
</div>

<style>
	.viewer {
		position: fixed;
		inset: 0;
		z-index: 20;
		background: #000;
		overflow: hidden;
	}

	.backdrop {
		position: absolute;
		inset: -55px;
		width: calc(100% + 110px);
		height: calc(100% + 110px);
		max-width: none;
		object-fit: cover;
		filter: blur(46px) brightness(0.23);
		pointer-events: none;
	}

	.full {
		position: relative;
		z-index: 1;
		display: block;
		max-width: min(100%, 1200px);
		max-height: 100vh;
		margin: auto;
		object-fit: contain;
	}

	.back,
	.tags {
		position: absolute;
		z-index: 8;
		top: 18px;
	}

	.back {
		left: 20px;
	}

	.tags {
		right: 18px;
	}

	ul {
		position: absolute;
		z-index: 8;
		top: 70px;
		right: 18px;
		width: 240px;
		margin: 0;
		padding: 12px;
		list-style: none;
		background: #14171bf2;
		border: 1px solid #ffffff12;
		border-radius: 14px;
	}

	.resize {
		position: absolute;
		z-index: 8;
		top: 82px;
		right: 292px;
		bottom: 18px;
		width: 8px;
		cursor: ew-resize;
	}

	.edge-left {
		position: absolute;
		z-index: 80;
		top: 0;
		bottom: 0;
		left: 0;
		width: 28px;
	}
</style>
