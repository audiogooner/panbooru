<script module lang="ts">
	export type CoverFace = {
		itemId: string;
		src: string | null;
		available: boolean;
	};

	export type CoverPick = CoverFace & {
		tags: string[];
	};

	export type CoverRecord = {
		saved: boolean;
		fallback: 'first-items' | null;
		fallbackSource: 'album-membership' | 'applied-query' | null;
		primaryIndex: 0;
		slots: Array<CoverFace | null>;
		firstItems: CoverFace[];
	};

	/** Slot 0 is the large primary. Slots 1–3 are supports, left to right. */
	export function fanSlots(cover: CoverRecord, remote: CoverFace[] = []): Array<CoverFace | null> {
		if (cover.saved || cover.fallback === null) {
			return [0, 1, 2, 3].map((index) => cover.slots[index] ?? null);
		}
		const source = cover.fallbackSource === 'applied-query' ? remote : cover.firstItems;
		const unique: CoverFace[] = [];
		for (const item of source) {
			if (!item?.itemId || unique.some((entry) => entry.itemId === item.itemId)) continue;
			unique.push(item);
			if (unique.length === 4) break;
		}
		return [0, 1, 2, 3].map((index) => unique[index] ?? null);
	}

	export { coverFan };
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import Icon from '#lib/Icon.svelte';

	type Props = {
		slots: Array<CoverPick | null>;
		candidates: CoverPick[];
		searchPlaceholder?: string;
		saving?: boolean;
		error?: string;
		onsave: (slots: Array<string | null>) => void;
		oncancel: () => void;
	};

	let {
		slots,
		candidates,
		searchPlaceholder = 'Find album images by tag…',
		saving = false,
		error = '',
		onsave,
		oncancel
	}: Props = $props();

	let draft = $state<Array<CoverPick | null>>(
		untrack(() => [0, 1, 2, 3].map((index) => (slots[index] ? { ...slots[index] } : null)))
	);
	let query = $state('');
	let overSlot = $state<number | null>(null);
	let dragging = { itemId: '', from: null as number | null };

	let visible = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return candidates;
		return candidates.filter((item) => item.tags.some((tag) => tag.toLowerCase().includes(needle)));
	});
	let slotIds = $derived(draft.map((slot) => slot?.itemId ?? null));
	let canSave = $derived.by(() => {
		if (saving) return false;
		const ids = slotIds.filter((id): id is string => id !== null);
		if (ids.length === 0) return false;
		return ids.every((id, index) => ids.indexOf(id) === index);
	});

	function discard(event?: Event) {
		event?.preventDefault();
		if (saving) return;
		oncancel();
	}

	function save() {
		if (!canSave) return;
		onsave(slotIds);
	}

	function allow(event: DragEvent, index: number) {
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		overSlot = index;
	}

	function leave(event: DragEvent, index: number) {
		const next = event.relatedTarget;
		if (
			next instanceof Node &&
			event.currentTarget instanceof Node &&
			event.currentTarget.contains(next)
		) {
			return;
		}
		if (overSlot === index) overSlot = null;
	}

	function startSlot(event: DragEvent, index: number) {
		const item = draft[index];
		if (!item) return;
		dragging = { itemId: item.itemId, from: index };
		event.dataTransfer?.setData('text/plain', item.itemId);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
	}

	function startCandidate(event: DragEvent, item: CoverPick) {
		dragging = { itemId: item.itemId, from: null };
		event.dataTransfer?.setData('text/plain', item.itemId);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copyMove';
	}

	function drop(event: DragEvent, to: number) {
		event.preventDefault();
		const payload = dragging;
		overSlot = null;
		dragging = { itemId: '', from: null };
		if (!payload.itemId) return;
		const from = payload.from ?? draft.findIndex((slot) => slot?.itemId === payload.itemId);
		if (from === to) return;
		const next = [...draft];
		if (from >= 0) {
			const moved = next[from] ?? null;
			next[from] = next[to] ?? null;
			next[to] = moved;
		} else {
			const candidate = candidates.find((item) => item.itemId === payload.itemId);
			if (!candidate) return;
			next[to] = candidate;
		}
		draft = next;
	}

	function placeCandidate(item: CoverPick) {
		if (draft.some((slot) => slot?.itemId === item.itemId)) return;
		const next = [...draft];
		const empty = next.findIndex((slot) => slot === null);
		next[empty >= 0 ? empty : 3] = item;
		draft = next;
	}

	function labelFor(item: CoverPick) {
		const name = item.tags.slice(0, 3).join(', ');
		return name || 'Cover image';
	}
</script>

{#snippet sheet(item: CoverFace | null, className: string)}
	{#if item?.src}
		<img class={className} src={item.src} alt="" draggable="false" />
	{:else}
		<div class={['missing', className]}>
			<Icon name="image" />
		</div>
	{/if}
{/snippet}

{#snippet coverFan(slots: Array<CoverFace | null>)}
	{@const supports = [slots[1], slots[2], slots[3]].filter((slot) => slot !== null)}
	<div class="fan" aria-hidden="true">
		{#if slots.every((slot) => slot === null)}
			<div class="empty-cover">
				<Icon name="image" --icon-size="38px" />
			</div>
		{:else}
			{#each [...supports].reverse() as support, index (`${support.itemId}:${index}`)}
				{@const layer = supports.length - index}
				{@render sheet(support, `sheet layer-${layer}`)}
			{/each}
			{@render sheet(slots[0] ?? null, 'sheet primary-cover')}
		{/if}
	</div>
{/snippet}

<dialog
	class="cover-dialog"
	aria-labelledby="cover-editor-title"
	{@attach (node) => {
		node.showModal();
		return () => {
			if (node.open) node.close();
		};
	}}
	oncancel={discard}
>
	<h2 id="cover-editor-title">Edit cover</h2>
	<div
		class={{ 'cover-main': true, 'drag-over': overSlot === 0 }}
		role="group"
		aria-label="Primary cover"
		data-cover-slot="0"
		ondragover={(event) => allow(event, 0)}
		ondragleave={(event) => leave(event, 0)}
		ondrop={(event) => drop(event, 0)}
	>
		{#if draft[0]?.src}
			<img src={draft[0].src} alt="Primary cover" draggable="false" />
		{:else}
			<Icon name="image" --icon-size="38px" />
		{/if}
	</div>
	<div class="cover-support">
		{#each [1, 2, 3] as index (index)}
			{@const item = draft[index]}
			<div
				class={{ 'support-slot': true, 'drag-over': overSlot === index }}
				role="group"
				data-cover-slot={index}
				aria-label={item ? `Supporting image ${index}` : `Empty supporting image ${index}`}
				ondragover={(event) => allow(event, index)}
				ondragleave={(event) => leave(event, index)}
				ondrop={(event) => drop(event, index)}
			>
				{#if item}
					<button
						type="button"
						class="support"
						draggable="true"
						aria-label="Supporting image {index}"
						ondragstart={(event) => startSlot(event, index)}
						ondragend={() => (overSlot = null)}
					>
						{#if item.src}
							<img src={item.src} alt="" draggable="false" />
						{:else}
							<Icon name="image" />
						{/if}
					</button>
				{:else}
					<Icon name="image" />
				{/if}
			</div>
		{/each}
	</div>
	<input
		type="text"
		placeholder={searchPlaceholder}
		aria-label="Find cover images by tag"
		bind:value={query}
	/>
	<div class="cover-candidates">
		{#each visible as item (item.itemId)}
			<button
				type="button"
				class="candidate"
				draggable="true"
				aria-label={labelFor(item)}
				ondragstart={(event) => startCandidate(event, item)}
				ondragend={() => (overSlot = null)}
				onclick={() => placeCandidate(item)}
			>
				{#if item.src}
					<img src={item.src} alt="" draggable="false" />
				{:else}
					<Icon name="image" />
				{/if}
			</button>
		{/each}
	</div>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	<div class="dialog-actions">
		<button type="button" onclick={() => discard()}>Cancel</button>
		<button type="button" class="primary" disabled={!canSave} onclick={save}>
			{saving ? 'Saving…' : 'Save'}
		</button>
	</div>
</dialog>

<style>
	.cover-dialog {
		width: min(480px, 90vw);
	}

	.cover-main {
		display: grid;
		place-items: center;
		width: 170px;
		height: 185px;
		margin: 0 auto 20px;
		overflow: hidden;
		border-radius: 12px;
		background: #191e27;
		color: #535e73;
	}

	.cover-main img {
		width: 100%;
		height: 100%;
		max-width: none;
		object-fit: cover;
	}

	.cover-main.drag-over {
		outline: 2px solid #a9c8ee;
		outline-offset: 5px;
	}

	.cover-support {
		display: flex;
		justify-content: center;
		gap: 10px;
		margin-bottom: 20px;
	}

	.support-slot {
		display: grid;
		place-items: center;
		width: 76px;
		height: 84px;
		overflow: hidden;
		border-radius: 8px;
		background: #191e27;
		color: #535e73;
	}

	.support-slot.drag-over {
		outline: 2px solid #afc8f2;
	}

	.support {
		display: grid;
		place-items: center;
		width: 100%;
		height: 100%;
		padding: 0;
		border: 0;
		border-radius: 8px;
		background: #191e27;
		color: #535e73;
		cursor: grab;
	}

	.support img,
	.candidate img {
		width: 100%;
		height: 100%;
		max-width: none;
		object-fit: cover;
	}

	.cover-candidates {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 6px;
		max-height: 130px;
		margin-top: 12px;
		overflow: auto;
	}

	.candidate {
		display: grid;
		place-items: center;
		width: 100%;
		height: 65px;
		padding: 0;
		overflow: hidden;
		border: 0;
		border-radius: 5px;
		background: #191e27;
		color: #535e73;
		cursor: grab;
	}

	.error {
		margin: 12px 0 0;
		color: #ef9ba7;
	}

	.fan {
		position: relative;
		width: 150px;
		height: 180px;
		margin: 0 auto 19px;
	}

	.sheet {
		position: absolute;
		bottom: 0;
		left: 3px;
		width: 145px;
		height: 165px;
		max-width: none;
		object-fit: cover;
		border-radius: 14px;
		background: #191e27;
		box-shadow: 0 3px 12px #0004;
		transform-origin: 50% 85%;
		transition: transform 0.25s cubic-bezier(0.2, 0.7, 0.2, 1);
	}

	.missing {
		display: grid;
		place-items: center;
		color: #535e73;
		background: #191e27;
	}

	.layer-3 {
		z-index: 1;
		transform: translateY(-7px) rotate(6deg);
	}

	.layer-2 {
		z-index: 2;
		transform: translateY(-5px) rotate(4deg);
	}

	.layer-1 {
		z-index: 3;
		transform: translateY(-3px) rotate(2deg);
	}

	.primary-cover {
		z-index: 4;
	}

	:global(.album-card:hover) .layer-3,
	:global(.album-card:focus-within) .layer-3 {
		transform: translateY(-14px) rotate(9deg);
	}

	:global(.album-card:hover) .layer-2,
	:global(.album-card:focus-within) .layer-2 {
		transform: translateY(-10px) rotate(6deg);
	}

	:global(.album-card:hover) .layer-1,
	:global(.album-card:focus-within) .layer-1 {
		transform: translateY(-5px) rotate(3deg);
	}

	.empty-cover {
		position: absolute;
		bottom: 0;
		left: 3px;
		display: grid;
		place-items: center;
		width: 145px;
		height: 165px;
		border-radius: 14px;
		background: #191e27;
		color: #535e73;
	}

	@media (prefers-reduced-motion: reduce) {
		.sheet {
			transition: none;
		}
	}
</style>
