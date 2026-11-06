<script lang="ts">
	import { untrack } from 'svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let userId = $state(untrack(() => data.userId));
	let apiKey = $state('');
	let visible = $state(false);
	let saved = $state(untrack(() => data.configured));
	let error = $state('');

	async function validate() {
		error = '';
		const response = await fetch('/api/settings/gelbooru/validate', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ userId, apiKey })
		});
		if (!response.ok) {
			error = 'Validation failed';
			return;
		}
		apiKey = '';
		visible = false;
		saved = true;
	}
</script>

<main>
	<label>
		User ID
		<input name="user-id" bind:value={userId} autocomplete="off" />
	</label>
	<label>
		API key
		<input
			name="api-key"
			type={visible ? 'text' : 'password'}
			bind:value={apiKey}
			autocomplete="off"
		/>
	</label>
	<button type="button" onclick={() => (visible = !visible)}>{visible ? 'Hide' : 'Show'}</button>
	<button type="button" onclick={validate}>Validate</button>
	{#if saved}
		<p>Credentials saved</p>
	{/if}
	{#if error}
		<p role="alert">{error}</p>
	{/if}
</main>
