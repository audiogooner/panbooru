<script lang="ts">
	import { onMount } from 'svelte';
	import { backOut, cubicInOut, cubicOut, expoOut, quadOut } from 'svelte/easing';
	import type { EasingFunction, TransitionConfig } from 'svelte/transition';
	import Icon from '#lib/Icon.svelte';

	const origins = ['top left', 'top center', 'top right', 'center'] as const;
	const easingNames = ['ease', 'cubicOut', 'cubicInOut', 'quadOut', 'backOut', 'expoOut'] as const;

	type Origin = (typeof origins)[number];
	type EasingName = (typeof easingNames)[number];
	type Surface = 'filter' | 'context' | 'album';
	type Kind = 'current' | 'scale' | 'slide' | 'slide-full' | 'pop' | 'blur' | 'clip';

	type Motion = {
		id: string;
		label: string;
		blurb: string;
		kind: Kind;
		enter: number;
		exit: number;
		linked: boolean;
		easing: EasingName;
		y: number;
		scale: number;
		opacity: number;
		blur: number;
		origin: Origin;
		open: boolean;
		replayQueued: boolean;
	};

	type MotionParams = {
		duration: number;
		easing: EasingName;
		y: number;
		scale: number;
		opacity: number;
		blur: number;
		clip: boolean;
		/** Translate by the panel's own height so it enters fully from above, clipped by the stage. */
		fullSlide: boolean;
	};

	const easingCss: Record<EasingName, string> = {
		ease: 'ease',
		cubicOut: 'cubic-bezier(0.33, 1, 0.68, 1)',
		cubicInOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
		quadOut: 'cubic-bezier(0.5, 1, 0.89, 1)',
		backOut: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
		expoOut: 'cubic-bezier(0.16, 1, 0.3, 1)'
	};

	const easingFns: Record<EasingName, EasingFunction> = {
		ease: cssEase(0.25, 0.1, 0.25, 1),
		cubicOut,
		cubicInOut,
		quadOut,
		backOut,
		expoOut
	};

	const surfaces: { id: Surface; label: string }[] = [
		{ id: 'filter', label: 'Filter' },
		{ id: 'context', label: 'Context menu' },
		{ id: 'album', label: 'Album picker' }
	];

	function cssEase(x1: number, y1: number, x2: number, y2: number): EasingFunction {
		const cx = 3 * x1;
		const bx = 3 * (x2 - x1) - cx;
		const ax = 1 - cx - bx;
		const cy = 3 * y1;
		const by = 3 * (y2 - y1) - cy;
		const ay = 1 - cy - by;
		const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
		const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
		const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
		return (x: number) => {
			let t = x;
			for (let i = 0; i < 8; i += 1) {
				const slope = sampleDX(t);
				if (Math.abs(slope) < 1e-6) break;
				t = Math.min(1, Math.max(0, t - (sampleX(t) - x) / slope));
			}
			return sampleY(t);
		};
	}

	function createMotions(): Motion[] {
		const base = {
			linked: false,
			opacity: 0,
			blur: 0,
			origin: 'top left' as Origin,
			open: false,
			replayQueued: false
		};
		return [
			{
				...base,
				id: 'current',
				label: 'Current',
				blurb: 'Search today: fade, 4px rise, scale 0.96. Enter only in the app.',
				kind: 'current',
				enter: 140,
				exit: 140,
				linked: true,
				easing: 'ease',
				y: -4,
				scale: 0.96
			},
			{
				...base,
				id: 'scale',
				label: 'Soft scale',
				blurb: 'Fades and scales from the anchor. No slide.',
				kind: 'scale',
				enter: 180,
				exit: 140,
				easing: 'cubicOut',
				y: 0,
				scale: 0.92
			},
			{
				...base,
				id: 'slide',
				label: 'Slide soft',
				blurb: 'Short drop from the trigger, then fade.',
				kind: 'slide',
				enter: 200,
				exit: 160,
				easing: 'cubicOut',
				y: -12,
				scale: 1
			},
			{
				...base,
				id: 'slide-fast',
				label: 'Slide crisp',
				blurb: 'Full-height slide under the trigger, like clip reveal, but the panel moves the whole way.',
				kind: 'slide-full',
				enter: 120,
				exit: 100,
				linked: true,
				easing: 'cubicOut',
				y: 0,
				scale: 1,
				opacity: 1
			},
			{
				...base,
				id: 'pop',
				label: 'Pop',
				blurb: 'Scale with a small overshoot at the end.',
				kind: 'pop',
				enter: 320,
				exit: 180,
				easing: 'backOut',
				y: 0,
				scale: 0.82
			},
			{
				...base,
				id: 'blur',
				label: 'Blur fade',
				blurb: 'Opacity plus a short blur, no movement.',
				kind: 'blur',
				enter: 220,
				exit: 160,
				easing: 'cubicOut',
				y: 0,
				scale: 1,
				blur: 10
			},
			{
				...base,
				id: 'clip',
				label: 'Clip reveal',
				blurb: 'Opens downward from the top edge.',
				kind: 'clip',
				enter: 240,
				exit: 180,
				easing: 'cubicOut',
				y: 0,
				scale: 1,
				opacity: 1
			}
		];
	}

	function popover(_node: Element, params: MotionParams): TransitionConfig {
		return {
			duration: params.duration,
			easing: easingFns[params.easing],
			css: (t, u) => {
				const scale = params.scale + (1 - params.scale) * t;
				const opacity = params.opacity + (1 - params.opacity) * t;
				const y = params.fullSlide ? `${-100 * u}%` : `${params.y * u}px`;
				const parts = [`opacity:${opacity}`, `transform:translateY(${y}) scale(${scale})`];
				if (params.blur > 0) parts.push(`filter:blur(${params.blur * u}px)`);
				if (params.clip) parts.push(`clip-path:inset(0 0 ${u * 100}% 0)`);
				return parts.join(';');
			}
		};
	}

	function intro(motion: Motion): MotionParams {
		return {
			duration: motion.enter,
			easing: motion.easing,
			y: motion.y,
			scale: motion.scale,
			opacity: motion.opacity,
			blur: motion.blur,
			clip: motion.kind === 'clip',
			fullSlide: motion.kind === 'slide-full'
		};
	}

	function outro(motion: Motion): MotionParams {
		return { ...intro(motion), duration: motion.exit };
	}

	function num(value: number) {
		return String(Math.round(value * 1000) / 1000);
	}

	function cssBlock(motion: Motion) {
		const full = motion.kind === 'slide-full';
		const move =
			full || motion.y !== 0 || motion.scale !== 1
				? `transform: translateY(${full ? '-100%' : `${num(motion.y)}px`}) scale(${num(motion.scale)});`
				: '';
		const from = [
			motion.opacity !== 1 ? `opacity: ${num(motion.opacity)};` : '',
			move,
			motion.blur > 0 ? `filter: blur(${num(motion.blur)}px);` : '',
			motion.kind === 'clip' ? 'clip-path: inset(0 0 100% 0);' : ''
		].filter(Boolean);
		if (from.length === 0) from.push('opacity: 1;');
		const stage = full
			? `.stage {
  overflow: hidden; /* keep the slide under the trigger, like clip reveal */
}

`
			: '';
		return `${stage}.popup {
  transform-origin: ${motion.origin};
  animation: popover-in ${motion.enter}ms ${easingCss[motion.easing]};
}

@keyframes popover-in {
  from {
    ${from.join('\n    ')}
  }
}

/* exit ${motion.exit}ms — reverse the same from-state */`;
	}

	function svelteBlock(motion: Motion) {
		const fields = [
			`duration: ${motion.enter}`,
			motion.kind === 'slide-full' ? 'fullSlide: true' : `y: ${num(motion.y)}`,
			`scale: ${num(motion.scale)}`,
			`opacity: ${num(motion.opacity)}`,
			`blur: ${num(motion.blur)}`,
			motion.kind === 'clip' ? 'clip: true' : '',
			`easing: ${motion.easing}`
		].filter(Boolean);
		const enter = fields.join(', ');
		const exit = enter.replace(`duration: ${motion.enter}`, `duration: ${motion.exit}`);
		return `<div
  class="popup"
  style:transform-origin="${motion.origin}"
  in:popover={{ ${enter} }}
  out:popover={{ ${exit} }}
></div>`;
	}

	let motions = $state(createMotions());
	let selectedId = $state('current');
	let surface = $state<Surface>('filter');
	let loop = $state(false);
	let copied = $state(false);

	const selected = $derived(motions.find((item) => item.id === selectedId) ?? motions[0]);
	const snippet = $derived(`${cssBlock(selected)}\n\n${svelteBlock(selected)}`);

	let replayTimer = 0;
	let copyTimer = 0;
	let loopTimer = 0;
	let loopToken = 0;

	onMount(() => {
		for (const motion of motions) motion.open = true;
		return () => {
			stopLoopTimer();
			window.clearTimeout(replayTimer);
			window.clearTimeout(copyTimer);
		};
	});

	function stopLoopTimer() {
		loopToken += 1;
		window.clearTimeout(loopTimer);
	}

	function armLoop() {
		if (!loop) return;
		const token = loopToken;
		const id = selectedId;
		const motion = motions.find((item) => item.id === id);
		if (!motion) return;
		const pause = (motion.open ? motion.enter : motion.exit) + 240;
		loopTimer = window.setTimeout(() => {
			if (token !== loopToken || !loop) return;
			const current = motions.find((item) => item.id === id);
			if (!current || selectedId !== id) return;
			current.open = !current.open;
			armLoop();
		}, pause);
	}

	function restartLoop() {
		stopLoopTimer();
		if (loop) armLoop();
	}

	function select(id: string) {
		selectedId = id;
		restartLoop();
	}

	function toggle(motion: Motion) {
		selectedId = motion.id;
		motion.replayQueued = false;
		motion.open = !motion.open;
		restartLoop();
	}

	function replay(motion: Motion) {
		selectedId = motion.id;
		if (!motion.open) {
			motion.open = true;
			restartLoop();
			return;
		}
		if (loop) {
			motion.replayQueued = false;
			motion.open = false;
			restartLoop();
			return;
		}
		motion.replayQueued = true;
		motion.open = false;
	}

	function onOutroEnd(motion: Motion) {
		if (!motion.replayQueued) return;
		motion.replayQueued = false;
		motion.open = true;
	}

	function afterParamChange() {
		if (loop) {
			restartLoop();
			return;
		}
		window.clearTimeout(replayTimer);
		replayTimer = window.setTimeout(() => {
			const motion = motions.find((item) => item.id === selectedId);
			if (motion) replay(motion);
		}, 90);
	}

	function setEnter(value: number) {
		selected.enter = value;
		if (selected.linked) selected.exit = value;
		afterParamChange();
	}

	function setExit(value: number) {
		selected.exit = value;
		afterParamChange();
	}

	function resetSelected() {
		const index = motions.findIndex((item) => item.id === selectedId);
		const fresh = createMotions().find((item) => item.id === selectedId);
		if (index < 0 || !fresh) return;
		const open = motions[index].open;
		motions[index] = { ...fresh, open, replayQueued: false };
		afterParamChange();
	}

	async function copySnippet() {
		await navigator.clipboard.writeText(snippet);
		copied = true;
		window.clearTimeout(copyTimer);
		copyTimer = window.setTimeout(() => {
			copied = false;
		}, 1200);
	}
</script>

<svelte:head>
	<title>Popover motion</title>
</svelte:head>

<div class="lab">
	<header class="intro">
		<div>
			<h1>Popover motion</h1>
			<p>
				Same chrome as the app menus. Try it on a filter, the context menu, and the album picker
				before picking one motion for all of them.
			</p>
		</div>
		<div class="switches">
			<div class="surfaces" role="group" aria-label="Surface">
				{#each surfaces as item (item.id)}
					<button
						type="button"
						aria-pressed={surface === item.id}
						onclick={() => (surface = item.id)}
					>
						{item.label}
					</button>
				{/each}
			</div>
			<button
				type="button"
				class="loop"
				aria-pressed={loop}
				onclick={() => {
					loop = !loop;
					restartLoop();
				}}
			>
				Loop selected
			</button>
		</div>
	</header>

	<section class="controls" aria-label="Parameters for {selected.label}">
		<div class="controls-head">
			<h2>{selected.label}</h2>
			<div class="control-actions">
				<button type="button" onclick={() => replay(selected)}>Replay</button>
				<button type="button" onclick={resetSelected}>Reset</button>
			</div>
		</div>
		<label class="field">
			<span class="field-label"><span>Enter</span><span>{selected.enter} ms</span></span>
			<input
				type="range"
				min="40"
				max="800"
				step="10"
				value={selected.enter}
				oninput={(event) => setEnter(Number(event.currentTarget.value))}
			/>
		</label>
		<label class="field">
			<span class="field-label"><span>Exit</span><span>{selected.exit} ms</span></span>
			<input
				type="range"
				min="40"
				max="800"
				step="10"
				value={selected.exit}
				disabled={selected.linked}
				oninput={(event) => setExit(Number(event.currentTarget.value))}
			/>
		</label>
		<label class="check">
			<input
				type="checkbox"
				checked={selected.linked}
				onchange={(event) => {
					selected.linked = event.currentTarget.checked;
					if (selected.linked) selected.exit = selected.enter;
					afterParamChange();
				}}
			/>
			Link exit to enter
		</label>
		<label class="field">
			<span class="field-label"><span>Y offset</span><span>{selected.y} px</span></span>
			<input
				type="range"
				min="-40"
				max="40"
				step="1"
				value={selected.y}
				oninput={(event) => {
					selected.y = Number(event.currentTarget.value);
					afterParamChange();
				}}
			/>
		</label>
		<label class="field">
			<span class="field-label"><span>Scale start</span><span>{num(selected.scale)}</span></span>
			<input
				type="range"
				min="0.5"
				max="1.2"
				step="0.01"
				value={selected.scale}
				oninput={(event) => {
					selected.scale = Number(event.currentTarget.value);
					afterParamChange();
				}}
			/>
		</label>
		<label class="field">
			<span class="field-label"><span>Opacity start</span><span>{num(selected.opacity)}</span></span
			>
			<input
				type="range"
				min="0"
				max="1"
				step="0.05"
				value={selected.opacity}
				oninput={(event) => {
					selected.opacity = Number(event.currentTarget.value);
					afterParamChange();
				}}
			/>
		</label>
		<label class="field">
			<span class="field-label"><span>Blur</span><span>{selected.blur} px</span></span>
			<input
				type="range"
				min="0"
				max="16"
				step="1"
				value={selected.blur}
				oninput={(event) => {
					selected.blur = Number(event.currentTarget.value);
					afterParamChange();
				}}
			/>
		</label>
		<label class="field">
			<span>Easing</span>
			<select
				value={selected.easing}
				onchange={(event) => {
					selected.easing = event.currentTarget.value as EasingName;
					afterParamChange();
				}}
			>
				{#each easingNames as name (name)}
					<option value={name}>{name}</option>
				{/each}
			</select>
		</label>
		<label class="field">
			<span>Origin</span>
			<select
				value={selected.origin}
				onchange={(event) => {
					selected.origin = event.currentTarget.value as Origin;
					afterParamChange();
				}}
			>
				{#each origins as origin (origin)}
					<option value={origin}>{origin}</option>
				{/each}
			</select>
		</label>
	</section>

	<div class="grid">
		{#each motions as motion (motion.id)}
			<article class={['card', motion.id === selectedId && 'selected']}>
				<div class="card-top">
					<button
						type="button"
						class="pick"
						aria-pressed={motion.id === selectedId}
						onclick={() => select(motion.id)}
					>
						{motion.label}
					</button>
					<button type="button" class="trigger" onclick={() => toggle(motion)}>
						{motion.open ? 'Close' : 'Open'}
					</button>
				</div>
				<p class="blurb">{motion.blurb}</p>
				<div class="stage">
					{#if motion.open}
						<div
							class="popup"
							style:transform-origin={motion.origin}
							in:popover={intro(motion)}
							out:popover={outro(motion)}
							onoutroend={() => onOutroEnd(motion)}
						>
							{#if surface === 'filter'}
								<h3>Rating</h3>
								<label><input type="checkbox" checked />safe</label>
								<label><input type="checkbox" />questionable</label>
								<label><input type="checkbox" />explicit</label>
							{:else if surface === 'context'}
								<button type="button" class="menu-item"
									><Icon name="book-image" />Add to album</button
								>
								<button type="button" class="menu-item"><Icon name="heart" />Favorite</button>
								<button type="button" class="menu-item"><Icon name="download" />Download</button>
								<button type="button" class="menu-item"
									><Icon name="external" />Open booru page</button
								>
							{:else}
								<h3>Albums</h3>
								<label><input type="checkbox" checked />Favorites</label>
								<label><input type="checkbox" />References</label>
								<label><input type="checkbox" />Outfits</label>
								<input type="text" placeholder="New album" aria-label="New album" />
							{/if}
						</div>
					{/if}
				</div>
			</article>
		{/each}
	</div>

	<section class="readout">
		<div class="controls-head">
			<h2>Snippet</h2>
			<button type="button" onclick={copySnippet}>{copied ? 'Copied' : 'Copy'}</button>
		</div>
		<pre>{snippet}</pre>
	</section>
</div>

<style>
	.lab {
		display: flex;
		flex-direction: column;
		gap: 18px;
		padding: 22px 28px 72px;
	}

	.intro {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 16px;
	}

	.intro p {
		max-width: 46rem;
		margin: 6px 0 0;
		color: #8d98ac;
	}

	.switches {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.surfaces {
		display: flex;
		gap: 6px;
	}

	.surfaces button,
	.loop,
	.control-actions button,
	.readout button,
	.trigger {
		padding: 6px 10px;
		border: 1px solid #343c48;
		border-radius: 8px;
		background: #1c2028;
		color: #d5dbe6;
	}

	.surfaces button[aria-pressed='true'],
	.loop[aria-pressed='true'] {
		border-color: #8fb5e5;
		background: #243044;
	}

	.controls,
	.card,
	.readout pre {
		border: 1px solid #2c3340;
		border-radius: 12px;
		background: #12161d;
	}

	.controls {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 14px 16px;
		padding: 14px;
	}

	.controls-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		grid-column: 1 / -1;
	}

	.controls-head h2,
	.pick {
		margin: 0;
		padding: 0;
		border: 0;
		background: none;
		color: #e8edf5;
		font-size: 14px;
		font-weight: 600;
	}

	.control-actions {
		display: flex;
		gap: 6px;
	}

	.field,
	.check {
		display: grid;
		gap: 6px;
		color: #a6b2c5;
		font-size: 11px;
	}

	.check {
		grid-auto-flow: column;
		align-items: center;
		justify-content: start;
		align-self: end;
	}

	.field-label {
		display: flex;
		justify-content: space-between;
		gap: 8px;
	}

	.field input[type='range'] {
		width: 100%;
		accent-color: #8fb5e5;
	}

	.field select {
		width: 100%;
		padding: 6px 8px;
		border: 1px solid #343c48;
		border-radius: 7px;
		background: #10141b;
		color: #e4eaf4;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 16px;
	}

	.card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
		padding: 12px;
	}

	.card.selected {
		z-index: 2;
		border-color: #7f9ac4;
	}

	.card-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.pick[aria-pressed='true'] {
		color: #d7e6f8;
	}

	.blurb {
		min-height: 2.6em;
		margin: 0;
		color: #8d98ac;
		font-size: 12px;
	}

	.stage {
		position: relative;
		overflow: hidden;
		height: 250px;
	}

	.stage :global(.popup) {
		position: absolute;
		top: 0;
		left: 0;
		z-index: 1;
		max-height: 250px;
	}

	.readout pre {
		margin: 0;
		padding: 14px;
		overflow: auto;
		color: #d5dbe6;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 12px;
		line-height: 1.5;
		white-space: pre;
	}

	@media (max-width: 720px) {
		.lab {
			padding: 16px 14px 48px;
		}
	}
</style>
