<script lang="ts">
	import { beforeNavigate, goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Icon from '#lib/Icon.svelte';
	import SearchField from '#lib/SearchField.svelte';
	import Thumbnail from '#lib/Thumbnail.svelte';
	import Viewer from '#lib/Viewer.svelte';
	import { playAdd, playRemove } from '#lib/sounds.ts';
	import { justifyRows } from '#lib/justify.ts';
	import { queryFromTag } from '#lib/explore.svelte.ts';
	import type { ExplorationPost } from '#lib/navigation.ts';
	import { openContextMenu } from '#lib/menu.svelte.ts';
	import {
		GALLERY_DRAG,
		applyAlbumChoice,
		carryDrag,
		createAlbumRequest,
		deselectAll as clearSelection,
		exitSelection as leaveSelection,
		exportRequest,
		forgetIds,
		galleryClick,
		importRequest,
		isSelected,
		loadAlbumChoices,
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
	const selectionKey = 'favorites';
	let suggestions = $state<{ name: string; count: number }[]>([]);
	let galleryWidth = $state(960);
	let rowHeight = $state(190);
	let actionError = $state('');
	let openId = $state<string | null>(null);
	let albumPicker = $state<{
		posts: DragPost[];
		left: number;
		top: number;
		whole: boolean;
		albums: { id: string; name: string }[];
		memberships: { albumId: string; itemId: string }[];
	} | null>(null);
	let albumTitle = $state('');
	let albumError = $state('');
	let albumBusy = $state(false);
	let albumToken = 0;

	let tiles = $derived(
		data.favorites.map((item) => ({
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
	let openPost = $derived(tiles.find((post) => post.id === openId) ?? null);

	const collectionFilters = {
		rating: ['General', 'Sensitive', 'Questionable', 'Explicit'],
		media: ['Images', 'Animated images', 'Videos']
	};

	function currentScope(): SelectionQuery {
		return {
			source: 'favorites',
			sourceAlbumId: null,
			query: data.query.trim(),
			rating: [...collectionFilters.rating],
			media: [...collectionFilters.media],
			sort: 'Newest',
			seed: 0
		};
	}

	beforeNavigate((navigation) => {
		const next = navigation.to?.url;
		if (!next?.pathname.endsWith('/favorites')) return;
		const query = next.searchParams.get('q') ?? '';
		if (query.trim() !== data.query.trim()) leaveSelection(selectionKey);
	});

	function measureRow() {
		const value = Number.parseFloat(
			getComputedStyle(document.documentElement).getPropertyValue('--row')
		);
		if (Number.isFinite(value) && value > 0) rowHeight = value;
	}

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
		leaveSelection(selectionKey);
		await goto(resolve(`favorites?${new URLSearchParams({ q: draft })}`));
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

	function toDrag(item: (typeof tiles)[number]): DragPost {
		return {
			remoteId: item.id,
			itemId: item.id,
			tags: item.tags.split(/\s+/).filter(Boolean),
			width: item.width,
			height: item.height
		};
	}

	function onTileClick(id: string, event: MouseEvent) {
		const result = galleryClick(selectionKey, id, orderedIds, event);
		if (result === 'open') openId = id;
	}

	function onTileDrag(event: DragEvent, item: (typeof tiles)[number]) {
		const posts = carryDrag(selectionKey, item.id, tiles).map(toDrag);
		event.dataTransfer?.setData(GALLERY_DRAG, JSON.stringify(posts));
		event.dataTransfer?.setData('text/plain', JSON.stringify(posts));
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
	}

	async function removeIds(ids: string[]) {
		if (!ids.length) return;
		actionError = '';
		const results = await Promise.all(
			ids.map((id) => fetch(`/api/library/favorites/${encodeURIComponent(id)}`, { method: 'DELETE' }))
		);
		if (results.some((response) => !response.ok)) actionError = 'Favorite could not be removed';
		else playRemove();
		forgetIds(selectionKey, ids.filter((_, index) => results[index]?.ok));
		if (openId && ids.includes(openId)) openId = null;
		await invalidateAll();
	}

	async function removeSelection() {
		const body = importRequest(selectionKey, { operation: 'remove', destination: 'favorite' });
		if (!body) {
			await removeIds(selectedIds(selectionKey, orderedIds));
			return;
		}
		actionError = '';
		const ok = await submitImport(body);
		if (!ok) {
			actionError = 'Favorite could not be removed';
			return;
		}
		playRemove();
	}

	async function removeFavorite(id: string) {
		await removeIds([id]);
	}

	function hideAlbumPicker() {
		albumToken += 1;
		albumPicker = null;
	}

	function membershipCount(albumId: string) {
		if (!albumPicker) return 0;
		return new Set(
			albumPicker.memberships.filter((item) => item.albumId === albumId).map((item) => item.itemId)
		).size;
	}

	async function openAlbumPicker(posts: DragPost[], anchor: HTMLElement | null, whole: boolean) {
		if (!whole && !posts.length) return;
		const token = ++albumToken;
		const rect = anchor?.getBoundingClientRect();
		albumTitle = '';
		albumError = '';
		albumPicker = {
			posts,
			left: rect?.left ?? 80,
			top: (rect?.bottom ?? 64) + 8,
			whole,
			albums: [],
			memberships: []
		};
		const loaded = await loadAlbumChoices(whole ? [] : posts);
		if (token !== albumToken || !albumPicker || !loaded) return;
		albumPicker.albums = loaded.albums;
		albumPicker.memberships = loaded.memberships;
	}

	async function toggleListedAlbum(albumId: string) {
		if (!albumPicker || albumPicker.whole || albumBusy) return;
		albumBusy = true;
		albumError = '';
		const token = albumToken;
		const posts = albumPicker.posts;
		try {
			const result = await applyAlbumChoice(albumId, posts, albumPicker.memberships);
			if (result === 'add') playAdd();
			else if (result === 'remove') playRemove();
			else if (result === 'failed') albumError = 'Album could not be updated';
			const loaded = await loadAlbumChoices(posts);
			if (token === albumToken && albumPicker && loaded) {
				albumPicker.albums = loaded.albums;
				albumPicker.memberships = loaded.memberships;
			}
			await invalidateAll();
		} finally {
			albumBusy = false;
		}
	}

	async function addQueryToAlbum(albumId: string) {
		if (!albumPicker?.whole || albumBusy) return;
		const body = importRequest(selectionKey, { operation: 'add', destination: 'album', albumId });
		if (!body) return;
		albumBusy = true;
		albumError = '';
		try {
			const ok = await submitImport(body);
			if (!ok) {
				albumError = 'Album could not be updated';
				return;
			}
			playAdd();
			hideAlbumPicker();
			await invalidateAll();
		} finally {
			albumBusy = false;
		}
	}

	async function createFromPicker() {
		if (!albumPicker || albumBusy) return;
		const created = await createAlbumRequest(albumTitle);
		if (!('id' in created)) {
			albumError = created.message;
			return;
		}
		albumTitle = '';
		if (albumPicker.whole) await addQueryToAlbum(created.id);
		else await toggleListedAlbum(created.id);
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

	function postsFor(id: string) {
		return carryDrag(selectionKey, id, tiles).map(toDrag);
	}

	function closeAlbumPicker(event: PointerEvent) {
		if (!albumPicker) return;
		const target = event.target;
		if (target instanceof Element && target.closest('.album-picker, [data-action="add-album"]')) return;
		hideAlbumPicker();
	}

	function onGalleryKey(event: KeyboardEvent) {
		if (albumPicker && event.key === 'Escape') {
			event.preventDefault();
			hideAlbumPicker();
			return;
		}
		if (editingText(event.target) || openId) return;
		if (document.querySelector('dialog[open]')) return;
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

	function onTileMenu(event: MouseEvent, post: (typeof tiles)[number]) {
		openContextMenu(
			event,
			[
				{ id: 'album', label: 'Add to album', icon: 'book-image' },
				{ id: 'favorite', label: 'Unfavorite', icon: 'heart' },
				{ id: 'remove', label: 'Remove from Favorites', icon: 'trash', danger: true, separator: true }
			],
			(action) => {
				if (action === 'album') {
					void openAlbumPicker(postsFor(post.id), event.currentTarget as HTMLElement, false);
				}
				if (action === 'favorite' || action === 'remove') void removeFavorite(post.id);
			}
		);
	}
</script>

<svelte:window onkeydown={onGalleryKey} onpointerdown={closeAlbumPicker} />

<main class="favorites">
	<h1>Favorites</h1>
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
					void openAlbumPicker([], anchor, true);
					return;
				}
				void openAlbumPicker(
					postsFor(orderedIds.find((id) => isSelected(selectionKey, id)) ?? ''),
					anchor,
					false
				);
			}}
			onfavorite={() => void removeSelection()}
			ondownload={() => void downloadSelection()}
			onremove={() => void removeSelection()}
		/>
	{/key}
	{#if actionError}
		<p class="notice" role="alert">{actionError}</p>
	{/if}
	{#if data.explanation}
		<p>{data.explanation}</p>
	{:else if !data.searched && data.favorites.length === 0}
		<p class="quiet">No favorites yet.</p>
	{:else if data.favorites.length === 0}
		<p class="quiet">No results</p>
	{:else}
		<div class="gallery" bind:clientWidth={galleryWidth} {@attach measureRow}>
			{#each rows as row, index (index)}
				<div class="row">
					{#each row as post (post.id)}
						<div class="post" style:width="{post.width}px">
							<!-- Drag and the menu sit on the tile; the image button opens or selects it. -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class={['tile', isSelected(selectionKey, post.id) && 'selected', { 'drop-target': false }]}
								style:height="{post.height}px"
								draggable="true"
								data-post={post.id}
								ondragstart={(event) => onTileDrag(event, post)}
								oncontextmenu={(event) => onTileMenu(event, post)}
							>
								<span class="selection-badge" aria-hidden="true"><Icon name="check" /></span>
								<button
									type="button"
									class="open"
									aria-label="Open image"
									onclick={(event) => onTileClick(post.id, event)}
								></button>
								{#if post.availability === 'unavailable'}
									<p class="missing">Unavailable</p>
								{:else if post.availability === 'ready'}
									<Thumbnail
										src={`${post.src}?recipe=thumb`}
										alt={post.tags}
										width={Math.round(post.width)}
										height={Math.round(post.height)}
										draggable={false}
									/>
								{/if}
								<button
									type="button"
									class="tile-action hearted"
									aria-label="Remove favorite"
									onclick={(event) => {
										event.stopPropagation();
										void removeFavorite(post.id);
									}}
								>
									<Icon name="heart" />
								</button>
							</div>
							<ul class="tags" aria-label="Classifications">
								{#each post.tagList as tag (tag.name)}
									<li data-category={tag.category}>{tag.name}</li>
								{/each}
							</ul>
						</div>
					{/each}
				</div>
			{/each}
		</div>
	{/if}
	{#if openPost}
		<Viewer
			post={asPost(openPost)}
			posts={tiles.filter((item) => item.availability === 'ready').map(asPost)}
			imageSrc={openPost.src}
			collection="favorite"
			onclose={() => (openId = null)}
			ontag={(tag, event, anchor) => {
				if (event.metaKey || event.ctrlKey || event.button === 1) {
					queryFromTag(tag, event, anchor);
					return;
				}
				openId = null;
				const next = event.shiftKey ? `${data.query} ${tag}`.trim() : tag;
				leaveSelection(selectionKey);
				void goto(resolve(`favorites?${new URLSearchParams({ q: next })}`));
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
		<div class="popup album-picker" style:left="{albumPicker.left}px" style:top="{albumPicker.top}px">
			<h3>{albumPicker.whole ? 'Add matching posts' : 'Albums'}</h3>
			{#each albumPicker.albums as album (album.id)}
				{@const count = membershipCount(album.id)}
				{@const total = albumPicker.posts.length}
				{@const complete = count === total && total > 0}
				{@const partial = count > 0 && count < total}
				{#if albumPicker.whole}
					<button type="button" class="menu-item" onclick={() => void addQueryToAlbum(album.id)}>
						{album.name}
					</button>
				{:else}
					<label>
						<input
							type="checkbox"
							checked={complete}
							onchange={() => void toggleListedAlbum(album.id)}
							{@attach (node) => {
								node.indeterminate = partial;
								node.checked = complete;
							}}
						/>
						{album.name}
					</label>
				{/if}
			{:else}
				<p class="muted">No albums yet</p>
			{/each}
			<form
				onsubmit={(event) => {
					event.preventDefault();
					void createFromPicker();
				}}
			>
				<input
					bind:value={albumTitle}
					aria-label="New album title"
					placeholder="New album"
					maxlength="80"
				/>
				<button type="submit">Create</button>
			</form>
			{#if albumError}<p class="notice" role="alert">{albumError}</p>{/if}
		</div>
	{/if}
</main>

<style>
	.favorites {
		max-width: none;
		padding: 16px 26px 24px;
	}

	.favorites h1 {
		margin: 0;
	}

	.quiet {
		color: #717a8b;
	}

	.notice {
		margin: 0;
		color: #ef9ba7;
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
		border-radius: 17px;
		background: #191e25;
	}

	.tile.selected {
		box-shadow: inset 0 0 0 3px #bfd3f5;
	}

	.open {
		position: absolute;
		inset: 0;
		z-index: 1;
		padding: 0;
		border: 0;
		background: transparent;
	}

	.tile.drop-target {
		outline: 1px solid #90a9c5;
		background: #34465a;
	}

	.selection-badge {
		display: none;
		position: absolute;
		top: 9px;
		left: 9px;
		z-index: 2;
		width: 20px;
		height: 20px;
		place-items: center;
		border-radius: 50%;
		background: #bfd3f5;
		color: #172238;
		--icon-size: 12px;
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

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: 8px 0 0;
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

	@supports (corner-shape: squircle) {
		.tile {
			border-radius: 23px;
			corner-shape: squircle;
		}
	}

	.tile-action {
		position: absolute;
		top: 7px;
		right: 7px;
		z-index: 4;
		display: grid;
		place-items: center;
		width: 29px;
		height: 29px;
		padding: 0;
		border: 0;
		border-radius: 9px;
		background: #10131c9c;
	}

	.hearted {
		color: #ff899c;
	}

	.hearted :global(svg) {
		fill: currentColor;
	}
</style>
