<script lang="ts">
	import { beforeNavigate, goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import AlbumPicker from '#lib/AlbumPicker.svelte';
	import Icon from '#lib/Icon.svelte';
	import SearchField from '#lib/SearchField.svelte';
	import Thumbnail from '#lib/Thumbnail.svelte';
	import Viewer from '#lib/Viewer.svelte';
	import { queryFromTag } from '#lib/explore.svelte.ts';
	import { justifyRows, selectionOutline, squirclePath, squircleRadius } from '#lib/justify.ts';
	import type { ExplorationPost } from '#lib/navigation.ts';
	import { playAdd, playRemove } from '#lib/sounds.ts';
	import {
		deselectAll as clearSelection,
		exitSelection as leaveSelection,
		exportRequest,
		forgetIds,
		galleryClick,
		importRequest,
		isSelected,
		saveDownload,
		selectLoaded,
		selectedIds,
		selectionQuery,
		selectionSnapshot,
		submitImport,
		type DragPost,
		type SelectionQuery
	} from '#lib/selection.svelte.ts';
	import { editingText, matchesShortcut } from '#lib/shortcuts.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let suggestions = $state<{ name: string; count: number }[]>([]);
	let galleryWidth = $state(960);
	let rowHeight = $state(190);
	let confirming = $state(false);
	let openId = $state<string | null>(null);
	let actionError = $state('');
	let albumPicker = $state<{
		posts: DragPost[];
		anchor: HTMLElement | null;
		whole: boolean;
	} | null>(null);
	let selectionKey = $derived(`album:${data.album.id}`);
	let tiles = $derived(
		data.posts.map((item) => ({
			...item,
			width: item.width > 0 ? item.width : 190,
			height: item.height > 0 ? item.height : 190
		}))
	);
	let rows = $derived(justifyRows(tiles, Math.max(galleryWidth, 320), rowHeight));
	let orderedIds = $derived(tiles.map((post) => post.id));
	let selection = $derived(selectionSnapshot(selectionKey));
	let selecting = $derived(selection.active);
	let selectedCount = $derived(selectedIds(selectionKey, orderedIds).length);
	let openPost = $derived(tiles.find((item) => item.id === openId) ?? null);
	const collectionFilters = {
		rating: ['General', 'Sensitive', 'Questionable', 'Explicit'],
		media: ['Images', 'Animated images', 'Videos']
	};

	function currentScope(): SelectionQuery {
		return {
			source: 'album',
			sourceAlbumId: data.album.id,
			query: data.query.trim(),
			rating: [...collectionFilters.rating],
			media: [...collectionFilters.media],
			sort: 'Newest',
			seed: 0
		};
	}

	beforeNavigate((navigation) => {
		const next = navigation.to?.url;
		if (!next?.pathname.endsWith(`/${data.album.id}`)) return;
		const query = next.searchParams.get('q') ?? '';
		if (query.trim() !== data.query.trim()) leaveSelection(selectionKey);
	});

	function measureRow() {
		const value = Number.parseFloat(
			getComputedStyle(document.documentElement).getPropertyValue('--row')
		);
		if (Number.isFinite(value) && value > 0) rowHeight = value;
	}

	function toDrag(item: (typeof tiles)[number]): DragPost {
		return {
			remoteId: item.id,
			itemId: item.id,
			tags: item.tags.split(/\s+/).filter(Boolean),
			width: item.width,
			height: item.height
		};
	}

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
		leaveSelection(selectionKey);
		await goto(resolve(`albums/${data.album.id}?${new URLSearchParams({ q: draft })}`));
	}

	function asPost(item: (typeof tiles)[number]): ExplorationPost {
		return {
			id: item.id,
			width: item.width,
			height: item.height,
			tags: item.tags.split(/\s+/).filter(Boolean),
			mediaRef: item.id
		};
	}

	function onTileClick(id: string, event: MouseEvent) {
		const result = galleryClick(selectionKey, id, orderedIds, event);
		if (result === 'open') openId = id;
	}

	async function removeIds(ids: string[]) {
		if (!ids.length) return;
		actionError = '';
		const results = await Promise.all(
			ids.map((itemId) =>
				fetch(`/api/library/albums/${encodeURIComponent(data.album.id)}/items/${encodeURIComponent(itemId)}`, {
					method: 'DELETE'
				})
			)
		);
		if (results.some((response) => !response.ok)) actionError = 'Post could not be removed';
		else playRemove();
		forgetIds(
			selectionKey,
			ids.filter((_, index) => results[index]?.ok)
		);
		if (openId && ids.includes(openId)) openId = null;
		await invalidateAll();
	}

	async function removeSelection() {
		const body = importRequest(selectionKey, {
			operation: 'remove',
			destination: 'album',
			albumId: data.album.id
		});
		if (!body) {
			await removeIds(selectedIds(selectionKey, orderedIds));
			return;
		}
		actionError = '';
		const ok = await submitImport(body);
		if (!ok) {
			actionError = 'Post could not be removed';
			return;
		}
		playRemove();
	}

	async function favoriteSelection() {
		const body = importRequest(selectionKey, { operation: 'add', destination: 'favorite' });
		if (body) {
			actionError = '';
			const ok = await submitImport(body);
			if (!ok) actionError = 'Favorites could not be updated.';
			else playAdd();
			return;
		}
		const ids = selectedIds(selectionKey, orderedIds);
		if (!ids.length) return;
		actionError = '';
		const results = await Promise.all(
			ids.map((id) =>
				fetch('/api/library/favorites', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ itemId: id })
				})
			)
		);
		if (results.every((response) => response.ok)) playAdd();
		else actionError = 'Favorites could not be updated.';
	}

	function hideAlbumPicker() {
		albumPicker = null;
	}

	function openAlbumPicker(posts: DragPost[], anchor: HTMLElement | null, whole: boolean) {
		if (!whole && !posts.length) return;
		albumPicker = { posts, anchor, whole };
	}

	async function downloadSelection() {
		const ids = selectedIds(selectionKey, orderedIds);
		if (!selectionQuery(selectionKey) && ids.length === 1) {
			const id = ids[0];
			if (!id) return;
			actionError = '';
			const response = await fetch(`/api/library/originals/${encodeURIComponent(id)}?download=1`);
			if (!response.ok) {
				actionError = 'The original is not ready.';
				return;
			}
			await saveDownload(response, 'original');
			return;
		}
		const body = exportRequest(selectionKey, ids);
		if (!body) return;
		actionError = '';
		try {
			const response = await fetch('/api/library/exports', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (response.status === 413) {
				actionError = 'That selection is too large to download.';
				return;
			}
			if (!response.ok) {
				actionError = 'The download could not be prepared.';
				return;
			}
			await saveDownload(response, 'panbooru.zip');
		} catch {
			actionError = 'The download could not be prepared.';
		}
	}

	function onkeydown(event: KeyboardEvent) {
		if (albumPicker && event.key === 'Escape') {
			event.preventDefault();
			hideAlbumPicker();
			return;
		}
		if (confirming && event.key === 'Escape') {
			confirming = false;
			return;
		}
		if (openId || editingText(event.target) || document.querySelector('dialog[open]')) return;
		if (matchesShortcut(event, 'select-all')) {
			event.preventDefault();
			selectLoaded(selectionKey, orderedIds, currentScope());
			return;
		}
		if (matchesShortcut(event, 'deselect')) {
			event.preventDefault();
			if (selecting) clearSelection(selectionKey);
			return;
		}
		if (matchesShortcut(event, 'remove') && selecting) {
			event.preventDefault();
			void removeSelection();
			return;
		}
		if (event.key === 'Escape' && selecting) {
			event.preventDefault();
			hideAlbumPicker();
			leaveSelection(selectionKey);
		}
	}

	async function deleteAlbum() {
		const response = await fetch(`/api/library/albums/${data.album.id}`, { method: 'DELETE' });
		if (response.ok) await goto(resolve('/albums'));
	}
</script>

<svelte:window {onkeydown} />

<main class="album">
	<h1>{data.album.name}</h1>
	<button type="button" onclick={() => (confirming = true)}>Delete</button>
	{#if confirming}
		<div role="dialog" aria-label="Delete this album?">
			<p>Delete this album?</p>
			<button type="button" onclick={() => (confirming = false)}>Cancel</button>
			<button type="button" onclick={deleteAlbum}>Delete album</button>
		</div>
	{/if}
	{#key data.query}
		<SearchField
			initial={data.query}
			{suggestions}
			{selecting}
			{selectedCount}
			allQuery={selection.allQuery && selection.excluded === 0}
			oninput={suggest}
			onsearch={search}
			onexitselection={() => {
				hideAlbumPicker();
				leaveSelection(selectionKey);
			}}
			onselectall={() => selectLoaded(selectionKey, orderedIds, currentScope())}
			ondeselect={() => clearSelection(selectionKey)}
			onalbum={(anchor) => {
				if (selectionQuery(selectionKey)) {
					openAlbumPicker([], anchor, true);
					return;
				}
				openAlbumPicker(
					tiles.filter((item) => isSelected(selectionKey, item.id)).map(toDrag),
					anchor,
					false
				);
			}}
			onfavorite={() => void favoriteSelection()}
			ondownload={() => void downloadSelection()}
			onremove={() => void removeSelection()}
		/>
	{/key}
	{#if actionError}
		<p class="notice" role="alert">{actionError}</p>
	{/if}
	{#if data.explanation}
		<p>{data.explanation}</p>
	{:else if !data.searched && data.posts.length === 0}
		<p>No posts in this album.</p>
	{:else if data.posts.length === 0}
		<p>No results</p>
	{:else}
		<div class="frame" bind:clientWidth={galleryWidth}>
			<div class="gallery" {@attach measureRow}>
				{#each rows as row, index (index)}
					<div class="row">
						{#each row as post (post.id)}
							{@const width = Math.max(post.width, 1)}
							{@const height = Math.max(post.height, 1)}
							<div class="post" style:width="{width}px">
								<div
									class={['tile', isSelected(selectionKey, post.id) && 'selected']}
									style:height="{height}px"
									style:--squircle={`path('${squirclePath(width, height, squircleRadius)}')`}
									data-post={post.id}
								>
									<span class="selection-badge" aria-hidden="true"><Icon name="check" /></span>
									<button
										type="button"
										class="open"
										aria-label="Open image"
										onclick={(event) => onTileClick(post.id, event)}
									>
										{#if post.availability === 'unavailable'}
											<p class="missing">Unavailable</p>
										{:else if post.availability === 'ready'}
											<Thumbnail
												src={`${post.src}?recipe=thumb`}
												alt={post.tags}
												width={Math.round(width)}
												height={Math.round(height)}
												draggable={false}
											/>
										{/if}
									</button>
									{#if isSelected(selectionKey, post.id)}
										<svg
											class="selection-outline"
											viewBox="0 0 {width} {height}"
											aria-hidden="true"
										>
											<path
												d={selectionOutline(width, height)}
												fill="#bfd3f5"
												fill-rule="evenodd"
											/>
										</svg>
									{/if}
									<div class="tile-actions">
										<button
											type="button"
											class="tile-action"
											aria-label="Remove from album"
											onclick={(event) => {
												event.stopPropagation();
												void removeIds([post.id]);
											}}
										>
											<Icon name="trash" />
										</button>
									</div>
								</div>
							</div>
						{/each}
					</div>
				{/each}
			</div>
		</div>
	{/if}
	{#if openPost}
		<Viewer
			post={asPost(openPost)}
			posts={tiles.filter((item) => item.availability === 'ready').map(asPost)}
			imageSrc={openPost.src}
			collection="album"
			albumId={data.album.id}
			onclose={() => (openId = null)}
			ontag={(tag, event, anchor) => {
				if (event.metaKey || event.ctrlKey || event.button === 1) {
					queryFromTag(tag, event, anchor);
					return;
				}
				openId = null;
				const next = event.shiftKey ? `${data.query} ${tag}`.trim() : tag;
				leaveSelection(selectionKey);
				void goto(resolve(`albums/${data.album.id}?${new URLSearchParams({ q: next })}`));
			}}
			onmove={(id) => (openId = id)}
			onremoved={(id) => {
				forgetIds(selectionKey, [id]);
				playRemove();
				void invalidateAll();
			}}
		/>
	{/if}
	{#if albumPicker}
		<AlbumPicker
			posts={albumPicker.posts}
			anchor={albumPicker.anchor}
			whole={albumPicker.whole}
			{selectionKey}
			onclose={hideAlbumPicker}
		/>
	{/if}
</main>

<style>
	.album {
		max-width: none;
		padding: 16px 26px 24px;
	}

	.notice {
		margin: 0;
		color: #ef9ba7;
	}

	.frame,
	.gallery {
		width: 100%;
	}

	.gallery {
		display: grid;
		gap: 4px;
	}

	.row {
		display: flex;
		gap: 4px;
	}

	.tile {
		position: relative;
		overflow: hidden;
		border: 0;
		border-radius: 0;
		background: #191e25;
		clip-path: var(--squircle);
	}

	.open {
		position: absolute;
		inset: 0;
		z-index: 1;
		width: 100%;
		height: 100%;
		padding: 0;
		border: 0;
		background: transparent;
	}

	.selection-badge {
		display: none;
		position: absolute;
		top: 9px;
		left: 9px;
		z-index: 5;
		width: 20px;
		height: 20px;
		place-items: center;
		border-radius: 50%;
		background: #bfd3f5;
		color: #172238;
		--icon-size: 12px;
		box-shadow: 0 2px 12px rgb(18 42 88 / 55%);
	}

	.tile.selected .selection-badge {
		display: grid;
	}

	.missing {
		display: grid;
		height: 100%;
		margin: 0;
		place-items: center;
		color: #8c94a4;
	}

	.selection-outline {
		position: absolute;
		inset: 0;
		z-index: 3;
		width: 100%;
		height: 100%;
		overflow: hidden;
		pointer-events: none;
	}

	.selection-outline path {
		filter: drop-shadow(0 2px 12px rgb(18 42 88 / 55%));
		opacity: 1;
	}

	.tile-actions {
		position: absolute;
		top: 7px;
		right: 7px;
		z-index: 4;
		display: flex;
		gap: 5px;
		opacity: 0;
	}

	.tile:hover .tile-actions,
	.tile:focus-within .tile-actions {
		opacity: 1;
	}

	.tile-action {
		display: grid;
		place-items: center;
		width: 29px;
		height: 29px;
		padding: 0;
		border: 0;
		border-radius: 9px;
		background: #10131c9c;
		color: #c9d0dc;
		backdrop-filter: blur(12px);
		--icon-size: 16px;
	}

	.tile-action:hover {
		background: #292e3bd9;
	}
</style>
