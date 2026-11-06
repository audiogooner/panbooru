<script lang="ts">
	import { untrack } from 'svelte';

	let {
		initial,
		suggestions,
		oninput,
		onsearch
	}: {
		initial: string;
		suggestions: { name: string; count: number }[];
		oninput: (value: string) => void;
		onsearch: (value: string) => void;
	} = $props();

	let draft = $state(untrack(() => initial));

	function submit(event: SubmitEvent) {
		event.preventDefault();
		onsearch(draft);
	}
</script>

<form onsubmit={submit}>
	<label>
		Tags
		<input name="tags" bind:value={draft} oninput={() => oninput(draft)} />
	</label>
	<button type="submit">Search</button>
</form>
{#if suggestions.length}
	<ul>
		{#each suggestions as suggestion (suggestion.name)}
			<li>{suggestion.name}</li>
		{/each}
	</ul>
{/if}
