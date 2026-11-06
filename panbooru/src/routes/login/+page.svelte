<script lang="ts">
	let password = $state('');
	let error = $state('');

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const response = await fetch('/api/auth/login', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ password })
		});
		if (!response.ok) {
			error = 'Login failed';
			return;
		}
		window.location.href = '/';
	}
</script>

<main>
	<form onsubmit={submit}>
		<label>
			Password
			<input
				name="password"
				type="password"
				bind:value={password}
				autocomplete="current-password"
			/>
		</label>
		<button type="submit">Log in</button>
		{#if error}
			<p role="alert">{error}</p>
		{/if}
	</form>
</main>
