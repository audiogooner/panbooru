<script lang="ts">
	let {
		src,
		alt,
		width,
		height,
		fit = 'cover',
		draggable,
		onerror
	}: {
		src: string;
		alt: string;
		width: number;
		height: number;
		fit?: 'cover' | 'intrinsic';
		draggable?: boolean;
		onerror?: (event: Event) => void;
	} = $props();

	let shown = $state<{ src: string; instant: boolean } | null>(null);
	const ready = $derived(shown?.src === src);
	const instant = $derived(Boolean(ready && shown?.instant));

	function background(url: string) {
		return `url("${url.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}")`;
	}

	function fromCache(img: HTMLImageElement) {
		const entry = performance.getEntriesByName(img.currentSrc || img.src).at(-1);
		if (!entry || !('decodedBodySize' in entry)) return false;
		const timing = entry as PerformanceResourceTiming;
		return timing.transferSize === 0 && timing.decodedBodySize > 0;
	}

	function reveal(img: HTMLImageElement, warm: boolean) {
		if (img.naturalWidth === 0) return;
		if (shown?.src === src && shown.instant) return;
		const skip = warm || fromCache(img);
		if (shown?.src === src && shown.instant === skip) return;
		shown = { src, instant: skip };
	}

	function watch(img: HTMLImageElement) {
		void src;
		if (img.complete && img.naturalWidth > 0) reveal(img, true);
	}

	function onLoad(event: Event) {
		const img = event.currentTarget;
		if (!(img instanceof HTMLImageElement)) return;
		reveal(img, false);
	}
</script>

<div class={['thumb', fit, ready && 'ready', instant && 'instant']}>
	<div class="preview" style:background-image={background(src)} aria-hidden="true"></div>
	<img
		{src}
		{alt}
		{width}
		{height}
		draggable={draggable === undefined ? undefined : draggable}
		class="sharp"
		{@attach watch}
		onload={onLoad}
		{onerror}
	/>
</div>

<style>
	.thumb {
		overflow: hidden;
	}

	.thumb.cover {
		position: absolute;
		inset: 0;
	}

	.thumb.intrinsic {
		position: relative;
		display: block;
		border-radius: 13px;
		background: #191e25;
		line-height: 0;
	}

	.preview {
		position: absolute;
		inset: -28%;
		z-index: 1;
		background-position: center;
		background-size: cover;
		opacity: 1;
		filter: blur(20px);
		pointer-events: none;
		transition:
			opacity 360ms cubic-bezier(0.16, 1, 0.3, 1),
			filter 360ms cubic-bezier(0.16, 1, 0.3, 1),
			visibility 0s linear 360ms;
	}

	.sharp {
		position: relative;
		z-index: 2;
		display: block;
		opacity: 0;
		filter: blur(8px);
		transition:
			opacity 360ms cubic-bezier(0.16, 1, 0.3, 1),
			filter 360ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	.thumb.cover .sharp {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		max-width: none;
		object-fit: cover;
	}

	.thumb.ready .preview {
		opacity: 0;
		filter: blur(7px);
		visibility: hidden;
	}

	.thumb.ready .sharp {
		opacity: 1;
		filter: blur(0px);
	}

	.thumb.instant .preview,
	.thumb.instant .sharp {
		transition: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.preview {
			opacity: 0 !important;
			filter: none !important;
			visibility: hidden !important;
		}

		.sharp {
			opacity: 1 !important;
			filter: none !important;
			transition: none !important;
		}
	}
</style>
