<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { INTERFACE_SOUNDS_KEY, interfaceSoundsEnabled } from '../../lib/sounds';
	import { bindShellToolbar, getShell, ROW_HEIGHT_KEY } from '../+layout.svelte';
	import type { PageProps } from './$types';

	const UNAVAILABLE_KEY = 'Master key is unavailable';
	const SHORTCUTS_KEY = 'panbooru-shortcuts';
	const MIN_WIDTH_KEY = 'panbooru-viewer-min-width';
	const MIN_HEIGHT_KEY = 'panbooru-viewer-min-height';
	const PRELOAD_KEY = 'panbooru-preload-count';
	const ROW_MIN = 110;
	const ROW_MAX = 300;
	const ROW_DEFAULT = 190;

	type Chord = { key: string; mod: boolean; shift: boolean; alt: boolean };

	const sections = [
		{ id: 'appearance', label: 'Appearance' },
		{ id: 'gallery', label: 'Gallery' },
		{ id: 'viewer', label: 'Viewer' },
		{ id: 'playback', label: 'Playback' },
		{ id: 'downloads', label: 'Downloads' },
		{ id: 'shortcuts', label: 'Keyboard shortcuts' },
		{ id: 'gelbooru', label: 'Gelbooru connection' }
	] as const;

	const shortcutDefaults: { id: string; label: string; detail: string; chords: Chord[] }[] = [
		{
			id: 'new-search',
			label: 'New search',
			detail: 'Create an exploration view and load default results',
			chords: [chord('t')]
		},
		{
			id: 'reopen',
			label: 'Reopen closed view',
			detail: 'Reopen the last closed view or temporary album',
			chords: [chord('t', { shift: true })]
		},
		{
			id: 'close',
			label: 'Close view',
			detail: 'Close the active view or collection context',
			chords: [chord('w', { shift: true })]
		},
		{
			id: 'previous',
			label: 'Previous image',
			detail: 'Previous image, including while zoomed',
			chords: [chord('ArrowLeft'), chord('a')]
		},
		{
			id: 'next',
			label: 'Next image',
			detail: 'Next image, including while zoomed',
			chords: [chord('ArrowRight'), chord('d')]
		},
		{
			id: 'fullscreen',
			label: 'Fullscreen',
			detail: 'Toggle viewer fullscreen',
			chords: [chord('f')]
		},
		{
			id: 'details',
			label: 'Details',
			detail: 'Toggle the right details sidebar',
			chords: [chord('i')]
		},
		{
			id: 'favorite',
			label: 'Favorite',
			detail: 'Toggle favorite membership',
			chords: [chord('w')]
		},
		{
			id: 'album',
			label: 'Album picker',
			detail: 'Toggle the album picker',
			chords: [chord('s')]
		},
		{
			id: 'play',
			label: 'Play or pause',
			detail: 'Video playback',
			chords: [chord(' ')]
		},
		{
			id: 'seek',
			label: 'Seek video',
			detail: 'Backward or forward 10 seconds',
			chords: [chord('j'), chord('l')]
		},
		{
			id: 'select-all',
			label: 'Select all',
			detail: 'Select the current query, including results not loaded yet',
			chords: [chord('a', { mod: true })]
		},
		{
			id: 'deselect',
			label: 'Deselect all',
			detail: 'Clear the selection and keep multi-select open',
			chords: [chord('a', { mod: true, shift: true })]
		},
		{
			id: 'remove',
			label: 'Remove from collection',
			detail: 'Album or Favorites selection, or the open image. Not available while exploring',
			chords: [chord('Backspace', { mod: true })]
		},
		{
			id: 'undo',
			label: 'Undo removal',
			detail: 'Restore the last removal during its hold. Text fields keep their own undo',
			chords: [chord('z', { mod: true })]
		},
		{
			id: 'dismiss',
			label: 'Dismiss',
			detail: 'Dismiss the topmost layer',
			chords: [chord('Escape')]
		}
	];

	const keyLabels: Record<string, string> = {
		ArrowLeft: 'Left',
		ArrowRight: 'Right',
		ArrowUp: 'Up',
		ArrowDown: 'Down',
		' ': 'Space',
		Escape: 'Escape',
		Backspace: 'Backspace',
		Enter: 'Enter',
		Tab: 'Tab',
		Delete: 'Delete'
	};
	const bareModifiers = new Set(['Shift', 'Control', 'Meta', 'Alt', 'OS', 'Dead', 'Process']);

	let { data }: PageProps = $props();

	let shell: ReturnType<typeof getShell> | null;
	try {
		shell = getShell();
	} catch {
		shell = null;
	}
	if (shell) {
		shell.settings = true;
		bindShellToolbar(toolbar);
	}

	let userId = $state(untrack(() => data.userId));
	let apiKey = $state('');
	let visible = $state(false);
	let saved = $state(untrack(() => data.configured));
	let error = $state('');
	let validating = false;
	let acceptCredentialProbe = true;

	let rowHeight = $state(ROW_DEFAULT);
	let minWidth = $state(1920);
	let minHeight = $state(1080);
	let preload = $state(3);
	let interfaceSounds = $state(true);
	let overrides = $state<Record<string, Chord[]>>({});
	let preferenceNotice = $state<'saved' | ''>('');
	let preferenceError = $state('');
	let activeId = $state('appearance');
	let capturing = $state<string | null>(null);
	let conflict = $state<{ id: string; other: string } | null>(null);

	let jumpTarget: string | null = null;
	let jumpTimer = 0;
	let noticeTimer = 0;
	let captureCleanup: (() => void) | null = null;
	let rowWriteOk = true;

	function chord(
		key: string,
		flags: { mod?: boolean; shift?: boolean; alt?: boolean } = {}
	): Chord {
		return {
			key,
			mod: flags.mod ?? false,
			shift: flags.shift ?? false,
			alt: flags.alt ?? false
		};
	}

	function chordKey(value: Chord) {
		return `${value.mod ? 1 : 0}${value.alt ? 1 : 0}${value.shift ? 1 : 0}:${value.key}`;
	}

	function isChord(value: unknown): value is Chord {
		if (!value || typeof value !== 'object') return false;
		const candidate = value as Chord;
		return (
			typeof candidate.key === 'string' &&
			candidate.key.length > 0 &&
			candidate.key.length < 32 &&
			typeof candidate.mod === 'boolean' &&
			typeof candidate.shift === 'boolean' &&
			typeof candidate.alt === 'boolean'
		);
	}

	function clamp(value: number, min: number, max: number) {
		if (!Number.isFinite(value)) return min;
		return Math.min(max, Math.max(min, Math.round(value)));
	}

	function readClamped(key: string, fallback: number, min: number, max: number) {
		try {
			const raw = localStorage.getItem(key);
			if (raw === null || raw === '') return fallback;
			return clamp(Number(raw), min, max);
		} catch {
			return fallback;
		}
	}

	function writeLocal(key: string, value: string) {
		try {
			localStorage.setItem(key, value);
			preferenceError = '';
			return true;
		} catch {
			preferenceNotice = '';
			preferenceError = 'Could not save this preference.';
			return false;
		}
	}

	function flashSaved() {
		preferenceError = '';
		preferenceNotice = 'saved';
		window.clearTimeout(noticeTimer);
		noticeTimer = window.setTimeout(() => {
			if (preferenceNotice === 'saved') preferenceNotice = '';
		}, 1600);
	}

	function readOverrides() {
		try {
			const raw = localStorage.getItem(SHORTCUTS_KEY);
			if (!raw) return {};
			const parsed = JSON.parse(raw) as unknown;
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
			const next: Record<string, Chord[]> = {};
			for (const [id, value] of Object.entries(parsed)) {
				if (!shortcutDefaults.some((item) => item.id === id)) continue;
				if (!Array.isArray(value) || !value.every(isChord)) continue;
				next[id] = value;
			}
			return next;
		} catch {
			return {};
		}
	}

	function defaultChords(id: string) {
		return shortcutDefaults.find((item) => item.id === id)?.chords ?? [];
	}

	function currentChords(id: string) {
		if (Object.hasOwn(overrides, id)) return overrides[id];
		return defaultChords(id);
	}

	function sameChords(left: Chord[], right: Chord[]) {
		return (
			left.length === right.length &&
			left.every((item, index) => chordKey(item) === chordKey(right[index]))
		);
	}

	function formatChord(value: Chord) {
		const parts: string[] = [];
		if (value.mod) parts.push('Cmd/Ctrl');
		if (value.alt) parts.push('Alt');
		if (value.shift) parts.push('Shift');
		const label =
			keyLabels[value.key] ?? (value.key.length === 1 ? value.key.toUpperCase() : value.key);
		parts.push(label);
		return parts.join('+');
	}

	function formatChords(values: Chord[]) {
		if (values.length === 0) return 'Unassigned';
		return values.map(formatChord).join(' / ');
	}

	function shortcutLabel(id: string) {
		return shortcutDefaults.find((item) => item.id === id)?.label ?? 'another action';
	}

	function saveOverrides(next: Record<string, Chord[]>) {
		overrides = next;
		try {
			if (Object.keys(next).length === 0) localStorage.removeItem(SHORTCUTS_KEY);
			else localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(next));
			flashSaved();
		} catch {
			preferenceNotice = '';
			preferenceError = 'Could not save this preference.';
		}
	}

	function findConflict(id: string, value: Chord) {
		const needle = chordKey(value);
		for (const shortcut of shortcutDefaults) {
			if (shortcut.id === id) continue;
			if (currentChords(shortcut.id).some((item) => chordKey(item) === needle)) return shortcut.id;
		}
		return null;
	}

	function assignShortcut(id: string, value: Chord) {
		const other = findConflict(id, value);
		if (other) {
			conflict = { id, other };
			return;
		}
		conflict = null;
		const chords = [value];
		const next = { ...overrides };
		if (sameChords(chords, defaultChords(id))) delete next[id];
		else next[id] = chords;
		saveOverrides(next);
	}

	function clearShortcut(id: string) {
		stopCapture();
		conflict = null;
		saveOverrides({ ...overrides, [id]: [] });
	}

	function resetShortcut(id: string) {
		stopCapture();
		conflict = null;
		const next = { ...overrides };
		delete next[id];
		saveOverrides(next);
	}

	function stopCapture() {
		captureCleanup?.();
		captureCleanup = null;
		capturing = null;
	}

	function chordFromEvent(event: KeyboardEvent): Chord {
		return chord(event.key.length === 1 ? event.key.toLowerCase() : event.key, {
			mod: event.metaKey || event.ctrlKey,
			shift: event.shiftKey,
			alt: event.altKey
		});
	}

	function beginCapture(id: string) {
		stopCapture();
		capturing = id;
		conflict = null;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.repeat) return;
			if (bareModifiers.has(event.key)) return;
			event.preventDefault();
			event.stopPropagation();
			if (event.key === 'Escape') {
				stopCapture();
				return;
			}
			const next = chordFromEvent(event);
			stopCapture();
			assignShortcut(id, next);
		};
		const onPointerDown = (event: Event) => {
			const target = event.target;
			if (target instanceof Element && target.closest(`[data-capture="${id}"]`)) return;
			stopCapture();
		};
		window.addEventListener('keydown', onKeyDown, true);
		window.addEventListener('pointerdown', onPointerDown, true);
		captureCleanup = () => {
			window.removeEventListener('keydown', onKeyDown, true);
			window.removeEventListener('pointerdown', onPointerDown, true);
		};
	}

	function sectionAtTop(scroller: HTMLElement) {
		const found = [...scroller.querySelectorAll<HTMLElement>('.settings-section')];
		if (found.length === 0) return sections[0].id;
		const overflows = scroller.scrollHeight - scroller.clientHeight > 2;
		const atBottom =
			overflows && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
		if (atBottom) return found[found.length - 1]?.id ?? sections[0].id;
		const edge = scroller.getBoundingClientRect().top + 36;
		let current = found[0]?.id ?? sections[0].id;
		for (const section of found) {
			if (section.getBoundingClientRect().top <= edge) current = section.id;
		}
		return current;
	}

	function jumpTo(id: string, event: MouseEvent) {
		event.preventDefault();
		jumpTarget = id;
		activeId = id;
		const section = document.getElementById(id);
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		section?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
		window.clearTimeout(jumpTimer);
		jumpTimer = window.setTimeout(
			() => {
				jumpTarget = null;
			},
			reduce ? 50 : 900
		);
	}

	function attachNav(node: HTMLElement) {
		const place = () => {
			const link = node.querySelector<HTMLElement>(`a[data-section="${activeId}"]`);
			if (!link) return;
			node.style.setProperty('--indicator-y', `${link.offsetTop - 7}px`);
			node.style.setProperty('--indicator-h', `${link.offsetHeight}px`);
		};
		place();
		const observer = new ResizeObserver(place);
		observer.observe(node);
		return () => observer.disconnect();
	}

	function attachScroll() {
		const scroller = document.getElementById('scroll');
		if (!scroller) return;
		const onScroll = () => {
			if (jumpTarget) return;
			const next = sectionAtTop(scroller);
			if (next !== activeId) activeId = next;
		};
		const onScrollEnd = () => {
			if (!jumpTarget) return;
			jumpTarget = null;
			onScroll();
		};
		scroller.addEventListener('scroll', onScroll, { passive: true });
		scroller.addEventListener('scrollend', onScrollEnd);
		return () => {
			scroller.removeEventListener('scroll', onScroll);
			scroller.removeEventListener('scrollend', onScrollEnd);
		};
	}

	function setInterfaceSounds(enabled: boolean, input: HTMLInputElement) {
		if (!writeLocal(INTERFACE_SOUNDS_KEY, enabled ? '1' : '0')) {
			input.checked = interfaceSounds;
			return;
		}
		interfaceSounds = enabled;
		flashSaved();
	}

	function setRowHeight(raw: string) {
		rowHeight = clamp(Number(raw), ROW_MIN, ROW_MAX);
		rowWriteOk = writeLocal(ROW_HEIGHT_KEY, String(rowHeight));
	}

	function commitNumber(
		key: string,
		value: number,
		min: number,
		max: number,
		apply: (next: number) => void
	) {
		const next = clamp(value, min, max);
		apply(next);
		if (writeLocal(key, String(next))) flashSaved();
	}

	function onKeyInput(value: string) {
		apiKey = value;
		if (!apiKey) visible = false;
	}

	async function loadGelbooruState() {
		try {
			const response = await fetch('/api/settings/gelbooru');
			if (!response.ok || !acceptCredentialProbe) return;
			const body = (await response.json()) as { data?: { unavailable?: boolean } };
			if (acceptCredentialProbe && body.data?.unavailable) error = UNAVAILABLE_KEY;
		} catch {
			// Validate still reports a missing master key.
		}
	}

	async function validate() {
		if (validating) return;
		validating = true;
		acceptCredentialProbe = false;
		error = '';
		try {
			const response = await fetch('/api/settings/gelbooru/validate', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ userId, apiKey })
			});
			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as { message?: string } | null;
				error = body?.message || 'Validation failed';
				return;
			}
			apiKey = '';
			visible = false;
			saved = true;
			error = '';
		} catch {
			error = 'Validation failed';
		} finally {
			validating = false;
		}
	}

	async function logout() {
		await fetch('/api/auth/logout', { method: 'POST' });
		window.location.href = '/login';
	}

	onMount(() => {
		rowHeight = readClamped(ROW_HEIGHT_KEY, ROW_DEFAULT, ROW_MIN, ROW_MAX);
		minWidth = readClamped(MIN_WIDTH_KEY, 1920, 0, 20000);
		minHeight = readClamped(MIN_HEIGHT_KEY, 1080, 0, 20000);
		preload = readClamped(PRELOAD_KEY, 3, 0, 20);
		interfaceSounds = interfaceSoundsEnabled();
		overrides = readOverrides();
		void loadGelbooruState();
	});

	onDestroy(() => {
		clearTimeout(jumpTimer);
		clearTimeout(noticeTimer);
		captureCleanup?.();
	});
</script>

{#snippet toolbar()}
	<h1 class="settings-header-title">Settings</h1>
	{#if preferenceNotice === 'saved'}
		<span class="saved-indicator" role="status">Saved</span>
	{/if}
	{#if preferenceError}
		<span class="save-error">{preferenceError}</span>
	{/if}
{/snippet}

<main class="settings-page" {@attach attachScroll}>
	<nav class="settings-nav" aria-label="Settings sections" {@attach attachNav}>
		<span class="settings-nav-indicator" aria-hidden="true"></span>
		{#each sections as section (section.id)}
			<a
				href="#{section.id}"
				data-section={section.id}
				class={{ active: activeId === section.id }}
				aria-current={activeId === section.id ? 'true' : undefined}
				onclick={(event) => jumpTo(section.id, event)}
			>
				{section.label}
			</a>
		{/each}
	</nav>

	{#each sections as section (section.id)}
		<section class="settings-section" id={section.id}>
			<h2>{section.label}</h2>
			{#if section.id === 'appearance'}
				<p class="note">
					Near-black gallery. The viewer backdrop is a blurred, dimmed rendition of the current
					image.
				</p>
			{:else if section.id === 'gallery'}
				<div class="setting-row">
					<label for="row-height">
						Thumbnail size
						<small>Shared across galleries</small>
					</label>
					<input
						id="row-height"
						type="range"
						min={ROW_MIN}
						max={ROW_MAX}
						value={rowHeight}
						oninput={(event) => setRowHeight(event.currentTarget.value)}
						onchange={() => {
							if (rowWriteOk) flashSaved();
						}}
					/>
				</div>
			{:else if section.id === 'viewer'}
				<div class="setting-row">
					<label for="min-width">
						Enlarge from width
						<small>Source pixels. Width or height can qualify the image</small>
					</label>
					<input
						id="min-width"
						type="number"
						min="0"
						bind:value={minWidth}
						onchange={() =>
							commitNumber(MIN_WIDTH_KEY, minWidth, 0, 20000, (next) => (minWidth = next))}
					/>
				</div>
				<div class="setting-row">
					<label for="min-height">
						Enlarge from height
						<small>Source pixels</small>
					</label>
					<input
						id="min-height"
						type="number"
						min="0"
						bind:value={minHeight}
						onchange={() =>
							commitNumber(MIN_HEIGHT_KEY, minHeight, 0, 20000, (next) => (minHeight = next))}
					/>
				</div>
				<div class="setting-row">
					<label for="preload-count">
						Image preload count
						<small>Neighboring full-size images. Videos preload the poster only</small>
					</label>
					<input
						id="preload-count"
						type="number"
						min="0"
						max="20"
						bind:value={preload}
						onchange={() => commitNumber(PRELOAD_KEY, preload, 0, 20, (next) => (preload = next))}
					/>
				</div>
			{:else if section.id === 'playback'}
				<p class="note">
					Videos play on first open, with sound unless they were muted, and loop at the end. Volume
					and mute stay with the player. A playback position lasts for this browsing session.
				</p>
				<div class="setting-row">
					<label for="interface-sounds">
						Interface sounds
						<small>Separate from video volume and mute</small>
					</label>
					<input
						id="interface-sounds"
						type="checkbox"
						checked={interfaceSounds}
						onchange={(event) =>
							setInterfaceSounds(event.currentTarget.checked, event.currentTarget)}
					/>
				</div>
			{:else if section.id === 'downloads'}
				<p class="note">
					Saving one image downloads the original file and stays on this page. A selection of
					originals downloads as one ZIP.
				</p>
			{:else if section.id === 'shortcuts'}
				<p class="note">
					Switching views has no shortcut, so Ctrl+Tab keeps moving between browser tabs. Click a
					binding, then press the new combination. Escape cancels.
				</p>
				{#each shortcutDefaults as shortcut (shortcut.id)}
					{@const chords = currentChords(shortcut.id)}
					<div
						class={{
							'setting-row': true,
							conflict: conflict?.id === shortcut.id || conflict?.other === shortcut.id
						}}
						data-shortcut={shortcut.id}
					>
						<div>
							{shortcut.label}
							<small>{shortcut.detail}</small>
							{#if conflict?.id === shortcut.id}
								<small class="conflict-note">Already used by {shortcutLabel(conflict.other)}.</small
								>
							{/if}
						</div>
						<span class="binding-actions">
							<button
								type="button"
								class="binding"
								data-capture={shortcut.id}
								aria-label={capturing === shortcut.id
									? `Press a key for ${shortcut.label}`
									: `Change shortcut for ${shortcut.label}`}
								onclick={() => beginCapture(shortcut.id)}
							>
								{capturing === shortcut.id ? 'Press a key…' : formatChords(chords)}
							</button>
							<button
								type="button"
								aria-label={`Clear ${shortcut.label} shortcut`}
								onclick={() => clearShortcut(shortcut.id)}
							>
								Clear
							</button>
							<button
								type="button"
								aria-label={`Reset ${shortcut.label} shortcut`}
								disabled={!Object.hasOwn(overrides, shortcut.id)}
								onclick={() => resetShortcut(shortcut.id)}
							>
								Reset
							</button>
						</span>
					</div>
				{/each}
			{:else}
				<p class="note">
					Enter a user ID and API key, then press Validate. A successful check saves the
					credentials. A failed check keeps the previous ones. The stored key is never shown.
				</p>
				<div class="setting-row">
					<label for="user-id">User ID</label>
					<input
						id="user-id"
						name="user-id"
						autocomplete="off"
						spellcheck="false"
						bind:value={userId}
					/>
				</div>
				<div class="setting-row">
					<label for="api-key">API key</label>
					<span class="key-entry">
						<input
							id="api-key"
							name="api-key"
							type={visible ? 'text' : 'password'}
							autocomplete="off"
							spellcheck="false"
							value={apiKey}
							oninput={(event) => onKeyInput(event.currentTarget.value)}
						/>
						{#if apiKey}
							<button type="button" onclick={() => (visible = !visible)}>
								{visible ? 'Hide' : 'Show'}
							</button>
						{/if}
					</span>
				</div>
				<div class="setting-row">
					<div class="credential-status">
						{#if saved}
							<p class="status">Credentials saved</p>
						{/if}
						{#if error}
							<p class="alert" role="alert">{error}</p>
						{/if}
					</div>
					<button type="button" onclick={validate}>Validate</button>
				</div>
			{/if}
		</section>
	{/each}

	<div class="setting-row session">
		<div>
			Session
			<small>End the owner session in this browser.</small>
		</div>
		<button type="button" onclick={logout}>Log out</button>
	</div>
</main>

<style>
	.settings-page {
		display: grid;
		grid-template-columns: 160px minmax(0, 1fr);
		gap: 0 38px;
		align-items: start;
		width: 100%;
		max-width: 1040px;
		margin: 0 auto;
		padding: 0 26px 64px;
	}

	.settings-nav {
		position: sticky;
		top: 0;
		z-index: 1;
		isolation: isolate;
		display: flex;
		grid-column: 1;
		grid-row: 1 / span 30;
		flex-direction: column;
		gap: 4px;
		margin: 0;
		padding: 7px;
		border: 1px solid #262d39;
		border-radius: 12px;
		background: #12161de0;
	}

	.settings-nav a {
		position: relative;
		z-index: 1;
		padding: 9px 11px;
		border-radius: 7px;
		background: transparent;
		box-shadow: none;
		color: #909caf;
		font-size: 12px;
		text-decoration: none;
		transition: color 0.22s ease;
	}

	.settings-nav a:hover {
		background: transparent;
		color: #eef2fa;
	}

	.settings-nav a.active {
		background: transparent;
		box-shadow: none;
		color: #cfdef7;
	}

	.settings-nav-indicator {
		position: absolute;
		top: 7px;
		right: 7px;
		left: 7px;
		z-index: 0;
		height: var(--indicator-h, 34px);
		border-radius: 7px;
		background: #29364b;
		pointer-events: none;
		transform: translateY(var(--indicator-y, 0px));
		transition:
			transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1),
			height 0.3s ease;
	}

	.settings-section,
	.session {
		grid-column: 2;
		min-width: 0;
	}

	.settings-section {
		margin-bottom: 45px;
		scroll-margin-top: 20px;
	}

	h2 {
		margin: 0 0 16px;
		font-size: 15px;
		font-weight: 550;
	}

	.note {
		margin: 0;
		color: #68758a;
		font-size: 12px;
		line-height: 1.5;
	}

	.setting-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		padding: 16px 0;
		border-top: 1px solid #252b35;
	}

	.setting-row small {
		display: block;
		margin-top: 4px;
		color: #737f92;
		font-size: 11px;
	}

	.setting-row label {
		display: block;
	}

	.setting-row input[type='text'],
	.setting-row input[type='password'],
	.setting-row input[type='number'] {
		width: 200px;
		height: auto;
		padding: 7px 8px;
		border: 1px solid #354156;
		border-radius: 7px;
		background: #1a202c;
		color: #fff;
	}

	.setting-row input[type='number'] {
		width: 88px;
	}

	.setting-row input[type='range'] {
		width: 180px;
		height: 18px;
		padding: 0;
		border: 0;
		background: transparent;
		accent-color: #b3c5e3;
	}

	.setting-row input[type='checkbox'] {
		flex: none;
		width: 16px;
		height: 16px;
		margin: 0;
		accent-color: #b3c5e3;
	}

	.setting-row button {
		width: auto;
		height: auto;
		padding: 6px 12px;
		border: 1px solid #3b4960;
		border-radius: 6px;
		background: #242d3c;
	}

	.key-entry {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.binding-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 6px;
	}

	.conflict .binding {
		border-color: #eb8492;
	}

	.conflict-note {
		color: #eb8492;
	}

	.credential-status {
		display: grid;
		gap: 4px;
	}

	.status,
	.alert {
		margin: 0;
	}

	.status {
		color: #99c8a3;
	}

	.alert {
		color: #eb8492;
	}

	.settings-header-title {
		margin: 0;
		font-size: 23px;
		font-weight: 550;
		letter-spacing: -0.6px;
	}

	.saved-indicator,
	.save-error {
		font-size: 12px;
	}

	.saved-indicator {
		color: #99c8a3;
	}

	.save-error {
		color: #eb8492;
	}

	@media (max-width: 850px) {
		.settings-page {
			grid-template-columns: 130px minmax(0, 1fr);
			gap: 0 18px;
			padding-right: 15px;
			padding-left: 15px;
		}

		.settings-nav a {
			padding: 8px;
			font-size: 11px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.settings-nav-indicator,
		.settings-nav a {
			transition: none;
		}
	}
</style>
