<script lang="ts">
	import { untrack } from 'svelte';
	import Icon from '#lib/Icon.svelte';
	import type { IconName } from '#lib/Icon.svelte';
	import { getShell } from '../routes/+layout.svelte';

	const ratingChoices = ['General', 'Sensitive', 'Questionable', 'Explicit'] as const;
	const mediaChoices = ['Images', 'Animated images', 'Videos'] as const;
	const sortChoices = ['Newest', 'Oldest', 'Highest score', 'Random'] as const;
	const ratingByLetter: Record<string, Rating> = {
		g: 'General',
		s: 'Sensitive',
		q: 'Questionable',
		e: 'Explicit'
	};
	const categories = new Set([
		'artist',
		'character',
		'copyright',
		'metadata',
		'general',
		'deprecated'
	]);

	type Rating = (typeof ratingChoices)[number];
	type Media = (typeof mediaChoices)[number];
	type Sort = (typeof sortChoices)[number];
	type Menu = 'rating' | 'sort' | 'media' | 'options';
	type Suggestion = { name: string; count: number; category?: string };
	type Filters = { rating: string[]; media: string[]; sort: string };
	type BookmarkLabel = 'Save search' | 'Save artist' | 'Save character';

	let {
		initial,
		suggestions,
		oninput,
		onsearch,
		applied,
		saved = false,
		bookmarkLabel = 'Save search' as BookmarkLabel,
		selecting = false,
		selectedCount = 0,
		allQuery = false,
		rowHeight,
		onchrome,
		onrowheight,
		onbookmark = () => {},
		onexitselection = () => {},
		onselectall = () => {},
		ondeselect = () => {},
		onalbum = () => {},
		onfavorite = () => {},
		ondownload = () => {},
		onremove
	}: {
		initial: string;
		suggestions: Suggestion[];
		oninput: (value: string) => void;
		onsearch: (value: string, filters?: Filters) => void;
		applied?: { rating?: readonly string[]; media?: readonly string[]; sort?: string };
		saved?: boolean;
		bookmarkLabel?: BookmarkLabel;
		selecting?: boolean;
		selectedCount?: number;
		allQuery?: boolean;
		onremove?: () => void;
		rowHeight?: number;
		onchrome?: (state: { focused: boolean; popover: boolean }) => void;
		onrowheight?: (value: number) => void;
		/** Wave 3 saves or deletes the applied search. */
		onbookmark?: () => void;
		/** Wave 3 leaves multi-select and clears the selection. */
		onexitselection?: () => void;
		/** Wave 3 selects the loaded query. */
		onselectall?: () => void;
		/** Wave 3 clears the selection and keeps multi-select open. */
		ondeselect?: () => void;
		/** Opens the album picker for the selection. The anchor is the toolbar button. */
		onalbum?: (anchor: HTMLElement | null) => void;
		/** Wave 3 favorites or unfavorites the selection. */
		onfavorite?: () => void;
		/** Wave 3 downloads the selection. */
		ondownload?: () => void;
	} = $props();

	function listed<T extends string>(choices: readonly T[], selected: readonly string[] | undefined) {
		const chosen = choices.filter((item) => selected?.includes(item));
		if (!selected || chosen.length === 0 || chosen.length === choices.length) return [...choices];
		return chosen;
	}

	let draft = $state(untrack(() => initial));
	let draftRating = $state<Rating[]>(untrack(() => listed(ratingChoices, applied?.rating)));
	let draftMedia = $state<Media[]>(untrack(() => listed(mediaChoices, applied?.media)));
	let draftSort = $state<Sort>(
		untrack(() => sortChoices.find((item) => item === applied?.sort) ?? 'Newest')
	);
	let internalRow = $state(190);
	let fieldFocused = $state(false);
	let suggestDismissed = $state(false);
	let suggestIndex = $state(-1);
	let menu = $state<Menu | null>(null);
	let menuAnchor: HTMLElement | null = null;
	let shellEl: HTMLElement | null = null;
	let inputEl: HTMLInputElement | null = null;
	let popoverEl: HTMLElement | null = null;

	let row = $derived(rowHeight ?? internalRow);
	let appliedRating = $derived(listed(ratingChoices, applied?.rating));
	let appliedMedia = $derived(listed(mediaChoices, applied?.media));
	let appliedSort = $derived(sortChoices.find((item) => item === applied?.sort) ?? 'Newest');
	let dirty = $derived(
		draft.trim() !== initial.trim() ||
			draftRating.join('\0') !== appliedRating.join('\0') ||
			draftMedia.join('\0') !== appliedMedia.join('\0') ||
			draftSort !== appliedSort
	);
	let suggestOpen = $derived(
		fieldFocused && !suggestDismissed && suggestions.length > 0 && menu === null
	);
	let highlighted = $derived(
		suggestIndex < 0 ? -1 : Math.min(suggestIndex, suggestions.length - 1)
	);
	let sortIcon = $derived<IconName>(
		draftSort === 'Random'
			? 'shuffle'
			: draftSort === 'Oldest'
				? 'up'
				: draftSort === 'Highest score'
					? 'star'
					: 'sort'
	);
	let mediaIcon = $derived<IconName>(
		draftMedia.length === 1 && draftMedia[0] === 'Videos'
			? 'film'
			: draftMedia.length === 1 && draftMedia[0] === 'Animated images'
				? 'animate'
				: 'image'
	);

	const shell = getShell();

	function revealToolbar() {
		shell.hidden = false;
	}

	function reportChrome() {
		onchrome?.({ focused: fieldFocused, popover: menu !== null || selecting });
	}

	function setMenu(next: Menu | null, anchor: HTMLElement | null = null) {
		menu = next;
		menuAnchor = anchor;
		if (next) revealToolbar();
		reportChrome();
	}

	function absorbRatingTokens(value: string, ratings: Rating[]) {
		if (!/(^|\s)rating:[gsqe](?=\s)/i.test(value)) return { value, ratings };
		let next = [...ratings];
		const replaced = value.replace(
			/(^|\s)rating:([gsqe])(?=\s)/gi,
			(full, lead: string, letter: string) => {
				const choice = ratingByLetter[letter.toLowerCase()];
				if (!choice) return full;
				if (next.length === ratingChoices.length) next = [choice];
				else if (!next.includes(choice)) next = [...next, choice];
				return lead;
			}
		);
		return {
			value: replaced.replace(/[ \t]{2,}/g, ' ').replace(/^ /, ''),
			ratings: listed(ratingChoices, next)
		};
	}

	function onDraft() {
		const absorbed = absorbRatingTokens(draft, draftRating);
		draft = absorbed.value;
		draftRating = absorbed.ratings;
		suggestIndex = -1;
		suggestDismissed = false;
		oninput(draft);
	}

	function toggle(next: Menu, anchor: HTMLElement) {
		if (menu === next) {
			setMenu(null);
			return;
		}
		suggestDismissed = true;
		setMenu(next, anchor);
	}

	function closeMenus() {
		setMenu(null);
		suggestDismissed = true;
		suggestIndex = -1;
	}

	function submit(event?: Event) {
		event?.preventDefault();
		closeMenus();
		onsearch(draft, { rating: draftRating, media: draftMedia, sort: draftSort });
	}

	function insert(suggestion: Suggestion | undefined) {
		if (!suggestion || !inputEl) return;
		const pos = inputEl.selectionStart ?? draft.length;
		const start = Math.max(0, draft.slice(0, pos).search(/\S*$/));
		const rest = draft.slice(pos).match(/^\S*/);
		const end = pos + (rest?.[0].length ?? 0);
		const negative = draft[start] === '-';
		const name = suggestion.name;
		draft =
			draft.slice(0, start) +
			(negative ? '-' : '') +
			name +
			' ' +
			draft.slice(end).replace(/^ /, '');
		const caret = start + (negative ? 1 : 0) + name.length + 1;
		suggestDismissed = true;
		suggestIndex = -1;
		setMenu(null);
		oninput(draft);
		queueMicrotask(() => {
			inputEl?.focus();
			inputEl?.setSelectionRange(caret, caret);
		});
	}

	function onkeydown(event: KeyboardEvent) {
		if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && suggestOpen) {
			event.preventDefault();
			const delta = event.key === 'ArrowDown' ? 1 : -1;
			suggestIndex = Math.max(0, Math.min(suggestions.length - 1, suggestIndex + delta));
			return;
		}
		if (event.key === 'Tab' && suggestOpen) {
			event.preventDefault();
			insert(suggestions[Math.max(0, highlighted)]);
			return;
		}
		if (event.key === 'Enter' && suggestOpen && highlighted >= 0) {
			event.preventDefault();
			insert(suggestions[highlighted]);
			return;
		}
		if (event.key === 'Escape' && (menu || suggestOpen)) {
			event.preventDefault();
			closeMenus();
		}
	}

	function onWindowKey(event: KeyboardEvent) {
		if (event.key !== 'Escape' || (!menu && !suggestOpen)) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		closeMenus();
	}

	function onWindowClick(event: MouseEvent) {
		if (!menu && !suggestOpen) return;
		const target = event.target;
		if (!(target instanceof Node)) return;
		if (popoverEl?.contains(target)) return;
		if (menuAnchor?.contains(target)) return;
		if (!menu && shellEl?.contains(target)) return;
		closeMenus();
	}

	function captureShell(node: HTMLElement) {
		shellEl = node;
		return () => {
			if (shellEl === node) shellEl = null;
		};
	}

	function captureInput(node: HTMLInputElement) {
		inputEl = node;
		return () => {
			if (inputEl === node) inputEl = null;
		};
	}

	function capturePopover(node: HTMLElement) {
		popoverEl = node;
		position(node);
		return () => {
			if (popoverEl === node) popoverEl = null;
		};
	}

	function syncRow() {
		if (rowHeight !== undefined) return;
		try {
			const value = Number(localStorage.getItem('panbooru-row-height'));
			if (!Number.isFinite(value)) return;
			internalRow = Math.min(300, Math.max(110, Math.round(value)));
		} catch {
			// Preference storage is unavailable in this browser context.
		}
	}

	function toggleChoice<T extends string>(
		choices: readonly T[],
		selected: T[],
		choice: T
	): T[] {
		const next = selected.includes(choice)
			? selected.filter((item) => item !== choice)
			: [...selected, choice];
		return listed(choices, next);
	}

	function commitRow(value: number) {
		const next = Math.min(300, Math.max(110, Math.round(value)));
		internalRow = next;
		if (onrowheight) {
			onrowheight(next);
			return;
		}
		document.documentElement.style.setProperty('--row', `${next}px`);
		try {
			localStorage.setItem('panbooru-row-height', String(next));
		} catch {
			// Preference storage is unavailable in this browser context.
		}
	}

	function position(node: HTMLElement) {
		const anchor = menu ? menuAnchor : shellEl;
		if (!anchor) return;
		const rect = anchor.getBoundingClientRect();
		const width = node.offsetWidth;
		const height = node.offsetHeight;
		const left = Math.max(10, Math.min(rect.left, window.innerWidth - width - 12));
		const below = rect.bottom + 8;
		const top =
			below + height + 12 > window.innerHeight ? Math.max(10, rect.top - height - 8) : below;
		node.style.left = `${left}px`;
		node.style.top = `${top}px`;
		const origin = Math.max(0, Math.min(width, rect.left + rect.width / 2 - left));
		node.style.transformOrigin = `${origin}px top`;
	}

	const markSelectAll = $derived.by(() => {
		const whole = allQuery;
		const count = selectedCount;
		return (node: HTMLInputElement) => {
			node.indeterminate = !whole && count > 0;
			node.checked = whole;
		};
	});

	function categoryClass(category: string | undefined) {
		return category && categories.has(category) ? category : 'general';
	}

	function keepFocus(event: MouseEvent) {
		event.preventDefault();
	}
</script>

<svelte:window onkeydown={onWindowKey} onclick={onWindowClick} />

<div class="search-toolbar" {@attach syncRow}>
	<div class="selection-bar" data-selection-bar hidden={!selecting}>
		<button
			type="button"
			class="icon-btn"
			data-action="exit-selection"
			title="Exit selection · Escape"
			aria-label="Exit selection"
			onclick={onexitselection}
		>
			<Icon name="x" />
		</button>
		<input
			data-action="select-all"
			type="checkbox"
			aria-label="Select all"
			checked={allQuery}
			{@attach markSelectAll}
			onchange={() => onselectall()}
		/>
		<span class="selection-count">
			{allQuery ? `All matching · ${selectedCount} selected` : `${selectedCount} selected`}
		</span>
		<button
			type="button"
			class="selection-clear"
			data-action="deselect-all"
			title="Deselect all · Ctrl/Cmd+Shift+A"
			onclick={ondeselect}
		>
			Deselect all
		</button>
		<button
			type="button"
			class="icon-btn"
			data-action="add-album"
			title="Add to album"
			aria-label="Add to album"
			onclick={(event) =>
				onalbum(event.currentTarget instanceof HTMLElement ? event.currentTarget : null)}
		>
			<Icon name="book-image" />
		</button>
		<button
			type="button"
			class="icon-btn"
			data-action="favorite"
			title="Favorite / unfavorite"
			aria-label="Favorite / unfavorite"
			onclick={onfavorite}
		>
			<Icon name="heart" />
		</button>
		<button
			type="button"
			class="icon-btn"
			data-action="download"
			title="Download originals"
			aria-label="Download originals"
			onclick={ondownload}
		>
			<Icon name="download" />
		</button>
		{#if onremove}
			<button
				type="button"
				class="icon-btn"
				data-action="remove"
				title="Remove from collection"
				aria-label="Remove from collection"
				onclick={onremove}
			>
				<Icon name="trash" />
			</button>
		{/if}
	</div>

	<div class="search-row" hidden={selecting}>
		<button
			type="button"
			class={['icon-btn', saved && 'saved']}
			data-action="save-search"
			aria-pressed={saved}
			aria-label={bookmarkLabel}
			title={bookmarkLabel}
			onclick={onbookmark}
		>
			<Icon name="saved" />
		</button>
		<form class="search-form" onsubmit={submit}>
			<div class="search-field-shell" {@attach captureShell}>
				<input
					name="tags"
					{@attach captureInput}
					bind:value={draft}
					aria-label="Tags"
					placeholder="Search tags…"
					autocomplete="off"
					spellcheck="false"
					aria-autocomplete="list"
					aria-expanded={suggestOpen}
					aria-controls={suggestOpen ? 'search-suggestions' : undefined}
					oninput={onDraft}
					onkeydown={onkeydown}
					onfocus={() => {
						fieldFocused = true;
						revealToolbar();
						reportChrome();
					}}
					onblur={() => {
						fieldFocused = false;
						reportChrome();
					}}
				/>
				<div class="embedded-filters">
					<button
						type="button"
						class="icon-btn"
						data-filter="rating"
						title={draftRating.join(', ')}
						aria-label="Rating"
						aria-expanded={menu === 'rating'}
						onmousedown={keepFocus}
						onclick={(event) => toggle('rating', event.currentTarget)}
					>
						<Icon name="rating" />
						{#if draftRating.length > 1}
							<span class="badge">{draftRating.length}</span>
						{/if}
					</button>
					<button
						type="button"
						class="icon-btn"
						data-filter="sort"
						title={draftSort}
						aria-label="Sort"
						aria-expanded={menu === 'sort'}
						onmousedown={keepFocus}
						onclick={(event) => toggle('sort', event.currentTarget)}
					>
						<Icon name={sortIcon} />
					</button>
					<button
						type="button"
						class="icon-btn"
						data-filter="media"
						title={draftMedia.join(', ')}
						aria-label="Media type"
						aria-expanded={menu === 'media'}
						onmousedown={keepFocus}
						onclick={(event) => toggle('media', event.currentTarget)}
					>
						<Icon name={mediaIcon} />
						{#if draftMedia.length > 1}
							<span class="badge">{draftMedia.length}</span>
						{/if}
					</button>
				</div>
			</div>
			<button type="submit" class={['search-submit', dirty && 'dirty']}>Search</button>
		</form>
		<span class="gallery-options-separator" aria-hidden="true"></span>
		<button
			type="button"
			class="icon-btn"
			data-gallery-options
			title="Gallery options"
			aria-label="Gallery options"
			aria-expanded={menu === 'options'}
			onmousedown={keepFocus}
			onclick={(event) => toggle('options', event.currentTarget)}
		>
			<Icon name="sliders" />
		</button>
	</div>

	{#if !selecting && (menu || suggestOpen)}
		{#key menu ?? 'suggest'}
		<div
			id="search-popover"
			class={['popup', !menu && 'suggestions']}
			role={menu ? 'dialog' : 'listbox'}
			aria-label={menu === 'rating'
				? 'Rating'
				: menu === 'sort'
					? 'Sorting'
					: menu === 'media'
						? 'Media type'
						: menu === 'options'
							? 'Gallery options'
							: 'Tag suggestions'}
			{@attach capturePopover}
		>
			{#if menu === 'rating'}
				<h3>Rating</h3>
				{#each ratingChoices as choice (choice)}
					<label>
						<input
							type="checkbox"
							checked={draftRating.includes(choice)}
							onchange={() => (draftRating = toggleChoice(ratingChoices, draftRating, choice))}
						/>
						{choice}
					</label>
				{/each}
			{:else if menu === 'sort'}
				<h3>Sorting</h3>
				{#each sortChoices as choice (choice)}
					<label>
						<input
							type="radio"
							name="sort"
							checked={draftSort === choice}
							onchange={() => (draftSort = choice)}
						/>
						{choice}
					</label>
				{/each}
			{:else if menu === 'media'}
				<h3>Media type</h3>
				{#each mediaChoices as choice (choice)}
					<label>
						<input
							type="checkbox"
							checked={draftMedia.includes(choice)}
							onchange={() => (draftMedia = toggleChoice(mediaChoices, draftMedia, choice))}
						/>
						{choice}
					</label>
				{/each}
			{:else if menu === 'options'}
				<h3>Thumbnail size</h3>
				<input
					class="row-range"
					type="range"
					min="110"
					max="300"
					value={row}
					aria-label="Thumbnail size"
					oninput={(event) => commitRow(Number(event.currentTarget.value))}
				/>
				<p class="muted">Layout only · shared across galleries</p>
			{:else}
				<ul id="search-suggestions">
					{#each suggestions as suggestion, index (suggestion.name)}
						<li>
							<button
								type="button"
								class={['menu-item', 'suggestion', index === highlighted && 'active']}
								role="option"
								aria-selected={index === highlighted}
								onmousedown={keepFocus}
								onclick={() => insert(suggestion)}
							>
								<span class={categoryClass(suggestion.category)}
									>{suggestion.name.replaceAll('_', ' ')}</span
								>
								<small>{suggestion.count.toLocaleString()}</small>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
		{/key}
	{/if}
</div>

<style>
	.search-toolbar,
	.search-row,
	.search-form,
	.selection-bar {
		display: flex;
		flex: 1;
		align-items: center;
		gap: 7px;
		min-width: 0;
	}

	.search-toolbar {
		width: 100%;
	}

	.search-form {
		margin: 0;
		padding: 0;
		border: 0;
		background: transparent;
	}

	.icon-btn,
	.search-submit,
	.selection-clear {
		font-weight: 500;
	}

	.icon-btn {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		position: relative;
		width: 38px;
		height: 38px;
		min-width: 38px;
		padding: 0;
		border: 1px solid #2b2f39;
		border-radius: 10px;
		background: #191c23;
		color: #b1b7c3;
	}

	.icon-btn:hover {
		background: #282e39;
		color: #fff;
	}

	.icon-btn.saved {
		border-color: #2b2f39;
		background: #2a354c;
		color: #b4c5fa;
	}

	.icon-btn.saved:hover {
		background: #33415d;
		color: #b4c5fa;
	}

	.icon-btn.saved :global(svg) {
		fill: #b4c5fa33;
	}

	.search-field-shell {
		display: flex;
		flex: 1;
		align-items: center;
		min-width: 0;
		height: 38px;
		padding-right: 5px;
		border: 1px solid #2a2d36;
		border-radius: 11px;
		background: #17191f;
	}

	.search-field-shell:focus-within {
		border-color: #788eaf;
	}

	.search-field-shell input {
		flex: 1;
		min-width: 0;
		height: 36px;
		padding: 0 8px 0 12px;
		border: 0;
		outline: none;
		background: transparent;
		box-shadow: none;
		color: inherit;
	}

	.embedded-filters {
		display: flex;
		flex: none;
		align-items: center;
		gap: 2px;
		padding-left: 7px;
		border-left: 1px solid #30353f;
	}

	.embedded-filters .icon-btn {
		width: auto;
		height: 28px;
		min-width: 32px;
		padding: 0 7px;
		border: 0;
		border-radius: 7px;
		background: transparent;
		color: #949fb3;
	}

	.embedded-filters .icon-btn:hover,
	.embedded-filters .icon-btn:focus-visible {
		background: #2b3342;
		color: #e2eaf8;
	}

	.badge {
		position: absolute;
		top: -1px;
		right: 0;
		padding: 0 3px;
		border-radius: 6px;
		background: #353e50;
		color: #d8e0ed;
		font-size: 8px;
		line-height: 12px;
	}

	.search-submit {
		flex: none;
		height: 38px;
		padding: 0 17px;
		border: 1px solid #343842;
		border-radius: 10px;
		background: #20232b;
		color: #a3a8b5;
	}

	.search-submit.dirty {
		border-color: #baa8f5;
		background: #baa8f5;
		color: #20172e;
	}

	.search-submit:hover {
		background: #282e39;
		color: #fff;
	}

	.search-submit.dirty:hover {
		border-color: #baa8f5;
		background: #baa8f5;
		color: #20172e;
	}

	.gallery-options-separator {
		flex: none;
		width: 1px;
		height: 20px;
		margin: 0 5px;
		background: #343943;
	}

	.selection-count {
		flex: 1;
		font-size: 13px;
	}

	.selection-bar input {
		flex: none;
		width: 17px;
		height: 17px;
		margin: 0;
		padding: 0;
	}

	.selection-clear {
		padding: 7px 10px;
		border: 0;
		border-radius: 7px;
		background: transparent;
		color: #a6b2c5;
		white-space: nowrap;
	}

	.selection-clear:hover {
		background: #252c38;
		color: #e4eaf4;
	}

	.popup {
		flex: none;
		width: max-content;
		transform-origin: top left;
		animation: reveal 140ms ease;
	}

	.popup ul {
		display: grid;
		gap: 0;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.popup input[type='checkbox'],
	.popup input[type='radio'] {
		flex: none;
		width: 16px;
		height: 16px;
		margin: 0;
		padding: 0;
	}

	.row-range {
		width: 100%;
		height: 24px;
		margin: 4px 0 2px;
		accent-color: #bcc9e4;
	}

	.muted {
		margin: 0;
	}

	@keyframes reveal {
		from {
			opacity: 0;
			transform: translateY(-4px) scale(0.96);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.popup {
			animation: none;
		}
	}
</style>
