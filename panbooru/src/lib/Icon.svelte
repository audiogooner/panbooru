<script module lang="ts">
	export const iconNames = [
		'search',
		'book-image',
		'heart',
		'plus',
		'x',
		'sort',
		'up',
		'shuffle',
		'star',
		'rating',
		'image',
		'film',
		'play',
		'animate',
		'settings',
		'sliders',
		'external',
		'download',
		'full',
		'panel',
		'left',
		'right',
		'pin',
		'saved',
		'artist',
		'check',
		'trash'
	] as const;

	export type IconName = (typeof iconNames)[number];
</script>

<script lang="ts">
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
	<use href="#{name}" />
</svg>

<style>
	svg {
		width: var(--icon-size, 18px);
		height: var(--icon-size, 18px);
		flex-shrink: 0;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.55;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
