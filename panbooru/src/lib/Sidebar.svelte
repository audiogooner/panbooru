<script lang="ts">
	import { page } from '$app/state';
	import { chooseView, navigation, removeView, startSearch } from '#lib/explore.svelte.ts';

	let { onlogout }: { onlogout: () => void } = $props();

	const destinations = [
		{ href: '/albums', label: 'Albums' },
		{ href: '/favorites', label: 'Favorites' },
		{ href: '/saved', label: 'Saved searches' },
		{ href: '/settings', label: 'Settings' }
	];

	function label(query: string) {
		return query || 'Untitled search';
	}
</script>

<nav class="sidebar" aria-label="Main navigation">
	<a class="brand" href="/">Panbooru</a>
	<button class="new-search" type="button" onclick={startSearch}>New search</button>
	<ul class="views">
		{#each navigation.views as view (view.id)}
			<li class={{ active: view.id === navigation.activeId }}>
				<button type="button" onclick={() => chooseView(view.id)}>{label(view.query)}</button>
				<button type="button" aria-label="Close view" onclick={() => removeView(view.id)}>×</button>
			</li>
		{/each}
	</ul>
	<ul class="destinations">
		{#each destinations as destination (destination.href)}
			<li>
				<a href={destination.href} aria-current={page.url.pathname === destination.href ? 'page' : undefined}>
					{destination.label}
				</a>
			</li>
		{/each}
	</ul>
	<button class="logout" type="button" onclick={onlogout}>Log out</button>
</nav>

<style>
	.sidebar {
		width: 246px;
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 18px 10px 12px;
		background: #101115;
		border-right: 1px solid #22242b;
	}

	.brand {
		padding: 8px 12px 16px;
		color: inherit;
		font-size: 17px;
		font-weight: 620;
		letter-spacing: -0.5px;
		text-decoration: none;
	}

	.new-search,
	.logout,
	.views button,
	.destinations a {
		color: #a5a9b4;
		text-align: left;
	}

	.new-search,
	.logout {
		width: 100%;
		height: auto;
		padding: 11px 12px;
		border: 0;
		border-radius: 9px;
		background: #1b1d24;
	}

	.views,
	.destinations {
		display: grid;
		gap: 2px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.views {
		flex: 1;
		align-content: start;
		overflow: auto;
	}

	.views li,
	.destinations li {
		display: flex;
		align-items: center;
		border-radius: 8px;
	}

	.views li.active,
	.destinations a[aria-current='page'] {
		background: #252a35;
		color: #f1f1f7;
	}

	.views button:first-child,
	.destinations a {
		flex: 1;
		min-width: 0;
		padding: 8px 10px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		border: 0;
		border-radius: 8px;
		background: transparent;
		text-decoration: none;
	}

	.views button:last-child {
		width: 28px;
		background: transparent;
		border: 0;
		color: #999;
	}

	.destinations {
		border-top: 1px solid #262932;
		padding-top: 10px;
	}
</style>
