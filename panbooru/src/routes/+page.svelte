<script lang="ts">
	type Post = { id: string; tags: string[]; mediaRef: string };
	let query = $state('');
	let posts = $state<Post[]>([]);
	let error = $state('');

	async function search(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		const response = await fetch('/api/source/gelbooru/search', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ query })
		});
		if (!response.ok) {
			error = 'Search failed';
			return;
		}
		const body = (await response.json()) as { data: { posts: Post[] } };
		posts = body.data.posts;
	}
</script>

<main>
	<form onsubmit={search}>
		<label>
			Tags
			<input name="tags" bind:value={query} />
		</label>
		<button type="submit">Search</button>
	</form>
	{#if error}
		<p role="alert">{error}</p>
	{/if}
	<ul>
		{#each posts as post (post.id)}
			<li>
				<img
					src={`/api/media/${post.mediaRef}`}
					alt={post.tags.join(' ')}
					width="100"
					height="50"
				/>
			</li>
		{/each}
	</ul>
</main>
