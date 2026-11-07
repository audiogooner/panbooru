<script module lang="ts">
	import { createContext, onDestroy } from 'svelte';
	import type { Snippet } from 'svelte';

	/** localStorage keys. This shell reads only the sidebar width. */
	export const shellPreferences = {
		sidebarWidth: 'panbooru-sidebar-width',
		albumHeight: 'panbooru-album-height',
		rowHeight: 'panbooru-row-height'
	} as const;

	export const SIDEBAR_WIDTH_KEY = shellPreferences.sidebarWidth;
	export const ALBUM_HEIGHT_KEY = shellPreferences.albumHeight;
	export const ROW_HEIGHT_KEY = shellPreferences.rowHeight;
	export const SIDEBAR_WIDTH_MIN = 180;
	export const SIDEBAR_WIDTH_MAX = 420;
	export const SIDEBAR_WIDTH_DEFAULT = 246;

	/** Clamp a sidebar width and publish it as `--side` on the document element. */
	export function applySidebarWidth(width: number) {
		const next = Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(width)));
		document.documentElement.style.setProperty('--side', `${next}px`);
		return next;
	}

	export type ShellChrome = {
		/** Page snippet rendered in `#toolbar`. */
		toolbar: Snippet | null;
		/** `.overlay-search` — compact backing over scrolled content. */
		overlay: boolean;
		/** `.scrolled-hidden` — slide the toolbar off the top. */
		hidden: boolean;
		/** `.settings-page-mode` — scroll region starts below the toolbar. */
		settings: boolean;
	};

	export const [getShell, setShell] = createContext<ShellChrome>();

	/** Mount a top-level `{#snippet toolbar()}` and clear it when the page is destroyed. */
	export function bindShellToolbar(toolbar: Snippet) {
		const shell = getShell();
		shell.toolbar = toolbar;
		onDestroy(() => {
			if (shell.toolbar !== toolbar) return;
			shell.toolbar = null;
			shell.overlay = false;
			shell.hidden = false;
			shell.settings = false;
		});
	}
</script>

<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { LayoutProps } from './$types';
	import Sidebar from '#lib/Sidebar.svelte';
	import ContextMenu from '#lib/ContextMenu.svelte';
	import Notice from '#lib/Notice.svelte';
	import { editingText, matchesShortcut } from '#lib/shortcuts.ts';
	import './layout.css';

	let { data, children }: LayoutProps = $props();

	const shell = $state<ShellChrome>({
		toolbar: null,
		overlay: false,
		hidden: false,
		settings: false
	});
	setShell(shell);

	let restorePreview = $state<string | null>(null);

	function restoreSidebarWidth() {
		try {
			const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
			if (!raw) return;
			const value = Number(raw);
			if (Number.isFinite(value)) applySidebarWidth(value);
		} catch {
			// Preference storage is unavailable in this browser context.
		}
	}

	async function logout() {
		await fetch('/api/auth/logout', { method: 'POST' });
		window.location.href = '/login';
	}

	async function restoreRemoval(event: KeyboardEvent) {
		const removalId = data.removalId;
		if (!removalId || !matchesShortcut(event, 'undo')) return;
		if (editingText(event.target)) return;
		event.preventDefault();
		const response = await fetch(`/api/library/removals/${encodeURIComponent(removalId)}/undo`, {
			method: 'POST'
		});
		if (!response.ok) return;
		const body = (await response.json().catch(() => null)) as {
			data?: { previews?: string[] };
		} | null;
		const src = body?.data?.previews?.[0];
		if (src) {
			restorePreview = src;
			window.setTimeout(() => {
				if (restorePreview === src) restorePreview = null;
			}, 700);
		}
		await invalidateAll();
	}
</script>

<svelte:window onkeydown={restoreRemoval} />

<svg class="icon-sprite" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
	<defs>
		<symbol id="search" viewBox="0 0 24 24"
			><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></symbol
		>
		<symbol id="book-image" viewBox="0 0 24 24"
			><path d="M5 3h14v18H6a3 3 0 0 1 0-6h13M5 3v12" /><path d="m8 12 3-4 2 2 2-3 2 5" /><circle
				cx="9"
				cy="6"
				r=".5"
			/></symbol
		>
		<symbol id="heart" viewBox="0 0 24 24"
			><path
				d="M20.4 4.6a5.5 5.5 0 0 0-7.8 0L12 5.2l-.6-.6a5.5 5.5 0 0 0-7.8 7.8L12 21l8.4-8.6a5.5 5.5 0 0 0 0-7.8Z"
			/></symbol
		>
		<symbol id="plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></symbol>
		<symbol id="x" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></symbol>
		<symbol id="sort" viewBox="0 0 24 24"
			><path d="M4 5h16M4 12h11M4 19h6M19 11v9m-3-3 3 3 3-3" /></symbol
		>
		<symbol id="up" viewBox="0 0 24 24"
			><path d="M4 5h6M4 12h11M4 19h16m-1-8V2m-3 3 3-3 3 3" /></symbol
		>
		<symbol id="shuffle" viewBox="0 0 24 24"
			><path d="m3 5 4 0 10 14h4m-4-4 4 4-4 3M3 19h4L17 5h4m-4-3 4 3-4 4" /></symbol
		>
		<symbol id="star" viewBox="0 0 24 24"
			><path d="m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z" /></symbol
		>
		<symbol id="rating" viewBox="0 0 24 24"
			><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" /><path d="m8 12 3 3 5-6" /></symbol
		>
		<symbol id="image" viewBox="0 0 24 24"
			><rect x="3" y="3" width="18" height="18" rx="3" /><path d="m3 17 6-6 4 4 3-3 5 5" /><circle
				cx="16"
				cy="8"
				r="1"
			/></symbol
		>
		<symbol id="film" viewBox="0 0 24 24"
			><rect x="3" y="4" width="18" height="16" rx="2" /><path
				d="M7 4v16M17 4v16M3 9h4m-4 6h4m10-6h4m-4 6h4"
			/></symbol
		>
		<symbol id="play" viewBox="0 0 24 24"><path d="m8 4 12 8-12 8Z" /></symbol>
		<symbol id="animate" viewBox="0 0 24 24"
			><rect x="7" y="3" width="14" height="14" rx="2" /><path
				d="M3 7v12a2 2 0 0 0 2 2h12m-6-14 6 3-6 3Z"
			/></symbol
		>
		<symbol id="settings" viewBox="0 0 24 24"
			><path d="m9 3-1 3-3 1 1 4-2 2 2 3 3-1 3 3 3-3 3 1 2-3-2-2 1-4-3-1-1-3Z" /><circle
				cx="12"
				cy="11"
				r="3"
			/></symbol
		>
		<symbol id="sliders" viewBox="0 0 24 24"
			><path d="M4 6h16M4 12h16M4 18h16" /><path d="M9 3v6m6 0v6m-7 0v6" /></symbol
		>
		<symbol id="external" viewBox="0 0 24 24"
			><path
				d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"
			/></symbol
		>
		<symbol id="download" viewBox="0 0 24 24"
			><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></symbol
		>
		<symbol id="full" viewBox="0 0 24 24"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5" /></symbol>
		<symbol id="panel" viewBox="0 0 24 24"
			><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M15 3v18m3-12v6" /></symbol
		>
		<symbol id="left" viewBox="0 0 24 24"><path d="m15 5-7 7 7 7" /></symbol>
		<symbol id="right" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></symbol>
		<symbol id="pin" viewBox="0 0 24 24"
			><path d="m9 3 10 10-4 1-4 5-3-3-5 5m2-14 4-4m-4 4 6 6m0-10 8 8" /></symbol
		>
		<symbol id="saved" viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4Z" /></symbol>
		<symbol id="artist" viewBox="0 0 24 24"
			><path d="m15 3 6 6-10 10-6 1 1-6Z" /><path d="m13 5 6 6M5 20l-2 1 1-4" /></symbol
		>
		<symbol id="check" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></symbol>
		<symbol id="trash" viewBox="0 0 24 24"
			><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" /></symbol
		>
	</defs>
</svg>

{#if data.authenticated}
	<div class="app" {@attach restoreSidebarWidth}>
		<Sidebar onlogout={logout} />
		<div id="main" class={{ main: true, 'settings-page-mode': shell.settings }}>
			<div
				id="toolbar"
				class={{
					toolbar: true,
					filled: shell.toolbar !== null,
					'overlay-search': shell.overlay,
					'scrolled-hidden': shell.hidden
				}}
			>
				{#if shell.toolbar}
					{@render shell.toolbar()}
				{/if}
			</div>
			<div id="scroll" class="scroll" tabindex="-1">
				{@render children()}
			</div>
		</div>
		<ContextMenu />
		<Notice />
		{#if restorePreview}
			<div class="restore-preview" style:background-image="url('{restorePreview}')" aria-hidden="true"
			></div>
		{/if}
	</div>
{:else}
	{@render children()}
{/if}

<style>
	.restore-preview {
		position: fixed;
		z-index: 80;
		right: 28px;
		bottom: 28px;
		width: 92px;
		height: 92px;
		border-radius: 12px;
		background-color: #191e25;
		background-position: center;
		background-size: cover;
		pointer-events: none;
		animation: restore-rise 700ms ease forwards;
	}

	@media (prefers-reduced-motion: reduce) {
		.restore-preview {
			animation: none;
			opacity: 0.9;
		}
	}

	@keyframes restore-rise {
		from {
			transform: translateY(16px);
			opacity: 0;
		}

		30% {
			opacity: 1;
		}

		to {
			transform: translateY(-28px);
			opacity: 0;
		}
	}
</style>
