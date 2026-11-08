<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import {
		applyAlbumChoice,
		createAlbumRequest,
		importRequest,
		loadAlbumChoices,
		submitImport,
		type DragPost
	} from '#lib/selection.svelte.ts';
	import { playAdd, playRemove } from '#lib/sounds.ts';

	let {
		posts,
		anchor = null,
		whole = false,
		selectionKey = '',
		onclose,
		oncreated
	}: {
		posts: DragPost[];
		anchor?: HTMLElement | null;
		whole?: boolean;
		selectionKey?: string;
		onclose?: () => void;
		oncreated?: () => void;
	} = $props();

	let albums = $state<{ id: string; name: string }[]>([]);
	let memberships = $state<{ albumId: string; itemId: string }[]>([]);
	let title = $state('');
	let createError = $state('');
	let busy = $state(false);

	let postKey = $derived(posts.map((post) => post.remoteId || post.itemId).join('\n'));

	function place(node: HTMLElement) {
		const padding = 12;
		const gap = 8;
		const width = node.offsetWidth;
		const height = node.offsetHeight;
		const rect = anchor?.getBoundingClientRect();
		const preferredLeft = rect?.left ?? 80;
		const preferredTop = (rect?.bottom ?? 64) + gap;
		const left = Math.max(padding, Math.min(preferredLeft, window.innerWidth - width - padding));
		const top =
			preferredTop + height + padding > window.innerHeight
				? Math.max(padding, (rect?.top ?? preferredTop) - height - gap)
				: preferredTop;
		node.style.left = `${left}px`;
		node.style.top = `${top}px`;
	}

	function loadAlbums(node: HTMLElement) {
		place(node);
		const key = postKey;
		const controller = new AbortController();
		void refresh(key, controller.signal).then(() => {
			if (!controller.signal.aborted) place(node);
		});
		return () => controller.abort();
	}

	async function refresh(key: string, signal: AbortSignal) {
		const loaded = await loadAlbumChoices(whole ? [] : posts, signal);
		if (!loaded || signal.aborted || key !== postKey) return;
		albums = loaded.albums;
		memberships = loaded.memberships;
	}

	function countIn(albumId: string) {
		const ids = new Set(
			memberships.filter((item) => item.albumId === albumId).map((item) => item.itemId)
		);
		return ids.size;
	}

	async function toggle(albumId: string) {
		if (busy || whole) return;
		busy = true;
		createError = '';
		try {
			const result = await applyAlbumChoice(albumId, posts, memberships);
			if (result === 'add') playAdd();
			else if (result === 'remove') playRemove();
			else if (result === 'failed') createError = 'Album could not be updated';
			await refresh(postKey, new AbortController().signal);
			await invalidateAll();
		} finally {
			busy = false;
		}
	}

	async function addQuery(albumId: string) {
		if (!whole || busy || !selectionKey) return;
		const body = importRequest(selectionKey, { operation: 'add', destination: 'album', albumId });
		if (!body) return;
		busy = true;
		createError = '';
		try {
			const ok = await submitImport(body);
			if (!ok) {
				createError = 'Album could not be updated';
				return;
			}
			playAdd();
			onclose?.();
			await invalidateAll();
		} finally {
			busy = false;
		}
	}

	async function createAlbum() {
		if (busy) return;
		const created = await createAlbumRequest(title);
		if (!('id' in created)) {
			createError = created.message;
			return;
		}
		const albumId = created.id;
		if (!albumId) {
			createError = 'Album could not be created';
			return;
		}
		title = '';
		createError = '';
		if (whole) await addQuery(albumId);
		else await toggle(albumId);
		oncreated?.();
	}

	function onPointer(event: PointerEvent) {
		const target = event.target;
		if (!(target instanceof Element)) return;
		if (target.closest('.album-picker, [data-album-picker], [data-action="add-album"]')) return;
		onclose?.();
	}

	function onKey(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		onclose?.();
	}
</script>

<svelte:window onpointerdown={onPointer} onkeydown={onKey} />

<div class="popup album-picker" data-album-picker-panel {@attach loadAlbums}>
	<h3>{whole ? 'Add matching posts' : 'Albums'}</h3>
	{#each albums as album (album.id)}
		{@const count = countIn(album.id)}
		{@const complete = count === posts.length && posts.length > 0}
		{@const partial = count > 0 && count < posts.length}
		{#if whole}
			<button type="button" class="menu-item" onclick={() => void addQuery(album.id)}>
				{album.name}
			</button>
		{:else}
			<label>
				<input
					type="checkbox"
					checked={complete}
					onchange={() => void toggle(album.id)}
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
			void createAlbum();
		}}
	>
		<input
			bind:value={title}
			aria-label="New album title"
			placeholder="New album"
			maxlength="80"
		/>
		<button type="submit">Create</button>
	</form>
	{#if createError}<p class="error">{createError}</p>{/if}
</div>

<style>
	.album-picker {
		display: grid;
		gap: 2px;
		min-width: 220px;
	}

	form {
		display: flex;
		gap: 6px;
		margin-top: 8px;
	}

	form input {
		flex: 1;
		min-width: 0;
		padding: 6px 8px;
		border: 1px solid #343842;
		border-radius: 7px;
		background: #15181e;
		color: inherit;
	}

	form button {
		padding: 6px 10px;
		border-radius: 7px;
		background: #2a3344;
		color: inherit;
	}

	.error {
		margin: 4px;
		color: #ef9ba7;
	}
</style>
