<script lang="ts">
	import { beforeNavigate, goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import SearchField from '#lib/SearchField.svelte';
	import Thumbnail from '#lib/Thumbnail.svelte';
	import Viewer from '#lib/Viewer.svelte';
	import { queryFromTag } from '#lib/explore.svelte.ts';
	import type { ExplorationPost } from '#lib/navigation.ts';
	import { playAdd, playRemove } from '#lib/sounds.ts';
	import {
		applyAlbumChoice,
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
	let suggestions = $state<{ name: string; count: number }[]>([]);
	let confirming = $state(false);
	let openId = $state<string | null>(null);
	let actionError = $state('');
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
	let selectionKey = $derived(`album:${data.album.id}`);
	let orderedIds = $derived(data.posts.map((item) => item.id));
	let selection = $derived(selectionSnapshot(selectionKey));
	let selecting = $derived(selection.active);
	let selectedCount = $derived(selectedIds(selectionKey, orderedIds).length);
	let openPost = $derived(data.posts.find((item) => item.id === openId) ?? null);
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

	function toDrag(item: (typeof data.posts)[number]): DragPost {
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

	function asPost(item: (typeof data.posts)[number]): ExplorationPost {
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

	function closeAlbumPicker(event: PointerEvent) {
		if (!albumPicker) return;
		const target = event.target;
		if (target instanceof Element && target.closest('.album-picker, [data-action="add-album"]')) return;
		hideAlbumPicker();
	}

	async function deleteAlbum() {
		const response = await fetch(`/api/library/albums/${data.album.id}`, { method: 'DELETE' });
		if (response.ok) await goto(resolve('/albums'));
	}
</script>

<svelte:window {onkeydown} onpointerdown={closeAlbumPicker} />

<main>
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
					void openAlbumPicker([], anchor, true);
					return;
				}
				void openAlbumPicker(
					data.posts.filter((item) => isSelected(selectionKey, item.id)).map(toDrag),
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
		<ul class="saved">
			{#each data.posts as item (item.id)}
				<li>
					{#if item.availability === 'unavailable'}
						<p>Unavailable</p>
					{:else if item.availability === 'ready'}
						<button
							type="button"
							class={['tile', isSelected(selectionKey, item.id) && 'selected']}
							onclick={(event) => onTileClick(item.id, event)}
						>
							<Thumbnail
								src={`${item.src}?recipe=thumb`}
								alt={item.tags}
								width={item.width}
								height={item.height}
								fit="intrinsic"
							/>
						</button>
					{/if}
					<ul aria-label="Classifications">
						{#each item.tagList as tag (tag.name)}
							<li data-category={tag.category}>{tag.name}</li>
						{/each}
					</ul>
					<button type="button" onclick={() => removeIds([item.id])}>Remove from album</button>
				</li>
			{/each}
		</ul>
	{/if}
	{#if openPost}
		<Viewer
			post={asPost(openPost)}
			posts={data.posts.filter((item) => item.availability === 'ready').map(asPost)}
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

	.tile {
		position: relative;
		border: 0;
		padding: 0;
		background: transparent;
	}

	.tile.selected :global(.thumb) {
		filter: brightness(0.68);
	}

	ul ul {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li li {
		display: block;
		padding: 2px 8px;
		border-radius: 8px;
		background: #252a33;
		color: #d5dbe6;
		font-size: 13px;
	}

	.notice {
		margin: 0;
		color: #ef9ba7;
	}
</style>
