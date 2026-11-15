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
	import { bindHistoryRehydrate } from '#lib/explore.svelte.ts';
	import { editingText, matchesShortcut } from '#lib/shortcuts.ts';
	import './layout.css';

	let { data, children }: LayoutProps = $props();

	bindHistoryRehydrate();

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
