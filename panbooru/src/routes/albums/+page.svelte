<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Icon from '#lib/Icon.svelte';
	import CoverEditor, { coverFan, fanSlots, type CoverPick } from '#lib/CoverEditor.svelte';
	import { openContextMenu } from '#lib/menu.svelte.ts';
	import {
		deselectAll as clearSelection,
		exitSelection as leaveSelection,
		galleryClick,
		isSelected,
		selectLoaded,
		selectedIds,
		selectionSnapshot
	} from '#lib/selection.svelte.ts';
	import { editingText, matchesShortcut } from '#lib/shortcuts.ts';
	import { bindShellToolbar, getShell } from '../+layout.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const shell = getShell();
	bindShellToolbar(toolbar);

	const sortModes = ['Recently updated', 'Name', 'Creation date'] as const;
	type AlbumSort = (typeof sortModes)[number];

	let filter = $state('');
	let sortMode = $state<AlbumSort>('Recently updated');
	let sortOpen = $state(false);
	let sortBox = $state({ left: 0, top: 0 });
	let creating = $state(false);
	let albumName = $state('');
	let nameError = $state('');
	let creatingBusy = $state(false);
	let editingId = $state<string | null>(null);
	let savingCover = $state(false);
	let coverError = $state('');
	let pageError = $state('');
	let pendingDelete = $state<string | null>(null);
	let deleting = $state(false);
	let deleteError = $state('');

	let visible = $derived.by(() => {
		const needle = filter.trim().toLowerCase();
		const matched = data.albums.filter((album) => album.name.toLowerCase().includes(needle));
		const items = [...matched];
		if (sortMode === 'Name') {
			items.sort(
				(left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
			);
		} else if (sortMode === 'Creation date') {
			items.sort(
				(left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id)
			);
		} else {
			items.sort(
				(left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)
			);
		}
		return items;
	});
	const selectionKey = 'albums';
	let renaming = $state<{ id: string; name: string } | null>(null);
	let visibleIds = $derived(visible.map((album) => album.id));
	let selection = $derived(selectionSnapshot(selectionKey));
	let selecting = $derived(selection.active);
	let editing = $derived(data.albums.find((album) => album.id === editingId) ?? null);
	let deletingAlbum = $derived(data.albums.find((album) => album.id === pendingDelete) ?? null);

	function watchScroll() {
		const scroll = document.getElementById('scroll');
		if (!scroll) return;
		const update = () => {
			shell.overlay = scroll.scrollTop > 24;
		};
		update();
		scroll.addEventListener('scroll', update, { passive: true });
		return () => scroll.removeEventListener('scroll', update);
	}

	function closeSort(event: MouseEvent) {
		const target = event.target instanceof Element ? event.target : null;
		if (target?.closest('.popup, [aria-haspopup="true"]')) return;
		sortOpen = false;
	}

	function onWindowKey(event: KeyboardEvent) {
		if (event.key !== 'Escape' || !sortOpen) return;
		if (document.querySelector('dialog[open]')) return;
		event.preventDefault();
		sortOpen = false;
	}

	function toggleSort(event: MouseEvent) {
		if (sortOpen) {
			sortOpen = false;
			return;
		}
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		sortBox = {
			left: Math.max(10, Math.min(rect.left, window.innerWidth - 242)),
			top: rect.bottom + 8
		};
		sortOpen = true;
	}

	function chooseSort(mode: AlbumSort) {
		sortMode = mode;
		sortOpen = false;
	}

	function startCreate() {
		albumName = '';
		nameError = '';
		creating = true;
	}

	function stopCreate(event?: Event) {
		event?.preventDefault();
		if (creatingBusy) return;
		creating = false;
	}

	async function createAlbum(event: SubmitEvent) {
		event.preventDefault();
		const name = albumName.trim();
		if (!name) {
			nameError = 'Enter a title.';
			return;
		}
		creatingBusy = true;
		nameError = '';
		try {
			const response = await fetch('/api/library/albums', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name })
			});
			const body = (await response.json().catch(() => null)) as {
				data?: { id?: string };
				message?: string;
			} | null;
			if (!response.ok || !body?.data?.id) {
				nameError = body?.message ?? 'Album could not be created';
				return;
			}
			creating = false;
			await invalidateAll();
		} finally {
			creatingBusy = false;
		}
	}

	async function openAlbum(event: MouseEvent, id: string) {
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
			return;
		event.preventDefault();
		pageError = '';
		const response = await fetch(`/api/library/albums/${encodeURIComponent(id)}/open`, {
			method: 'POST'
		});
		if (!response.ok) {
			pageError = 'Album could not be opened';
			return;
		}
		await goto(resolve('/albums/[id]', { id }));
	}

	function candidatesFor(albumId: string): CoverPick[] {
		return (data.albumPosts[albumId] ?? []).map((post) => ({
			itemId: post.id,
			src: post.availability === 'unavailable' ? null : post.src,
			available: post.availability === 'ready',
			tags: post.tags.split(/\s+/).filter(Boolean)
		}));
	}

	function editorSlots(
		albumId: string,
		cover: (typeof data.albums)[number]['cover']
	): Array<CoverPick | null> {
		const candidates = candidatesFor(albumId);
		return fanSlots(cover).map((slot) => {
			if (!slot) return null;
			return candidates.find((item) => item.itemId === slot.itemId) ?? { ...slot, tags: [] };
		});
	}

	function startCover(id: string) {
		coverError = '';
		editingId = id;
	}

	function stopCover() {
		if (savingCover) return;
		editingId = null;
		coverError = '';
	}

	async function saveCover(slots: Array<string | null>) {
		if (!editingId) return;
		savingCover = true;
		coverError = '';
		try {
			const response = await fetch(`/api/library/albums/${encodeURIComponent(editingId)}/cover`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ slots })
			});
			const body = (await response.json().catch(() => null)) as { message?: string } | null;
			if (!response.ok) {
				coverError = body?.message ?? 'Cover could not be saved';
				return;
			}
			editingId = null;
			await invalidateAll();
		} finally {
			savingCover = false;
		}
	}

	function countLabel(count: number) {
		return count === 0 ? 'Empty' : `${count} items`;
	}

	function askDelete(id: string) {
		deleteError = '';
		pendingDelete = id;
	}

	function stopDelete(event?: Event) {
		event?.preventDefault();
		if (deleting) return;
		pendingDelete = null;
		deleteError = '';
	}

	function onCardClick(event: MouseEvent, id: string) {
		if (event.shiftKey || event.metaKey || event.ctrlKey || selecting) {
			event.preventDefault();
			galleryClick(selectionKey, id, visibleIds, event);
			return;
		}
		void openAlbum(event, id);
	}

	function onCardMenu(event: MouseEvent, album: (typeof data.albums)[number]) {
		openContextMenu(
			event,
			[
				{ id: 'open', label: 'Open', icon: 'book-image' },
				{ id: 'rename', label: 'Rename', icon: 'artist' },
				{ id: 'cover', label: 'Edit cover', icon: 'image' },
				{ id: 'pin', label: album.pinned ? 'Unpin' : 'Pin', icon: 'pin' },
				{ id: 'delete', label: 'Delete', icon: 'trash', danger: true, separator: true }
			],
			(action) => {
				if (action === 'open') void openAlbum(new MouseEvent('click'), album.id);
				else if (action === 'rename') renaming = { id: album.id, name: album.name };
				else if (action === 'cover') startCover(album.id);
				else if (action === 'pin') void setPinned(album.id, !album.pinned);
				else if (action === 'delete') askDelete(album.id);
			}
		);
	}

	async function setPinned(id: string, pinned: boolean) {
		const response = await fetch(`/api/library/albums/${encodeURIComponent(id)}/pin`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(pinned ? { pinned: true } : { pinned: false, keepOpen: true })
		});
		if (response.ok) await invalidateAll();
	}

	async function saveRename(event: SubmitEvent) {
		event.preventDefault();
		if (!renaming) return;
		const name = renaming.name.trim();
		if (!name) return;
		const response = await fetch(`/api/library/albums/${encodeURIComponent(renaming.id)}/name`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name })
		});
		if (!response.ok) return;
		renaming = null;
		await invalidateAll();
	}

	async function pinSelection() {
		const ids = selectedIds(selectionKey, visibleIds);
		const albums = data.albums.filter((album) => ids.includes(album.id));
		const unpin = albums.length > 0 && albums.every((album) => album.pinned);
		await Promise.all(albums.map((album) => setPinned(album.id, !unpin)));
	}

	async function deleteSelection() {
		const ids = selectedIds(selectionKey, visibleIds);
		if (!ids.length) return;
		if (!confirm('Delete the selected albums?')) return;
		await Promise.all(
			ids.map((id) => fetch(`/api/library/albums/${encodeURIComponent(id)}`, { method: 'DELETE' }))
		);
		leaveSelection(selectionKey);
		await invalidateAll();
	}

	function onGridKey(event: KeyboardEvent) {
		if (editingText(event.target) || sortOpen || renaming || creating) return;
		if (document.querySelector('dialog[open]')) return;
		if (matchesShortcut(event, 'select-all')) {
			event.preventDefault();
			selectLoaded(selectionKey, visibleIds);
			return;
		}
		if (matchesShortcut(event, 'deselect')) {
			event.preventDefault();
			if (selecting) clearSelection(selectionKey);
			return;
		}
		if (event.key === 'Escape' && selecting) {
			event.preventDefault();
			leaveSelection(selectionKey);
		}
	}

	async function confirmDelete() {
		if (!pendingDelete) return;
		deleting = true;
		deleteError = '';
		try {
			const response = await fetch(`/api/library/albums/${encodeURIComponent(pendingDelete)}`, {
				method: 'DELETE'
			});
			const body = (await response.json().catch(() => null)) as { message?: string } | null;
			if (!response.ok) {
				deleteError = body?.message ?? 'Album could not be deleted';
				return;
			}
			pendingDelete = null;
			await invalidateAll();
		} finally {
			deleting = false;
		}
	}
</script>

<svelte:window onclick={closeSort} onkeydown={onWindowKey} onkeydowncapture={onGridKey} />

{#snippet toolbar()}
	<div class="selection-bar" data-selection-bar hidden={!selecting}>
		<button type="button" class="icon-btn" data-action="exit-selection" aria-label="Exit selection" onclick={() => leaveSelection(selectionKey)}>
			<Icon name="x" />
		</button>
		<input data-action="select-all" type="checkbox" aria-label="Select all" checked={selection.allQuery && selection.excluded === 0} onchange={() => selectLoaded(selectionKey, visibleIds)} />
		<span class="selection-count">{selectedIds(selectionKey, visibleIds).length} selected</span>
		<button type="button" class="selection-clear" data-action="deselect-all" onclick={() => clearSelection(selectionKey)}>Deselect all</button>
		<button type="button" class="icon-btn" aria-label="Pin or unpin" onclick={() => pinSelection()}><Icon name="pin" /></button>
		<button type="button" class="icon-btn" aria-label="Delete albums" onclick={() => deleteSelection()}><Icon name="trash" /></button>
	</div>
	<div class="grid-tools" hidden={selecting}>
	<Icon name="search" />
	<input
		class="grid-search"
		type="search"
		placeholder="Search albums…"
		aria-label="Album search"
		bind:value={filter}
	/>
	<div class="menu-anchor">
		<button
			type="button"
			class="icon-btn"
			title="Sort albums"
			aria-label="Sort albums"
			aria-expanded={sortOpen}
			aria-haspopup="true"
			onclick={toggleSort}
		>
			<Icon name="sort" />
		</button>
		{#if sortOpen}
			<div class="popup" style:left="{sortBox.left}px" style:top="{sortBox.top}px">
				<h3>Sort albums</h3>
				{#each sortModes as mode (mode)}
					<button
						type="button"
						class="menu-item"
						aria-pressed={sortMode === mode}
						onclick={() => chooseSort(mode)}
					>
						{#if sortMode === mode}<Icon name="check" />{/if}
						{mode}
					</button>
				{/each}
			</div>
		{/if}
	</div>
	<button type="button" class="search-submit" onclick={startCreate}>Create album</button>
	</div>
{/snippet}

<main class="collection" {@attach watchScroll}>
	<div class="page-heading">
		<h1>Albums</h1>
	</div>
	{#if pageError}
		<p class="notice" role="alert">{pageError}</p>
	{/if}
	{#if data.albums.length === 0}
		<div class="empty">
			<Icon name="book-image" --icon-size="38px" />
			<h2>No albums yet.</h2>
			<button type="button" class="empty-create" onclick={startCreate}>Create album</button>
		</div>
	{:else if visible.length === 0}
		<div class="empty">
			<Icon name="book-image" --icon-size="38px" />
			<h2>No results</h2>
		</div>
	{:else}
		<div class="album-grid">
			{#each visible as album (album.id)}
				<article
					class={['album-card', isSelected(selectionKey, album.id) && 'selected', { 'drop-target': false }]}
					data-kind="album"
					data-collection={album.id}
					oncontextmenu={(event) => onCardMenu(event, album)}
				>
					<span class="selection-badge" aria-hidden="true"><Icon name="check" /></span>
					<a
						class="card-hit"
						href={resolve('/albums/[id]', { id: album.id })}
						onclick={(event) => onCardClick(event, album.id)}
					>
						{@render coverFan(fanSlots(album.cover))}
						<div class="album-name" title={album.name}>
							{#if album.pinned}<Icon name="pin" />{/if}
							{album.name}
						</div>
						<div class="album-count">{countLabel(album.itemCount)}</div>
					</a>
					<div class="card-actions">
						<button
							type="button"
							class="icon-btn"
							aria-label="Edit cover for {album.name}"
							title="Edit cover"
							onclick={() => startCover(album.id)}
						>
							<Icon name="image" />
						</button>
						<button
							type="button"
							class="icon-btn"
							aria-label="Delete {album.name}"
							title="Delete"
							onclick={() => askDelete(album.id)}
						>
							<Icon name="trash" />
						</button>
					</div>
				</article>
			{/each}
		</div>
	{/if}
</main>

{#if creating}
	<dialog
		aria-labelledby="create-album-title"
		{@attach (node) => {
			node.showModal();
			return () => {
				if (node.open) node.close();
			};
		}}
		oncancel={stopCreate}
	>
		<form onsubmit={createAlbum}>
			<h2 id="create-album-title">Create album</h2>
			<input
				type="text"
				aria-label="Title"
				aria-describedby={nameError ? 'album-name-error' : undefined}
				maxlength="80"
				bind:value={albumName}
			/>
			{#if nameError}
				<p id="album-name-error" class="notice" role="alert">{nameError}</p>
			{/if}
			<div class="dialog-actions">
				<button type="button" disabled={creatingBusy} onclick={() => stopCreate()}>Cancel</button>
				<button type="submit" class="primary" disabled={creatingBusy}>Create</button>
			</div>
		</form>
	</dialog>
{/if}

{#if deletingAlbum}
	<dialog
		aria-labelledby="delete-album-title"
		{@attach (node) => {
			node.showModal();
			return () => {
				if (node.open) node.close();
			};
		}}
		oncancel={stopDelete}
	>
		<h2 id="delete-album-title">Delete this album?</h2>
		{#if deleteError}
			<p class="notice" role="alert">{deleteError}</p>
		{/if}
		<div class="dialog-actions">
			<button type="button" disabled={deleting} onclick={() => stopDelete()}>Cancel</button>
			<button type="button" class="primary" disabled={deleting} onclick={confirmDelete}
				>Delete</button
			>
		</div>
	</dialog>
{/if}

{#if editing}
	<CoverEditor
		slots={editorSlots(editing.id, editing.cover)}
		candidates={candidatesFor(editing.id)}
		saving={savingCover}
		error={coverError}
		onsave={saveCover}
		oncancel={stopCover}
	/>
{/if}

{#if renaming}
	<dialog
		aria-labelledby="rename-album-title"
		{@attach (node) => {
			node.showModal();
			return () => {
				if (node.open) node.close();
			};
		}}
		onclose={() => (renaming = null)}
	>
		<form onsubmit={saveRename}>
			<h2 id="rename-album-title">Rename album</h2>
			<label>
				Title
				<input bind:value={renaming.name} />
			</label>
			<button type="button" onclick={() => (renaming = null)}>Cancel</button>
			<button type="submit">Save</button>
		</form>
	</dialog>
{/if}

<style>
	.selection-bar,
	.grid-tools {
		display: flex;
		flex: 1;
		align-items: center;
		gap: 7px;
		min-width: 0;
	}

	.selection-count {
		flex: 1;
	}

	.collection {
		max-width: none;
		padding: 8px 26px 40px;
	}

	.page-heading {
		padding: 15px 0 22px;
	}

	.grid-search {
		flex: 1;
		min-width: 0;
		height: 36px;
		padding: 0 8px 0 0;
		border: 0;
		background: transparent;
		color: inherit;
	}

	.menu-anchor {
		display: contents;
	}

	.popup {
		position: fixed;
		z-index: 30;
		min-width: 230px;
		max-height: 65vh;
		padding: 9px;
		overflow: auto;
		border: 1px solid #363c49;
		border-radius: 13px;
		background: #1c2028f7;
		box-shadow: 0 16px 50px #0007;
		backdrop-filter: blur(22px);
	}

	.popup h3 {
		margin: 0 0 6px;
		padding: 4px 8px;
		color: #8f99aa;
		font-size: 11px;
		font-weight: 500;
	}

	.menu-item {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		height: auto;
		padding: 10px;
		border: 0;
		border-radius: 7px;
		background: none;
		color: inherit;
		text-align: left;
	}

	.menu-item:hover,
	.menu-item:focus-visible {
		background: #303848;
	}

	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: auto;
		height: 38px;
		min-width: 34px;
		padding: 8px;
		border: 1px solid #2b2f39;
		border-radius: 10px;
		background: #191c23;
		color: #b1b7c3;
	}

	.icon-btn:hover {
		background: #282e39;
		color: #fff;
	}

	.search-submit,
	.empty-create {
		height: auto;
		padding: 10px 18px;
		border: 0;
		border-radius: 9px;
		background: #c4d0e4;
		color: #182032;
	}

	.search-submit {
		height: 38px;
		padding: 0 12px;
		border: 1px solid #343842;
		border-radius: 10px;
		background: #20232b;
		color: #a3a8b5;
	}

	.album-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 30px 10px;
		padding: 22px 15px;
	}

	.album-card {
		position: relative;
		min-width: 0;
		border-radius: 13px;
	}

	.album-card.selected {
		outline: 1px solid #9ab5dc;
		background: #9ab5dc12;
	}

	.album-card.drop-target {
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

	.album-card.selected .selection-badge {
		display: grid;
	}

	.card-hit {
		display: block;
		width: 100%;
		height: auto;
		padding: 0 0 14px;
		border: 0;
		background: none;
		color: inherit;
		text-align: center;
		text-decoration: none;
	}

	.album-name {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		overflow: hidden;
		font-size: 14px;
		font-weight: 500;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.album-count {
		margin-top: 4px;
		color: #757d8d;
		font-size: 11px;
	}

	.card-actions {
		display: flex;
		justify-content: center;
		gap: 6px;
	}

	.card-actions .icon-btn {
		height: 30px;
		min-width: 30px;
		padding: 6px;
		background: #10131ce6;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		min-height: 45vh;
		color: #8c94a4;
	}

	.empty h2 {
		margin: 0;
		color: #d3d9e4;
		font-size: 19px;
		font-weight: 450;
	}

	.notice {
		margin: 0;
		color: #ef9ba7;
	}

	@media (max-width: 850px) {
		.collection {
			padding-right: 15px;
			padding-left: 15px;
		}
	}
</style>
