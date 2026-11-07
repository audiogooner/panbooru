<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Icon from '#lib/Icon.svelte';
	import CoverEditor, { coverFan, fanSlots, type CoverPick } from '#lib/CoverEditor.svelte';
	import { activeView, commitNavigation, navigation, storePosts } from '#lib/explore.svelte.ts';
	import { newView } from '#lib/navigation.ts';
	import { openContextMenu } from '#lib/menu.svelte.ts';
	import {
		deselectAll as clearSelection,
		exitSelection as leaveSelection,
		forgetIds,
		galleryClick,
		isSelected,
		selectLoaded,
		selectedIds,
		selectionSnapshot
	} from '#lib/selection.svelte.ts';
	import { playAdd } from '#lib/sounds.ts';
	import { editingText, matchesShortcut } from '#lib/shortcuts.ts';
	import { bindShellToolbar, getShell } from '../+layout.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const shell = getShell();
	bindShellToolbar(toolbar);

	const typeFilters = ['All', 'Artist', 'Character', 'Search'] as const;
	type TypeFilter = (typeof typeFilters)[number];

	let filter = $state('');
	let typeFilter = $state<TypeFilter>('All');
	let typeOpen = $state(false);
	let typeBox = $state({ left: 0, top: 0 });
	let previews = $state<Record<string, CoverPick[]>>({});
	let editingId = $state<string | null>(null);
	let savingCover = $state(false);
	let coverError = $state('');
	let pendingDelete = $state<string | null>(null);
	let pendingIds = $state<string[]>([]);
	let deleting = $state(false);
	let deleteError = $state('');
	let pageError = $state('');
	let renaming = $state<{ id: string; name: string } | null>(null);
	let creating = $state(false);
	let albumName = $state('');
	let nameError = $state('');
	let creatingBusy = $state(false);
	let albumSource: {
		query: string;
		rating: string[];
		media: string[];
		sort: string;
	} | null = null;
	let pendingAlbumId: string | null = null;
	const selectionKey = 'saved';
	let selection = $derived(selectionSnapshot(selectionKey));
	let selecting = $derived(selection.active);

	let visible = $derived.by(() => {
		const needle = filter.trim().toLowerCase();
		return data.savedSearches.filter((search) => {
			const nameMatches = search.name.toLowerCase().includes(needle);
			const typeMatches = typeFilter === 'All' || typeLabel(search.type) === typeFilter;
			return nameMatches && typeMatches;
		});
	});
	let visibleIds = $derived(visible.map((search) => search.id));
	let editing = $derived(data.savedSearches.find((search) => search.id === editingId) ?? null);
	let deletingSearch = $derived(
		data.savedSearches.find((search) => search.id === pendingDelete) ?? null
	);
	let previewKey = $derived(
		data.savedSearches
			.map((search) => `${search.id}:${search.query}:${search.updatedAt}`)
			.join('\n')
	);

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

	function loadPending() {
		const controller = new AbortController();
		for (const search of data.savedSearches) {
			void loadPreview(search.id, search.query, search.rating, controller.signal);
		}
		return () => controller.abort();
	}

	function typeLabel(type: string) {
		if (type === 'artist') return 'Artist';
		if (type === 'character') return 'Character';
		return 'Search';
	}

	function closeType(event: MouseEvent) {
		const target = event.target instanceof Element ? event.target : null;
		if (target?.closest('.popup, [aria-haspopup="true"]')) return;
		typeOpen = false;
	}

	function onWindowKey(event: KeyboardEvent) {
		if (editingText(event.target) || document.querySelector('dialog[open]')) return;
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
		if (event.key !== 'Escape') return;
		if (selecting) {
			event.preventDefault();
			leaveSelection(selectionKey);
			return;
		}
		if (!typeOpen) return;
		event.preventDefault();
		typeOpen = false;
	}

	function onCardClick(event: MouseEvent, id: string) {
		if (event.shiftKey || event.metaKey || event.ctrlKey || selecting) {
			event.preventDefault();
			galleryClick(selectionKey, id, visibleIds, event);
			return;
		}
		void openSearch(id);
	}

	function toggleType(event: MouseEvent) {
		if (typeOpen) {
			typeOpen = false;
			return;
		}
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		typeBox = {
			left: Math.max(10, Math.min(rect.left, window.innerWidth - 242)),
			top: rect.bottom + 8
		};
		typeOpen = true;
	}

	function chooseType(mode: TypeFilter) {
		typeFilter = mode;
		typeOpen = false;
	}

	async function loadPreview(id: string, query: string, ratings: string[], signal: AbortSignal) {
		try {
			const response = await fetch('/api/source/gelbooru/search', {
				method: 'POST',
				signal,
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					query,
					ratings: ratings.map((rating) => rating.toLowerCase())
				})
			});
			if (!response.ok) {
				previews[id] = [];
				return;
			}
			const body = (await response.json()) as {
				data?: { posts?: { id: string; tags?: string[]; mediaRef?: string }[] };
			};
			if (signal.aborted) return;
			const picks: CoverPick[] = [];
			for (const post of body.data?.posts ?? []) {
				if (!post.id || picks.some((item) => item.itemId === post.id)) continue;
				picks.push({
					itemId: post.id,
					src: post.mediaRef ? `/api/media/${post.mediaRef}?recipe=thumb` : null,
					available: Boolean(post.mediaRef),
					tags: post.tags ?? []
				});
			}
			previews[id] = picks;
		} catch {
			if (!signal.aborted) previews[id] = [];
		}
	}

	async function openSearch(id: string) {
		pageError = '';
		const response = await fetch(`/api/library/saved-searches/${encodeURIComponent(id)}/open`, {
			method: 'POST'
		});
		const body = (await response.json().catch(() => null)) as {
			data?: {
				exploration?: { query: string; rating: string[]; media: string[]; sort: string };
			};
			message?: string;
		} | null;
		const exploration = body?.data?.exploration;
		if (!response.ok || !exploration) {
			pageError = body?.message ?? 'Saved search could not be opened';
			return;
		}
		commitNavigation(newView(navigation, exploration.query));
		const opened = activeView();
		navigation.views = navigation.views.map((view) =>
			view.id === opened.id
				? {
						...view,
						applied: {
							query: exploration.query,
							rating: exploration.rating,
							media: exploration.media,
							sort: exploration.sort
						}
					}
				: view
		);
		const loaded = await fetch('/api/source/gelbooru/search', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				query: exploration.query,
				ratings: exploration.rating.map((rating) => rating.toLowerCase())
			})
		});
		if (loaded.ok) {
			const payload = (await loaded.json()) as {
				data?: {
					posts?: {
						id: string;
						width: number;
						height: number;
						tags: string[];
						mediaRef: string;
						rating?: string;
						kind?: 'image' | 'video';
						mediaType?: string;
					}[];
				};
			};
			storePosts(payload.data?.posts ?? []);
		}
		await goto(resolve('/'));
	}

	function editorSlots(searchId: string, cover: (typeof data.savedSearches)[number]['cover']) {
		const remote = previews[searchId] ?? [];
		return fanSlots(cover, remote).map((slot) => {
			if (!slot) return null;
			return remote.find((item) => item.itemId === slot.itemId) ?? { ...slot, tags: [] };
		});
	}

	function onCardMenu(event: MouseEvent, search: (typeof data.savedSearches)[number]) {
		openContextMenu(
			event,
			[
				{ id: 'open', label: 'Open', icon: 'search' },
				{ id: 'rename', label: 'Rename', icon: 'artist' },
				{ id: 'cover', label: 'Edit cover', icon: 'image' },
				{ id: 'search', label: 'Type: Search', icon: 'search' },
				{ id: 'artist', label: 'Type: Artist', icon: 'artist' },
				{ id: 'character', label: 'Type: Character', icon: 'saved' },
				{ id: 'create-album', label: 'Create album', icon: 'book-image' },
				{ id: 'delete', label: 'Delete', icon: 'trash', danger: true, separator: true }
			],
			(action) => {
				if (action === 'open') void openSearch(search.id);
				else if (action === 'rename') renaming = { id: search.id, name: search.name };
				else if (action === 'cover') startCover(search.id);
				else if (action === 'search' || action === 'artist' || action === 'character') {
					void updateSearch(search.id, { type: action });
				} else if (action === 'create-album') startAlbum(search);
				else if (action === 'delete') askDelete(search.id);
			}
		);
	}

	async function updateSearch(id: string, body: { name?: string; type?: string }) {
		const response = await fetch(`/api/library/saved-searches/${encodeURIComponent(id)}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!response.ok) {
			pageError = 'Saved search could not be updated';
			return;
		}
		renaming = null;
		await invalidateAll();
	}

	function saveRename(event: SubmitEvent) {
		event.preventDefault();
		if (!renaming) return;
		const name = renaming.name.trim();
		if (!name) return;
		void updateSearch(renaming.id, { name });
	}

	function startAlbum(search: (typeof data.savedSearches)[number]) {
		albumName = '';
		nameError = '';
		pendingAlbumId = null;
		albumSource = {
			query: search.query,
			rating: [...search.rating],
			media: [...search.media],
			sort: search.sort
		};
		creating = true;
	}

	function stopAlbum(event?: Event) {
		event?.preventDefault();
		if (creatingBusy) return;
		creating = false;
		albumSource = null;
		pendingAlbumId = null;
		nameError = '';
	}

	async function createAlbum(event: SubmitEvent) {
		event.preventDefault();
		const source = albumSource;
		const name = albumName.trim();
		if (!name) {
			nameError = 'Enter a title.';
			return;
		}
		if (!source) return;
		creatingBusy = true;
		nameError = '';
		try {
			let albumId = pendingAlbumId;
			if (!albumId) {
				const response = await fetch('/api/library/albums', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ name })
				});
				const body = (await response.json().catch(() => null)) as {
					data?: { id?: string };
					message?: string;
				} | null;
				albumId = body?.data?.id ?? null;
				if (!response.ok || !albumId) {
					nameError = body?.message ?? 'Album could not be created';
					return;
				}
				pendingAlbumId = albumId;
				playAdd();
			}
			const imported = await fetch('/api/library/imports', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					operation: 'add',
					destination: 'album',
					albumId,
					source: 'saved-search',
					query: source.query,
					rating: source.rating,
					media: source.media,
					sort: source.sort
				})
			});
			if (!imported.ok) return;
			creating = false;
			albumSource = null;
			pendingAlbumId = null;
		} finally {
			creatingBusy = false;
		}
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
			const response = await fetch(
				`/api/library/saved-searches/${encodeURIComponent(editingId)}/cover`,
				{
					method: 'PUT',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ slots })
				}
			);
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

	function askDelete(id: string) {
		deleteError = '';
		pendingIds = [id];
		pendingDelete = id;
	}

	function deleteSelection() {
		const ids = selectedIds(selectionKey, visibleIds);
		if (ids.length === 0) return;
		deleteError = '';
		pendingIds = ids;
		pendingDelete = ids[0] ?? null;
	}

	function stopDelete(event?: Event) {
		event?.preventDefault();
		if (deleting) return;
		pendingDelete = null;
		pendingIds = [];
		deleteError = '';
	}

	async function confirmDelete() {
		const ids = pendingIds.length > 0 ? pendingIds : pendingDelete ? [pendingDelete] : [];
		if (ids.length === 0) return;
		deleting = true;
		deleteError = '';
		try {
			const results = await Promise.all(
				ids.map((id) =>
					fetch(`/api/library/saved-searches/${encodeURIComponent(id)}`, { method: 'DELETE' })
				)
			);
			if (results.some((response) => !response.ok)) {
				deleteError = 'Saved search could not be deleted';
				return;
			}
			forgetIds(
				selectionKey,
				ids.filter((_, index) => results[index]?.ok)
			);
			pendingDelete = null;
			pendingIds = [];
			await invalidateAll();
		} finally {
			deleting = false;
		}
	}
</script>

<svelte:window onclick={closeType} onkeydown={onWindowKey} />

{#snippet toolbar()}
	<div class="selection-bar" data-selection-bar hidden={!selecting}>
		<button
			type="button"
			class="icon-btn"
			data-action="exit-selection"
			aria-label="Exit selection"
			onclick={() => leaveSelection(selectionKey)}
		>
			<Icon name="x" />
		</button>
		<input
			data-action="select-all"
			type="checkbox"
			aria-label="Select all"
			checked={selection.allQuery && selection.excluded === 0}
			onchange={() => selectLoaded(selectionKey, visibleIds)}
		/>
		<span class="selection-count">{selectedIds(selectionKey, visibleIds).length} selected</span>
		<button
			type="button"
			class="selection-clear"
			data-action="deselect-all"
			onclick={() => clearSelection(selectionKey)}
		>
			Deselect all
		</button>
		<button type="button" class="icon-btn" aria-label="Delete saved searches" onclick={() => deleteSelection()}>
			<Icon name="trash" />
		</button>
	</div>
	<div class="grid-tools" hidden={selecting}>
	<Icon name="search" />
	<input
		class="grid-search"
		type="search"
		placeholder="Search saved searches…"
		aria-label="Saved search"
		bind:value={filter}
	/>
	<div class="menu-anchor">
		<button
			type="button"
			class="icon-btn"
			title="Filter saved search type"
			aria-label="Filter saved search type"
			aria-expanded={typeOpen}
			aria-haspopup="true"
			onclick={toggleType}
		>
			<Icon name="sliders" />
		</button>
		{#if typeOpen}
			<div class="popup" style:left="{typeBox.left}px" style:top="{typeBox.top}px">
				<h3>Type</h3>
				{#each typeFilters as mode (mode)}
					<button
						type="button"
						class="menu-item"
						aria-pressed={typeFilter === mode}
						onclick={() => chooseType(mode)}
					>
						{#if typeFilter === mode}<Icon name="check" />{/if}
						{mode}
					</button>
				{/each}
			</div>
		{/if}
	</div>
	</div>
{/snippet}

<main class="collection" {@attach watchScroll}>
	{#key previewKey}
		<span class="preview-loader" {@attach loadPending}></span>
	{/key}
	<div class="page-heading">
		<h1>Saved searches</h1>
	</div>
	{#if pageError}
		<p class="notice" role="alert">{pageError}</p>
	{/if}
	{#if data.savedSearches.length === 0}
		<div class="empty">
			<Icon name="saved" --icon-size="38px" />
			<h2>No saved searches yet.</h2>
			<p>Save an applied search using the bookmark button beside the search field.</p>
		</div>
	{:else if visible.length === 0}
		<div class="empty">
			<Icon name="saved" --icon-size="38px" />
			<h2>No results</h2>
		</div>
	{:else}
		<div class="album-grid">
			{#each visible as search (search.id)}
				<article
					class={[
						'album-card',
						isSelected(selectionKey, search.id) && 'selected',
						{ 'drop-target': false }
					]}
					data-kind="saved-search"
					data-collection={search.id}
					oncontextmenu={(event) => onCardMenu(event, search)}
				>
					<span class="selection-badge" aria-hidden="true"><Icon name="check" /></span>
					<button type="button" class="card-hit" onclick={(event) => onCardClick(event, search.id)}>
						{@render coverFan(fanSlots(search.cover, previews[search.id] ?? []))}
						<div class="album-name" title={search.name}>{search.name}</div>
						<div class="album-count">{typeLabel(search.type)}</div>
					</button>
					<div class="card-actions">
						<button
							type="button"
							class="icon-btn"
							aria-label="Edit cover for {search.name}"
							title="Edit cover"
							onclick={() => startCover(search.id)}
						>
							<Icon name="image" />
						</button>
						<button
							type="button"
							class="icon-btn"
							aria-label="Delete {search.name}"
							title="Delete"
							onclick={() => askDelete(search.id)}
						>
							<Icon name="trash" />
						</button>
					</div>
				</article>
			{/each}
		</div>
	{/if}
</main>

{#if editing}
	<CoverEditor
		slots={editorSlots(editing.id, editing.cover)}
		candidates={previews[editing.id] ?? []}
		searchPlaceholder="Find images by tag…"
		saving={savingCover}
		error={coverError}
		onsave={saveCover}
		oncancel={stopCover}
	/>
{/if}

{#if creating}
	<dialog
		aria-labelledby="create-album-title"
		{@attach (node) => {
			node.showModal();
			return () => {
				if (node.open) node.close();
			};
		}}
		oncancel={stopAlbum}
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
				<button type="button" disabled={creatingBusy} onclick={() => stopAlbum()}>Cancel</button>
				<button type="submit" class="primary" disabled={creatingBusy}>Create</button>
			</div>
		</form>
	</dialog>
{/if}

{#if deletingSearch}
	<dialog
		aria-labelledby="delete-search-title"
		{@attach (node) => {
			node.showModal();
			return () => {
				if (node.open) node.close();
			};
		}}
		oncancel={stopDelete}
	>
		<h2 id="delete-search-title">Delete this saved search?</h2>
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

{#if renaming}
	<dialog
		aria-labelledby="rename-search-title"
		{@attach (node) => {
			node.showModal();
			return () => {
				if (node.open) node.close();
			};
		}}
		onclose={() => (renaming = null)}
	>
		<form onsubmit={saveRename}>
			<h2 id="rename-search-title">Rename saved search</h2>
			<label>
				Name
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

	.preview-loader {
		display: none;
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

	.preview-loader {
		display: none;
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
	}

	.album-name {
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

	.empty p {
		max-width: 360px;
		margin: 0;
		color: #717a8b;
		text-align: center;
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
