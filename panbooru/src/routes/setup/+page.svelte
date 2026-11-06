<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let token = $state('');
	let password = $state('');
	let error = $state('');

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const response = await fetch('/api/setup/owner', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ token, password })
		});
		if (!response.ok) {
			error = 'Setup failed';
			return;
		}
		window.location.href = '/';
	}
</script>

<main>
	{#if data.claimed}
		<p>This server already has an owner.</p>
	{:else}
		<form onsubmit={submit}>
			<label>
				Bootstrap token
				<input name="token" bind:value={token} autocomplete="off" />
			</label>
			<label>
				Password
				<input name="password" type="password" bind:value={password} autocomplete="new-password" />
			</label>
			<button type="submit">Create owner</button>
			{#if error}
				<p role="alert">{error}</p>
			{/if}
		</form>
	{/if}
</main>
