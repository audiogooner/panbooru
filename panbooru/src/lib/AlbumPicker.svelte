<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { DragPost } from '#lib/selection.svelte.ts';

	type AlbumChoice = { id: string; name: string };
	type Membership = { albumId: string; itemId: string };

	let {
		posts,
		oncreated
	}: {
		posts: DragPost[];
		oncreated?: () => void;
	} = $props();

	let albums = $state<AlbumChoice[]>([]);
	let memberships = $state<Membership[]>([]);
	let title = $state('');
	let createError = $state('');
	let busy = $state(false);

	let postKey = $derived(posts.map((post) => post.remoteId || post.itemId).join('\n'));

	function loadAlbums(node: HTMLElement) {
		void node;
		const key = postKey;
		const controller = new AbortController();
		void refresh(key, controller.signal);
		return () => controller.abort();
	}

	async function refresh(key: string, signal: AbortSignal) {
		const list = await fetch('/api/library/albums', { signal });
		if (!list.ok || signal.aborted || key !== postKey) return;
		const body = (await list.json()) as { data?: { albums?: AlbumChoice[] } };
		albums = body.data?.albums ?? [];
		const found: Membership[] = [];
		await Promise.all(
			posts.map(async (post) => {
				const params = new URLSearchParams();
				if (post.itemId && !post.mediaRef) params.set('itemId', post.itemId);
				else if (post.remoteId) params.set('remoteId', post.remoteId);
				else return;
				const response = await fetch(`/api/library/albums/membership?${params}`, { signal });
				if (!response.ok || signal.aborted) return;
				const payload = (await response.json()) as { data?: { memberships?: Membership[] } };
				found.push(...(payload.data?.memberships ?? []));
			})
		);
		if (!signal.aborted && key === postKey) memberships = found;
	}

	function countIn(albumId: string) {
		const ids = new Set(
			memberships.filter((item) => item.albumId === albumId).map((item) => item.itemId)
		);
		return ids.size;
	}

	function payload(post: DragPost) {
		if (post.itemId && !post.mediaRef) return { itemId: post.itemId };
		return {
			remoteId: post.remoteId,
			tags: post.tags,
			width: post.width,
			height: post.height,
			...(post.mediaRef ? { mediaRef: post.mediaRef } : {}),
			...(post.rating ? { rating: post.rating } : {})
		};
	}

	async function toggle(albumId: string) {
		if (busy) return;
		busy = true;
		try {
			const present = countIn(albumId);
			if (present === posts.length && posts.length > 0) {
				const rows = memberships.filter((item) => item.albumId === albumId);
				await Promise.all(
					rows.map((row) =>
						fetch(
							`/api/library/albums/${encodeURIComponent(albumId)}/items/${encodeURIComponent(row.itemId)}`,
							{ method: 'DELETE' }
						)
					)
				);
			} else {
				await Promise.all(
					posts.map((post) =>
						fetch(`/api/library/albums/${encodeURIComponent(albumId)}/items`, {
							method: 'POST',
							headers: { 'content-type': 'application/json' },
							body: JSON.stringify(payload(post))
						})
					)
				);
			}
			await refresh(postKey, new AbortController().signal);
			await invalidateAll();
		} finally {
			busy = false;
		}
	}

	async function createAlbum() {
		const name = title.trim();
		if (!name) {
			createError = 'Enter a title.';
			return;
		}
		busy = true;
		createError = '';
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
				createError = body?.message ?? 'Album could not be created';
				return;
			}
			title = '';
			await toggle(body.data.id);
			oncreated?.();
		} finally {
			busy = false;
		}
	}
</script>

<div class="picker" {@attach loadAlbums}>
	{#each albums as album (album.id)}
		{@const count = countIn(album.id)}
		{@const whole = count === posts.length && posts.length > 0}
		{@const partial = count > 0 && count < posts.length}
		<label>
			<input
				type="checkbox"
				checked={whole}
				onchange={() => toggle(album.id)}
				{@attach (node) => {
					node.indeterminate = partial;
					node.checked = whole;
				}}
			/>
			{album.name}
		</label>
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
	.picker {
		display: grid;
		gap: 2px;
		min-width: 220px;
	}

	label {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 4px;
	}

	form {
		display: flex;
		gap: 6px;
		margin-top: 8px;
	}

	input[type='checkbox'] {
		width: 16px;
		height: 16px;
		margin: 0;
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

	.muted,
	.error {
		margin: 4px;
		color: #8d98ac;
	}

	.error {
		color: #ef9ba7;
	}
</style>
