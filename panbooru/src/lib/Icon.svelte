<script module lang="ts">
	export { iconNames, type IconName } from '#lib/icons/paths.ts';
</script>

<script lang="ts">
	import { iconNodes, type IconName } from '#lib/icons/paths.ts';
	import type { SVGAttributes } from 'svelte/elements';

	type Props = Omit<SVGAttributes<SVGSVGElement>, 'class' | 'viewBox'> & {
		name: IconName;
		/** When set, the icon is announced. Otherwise it is decorative. */
		label?: string;
		class?: string;
	};

	let { name, label, class: className, ...rest }: Props = $props();
</script>

<svg
	{...rest}
	class={['icon', className]}
	viewBox="0 0 24 24"
	aria-hidden={label ? undefined : true}
	aria-label={label}
	role={label ? 'img' : undefined}
>
	{#each iconNodes[name] as [tag, attrs], index (`${tag}-${index}`)}
		<svelte:element this={tag} {...attrs} />
	{/each}
</svg>

<style>
	svg {
		width: var(--icon-size, 18px);
		height: var(--icon-size, 18px);
		flex-shrink: 0;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
