<script lang="ts">
	import { viewerChrome } from '#lib/explore.svelte.ts';
	import type { ExplorationPost } from '#lib/navigation.ts';
	import { playable } from '#lib/playable.ts';
	import {
		readPlaybackPreference,
		savePosition,
		savedPosition,
		writePlaybackPreference
	} from '#lib/playback.ts';
	import { neighborPrefetch } from '#lib/prefetch.ts';
	import {
		doubleClickZoom,
		initialScale,
		initialZoom,
		needsOriginal,
		panBy,
		retainZoom,
		wheelZoom,
		type Zoom
	} from '#lib/zoom.ts';

	const DETAILS_PANEL = 292;

	let {
		post,
		posts = [],
		onclose,
		ontag,
		onmove
	}: {
		post: ExplorationPost;
		posts?: ExplorationPost[];
		onclose: () => void;
		ontag: (tag: string, event: MouseEvent) => void;
		onmove: (id: string) => void;
	} = $props();
	let tagsOpen = $state(false);
	let albumName = $state('');
	let root = $state<HTMLElement | null>(null);
	let viewportWidth = $state(1);
	let viewportHeight = $state(1);
	let manualZoom = $state<Zoom | null>(null);
	let manualId = $state('');
	let dragging = $state(false);
	let dragAt = { x: 0, y: 0 };
	let direction = $state(1);
	let loadedId = $state('');
	let paused = $state(true);
	let elapsed = $state(0);
	let duration = $state(0);
	let volume = $state(1);
	let muted = $state(false);
	let clickTimer = 0;
	let video: HTMLVideoElement | null = null;

	const image = $derived({ width: Math.max(post.width, 1), height: Math.max(post.height, 1) });
	const manual = $derived(manualZoom !== null && manualId === post.id);
	const frameWidth = $derived(
		Math.max(1, viewportWidth - (manual || !tagsOpen ? 0 : DETAILS_PANEL))
	);
	const zoom = $derived(
		manual && manualZoom
			? retainZoom(manualZoom, image, { width: viewportWidth, height: viewportHeight })
			: initialZoom(image, { width: frameWidth, height: viewportHeight })
	);
	const left = $derived(
		(manual ? viewportWidth : frameWidth) / 2 + zoom.x - (image.width * zoom.scale) / 2
	);
	const top = $derived(viewportHeight / 2 + zoom.y - (image.height * zoom.scale) / 2);
	const foreground = $derived(
		`/api/media/${post.mediaRef}${needsOriginal(image, zoom.scale) ? '' : '?recipe=display'}`
	);
	const playableVideo = $derived(post.kind === 'video' && playable(post.mediaType ?? ''));
	const unsupportedVideo = $derived(post.kind === 'video' && !playable(post.mediaType ?? ''));
	const sequence = $derived(posts.length ? posts : [post]);
	const index = $derived(sequence.findIndex((item) => item.id === post.id));
	const loading = $derived(!unsupportedVideo && loadedId !== post.id);
	const canPan = $derived(
		image.width * zoom.scale > (manual ? viewportWidth : frameWidth) + 0.5 ||
			image.height * zoom.scale > viewportHeight + 0.5
	);

	function area() {
		return manual
			? { width: viewportWidth, height: viewportHeight }
			: { width: frameWidth, height: viewportHeight };
	}

	function remember(next: Zoom) {
		if (manual) manualZoom = next;
		else {
			manualZoom = {
				scale: next.scale,
				x: frameWidth / 2 + next.x - viewportWidth / 2,
				y: next.y
			};
		}
		manualId = post.id;
	}

	function localPoint(event: { clientX: number; clientY: number }) {
		const rect = root?.getBoundingClientRect();
		return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
	}

	function typing(event: KeyboardEvent) {
		const target = event.target;
		return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			if (document.fullscreenElement) {
				void document.exitFullscreen();
				return;
			}
			onclose();
			return;
		}
		if ((event.key === 'f' || event.key === 'F') && !typing(event)) {
			event.preventDefault();
			toggleFullscreen();
		}
		if (typing(event)) return;
		if (playableVideo && (event.key === 'j' || event.key === 'J')) {
			event.preventDefault();
			seekBy(-10);
		}
		if (playableVideo && (event.key === 'l' || event.key === 'L')) {
			event.preventDefault();
			seekBy(10);
		}
		if (playableVideo && event.key === ' ' && !(event.target instanceof HTMLButtonElement)) {
			event.preventDefault();
			togglePlayback();
		}
		if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') {
			event.preventDefault();
			move(-1);
		}
		if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') {
			event.preventDefault();
			move(1);
		}
	}

	function move(delta: number) {
		const next = sequence[index + delta];
		if (!next) return;
		direction = delta;
		onmove(next.id);
	}

	function markLoaded(event: Event) {
		const image = event.currentTarget;
		if (!(image instanceof HTMLImageElement) || image.dataset.post !== post.id) return;
		loadedId = post.id;
	}

	function toggleFullscreen() {
		if (document.fullscreenElement) void document.exitFullscreen();
		else void root?.requestFullscreen();
	}

	function clock(seconds: number) {
		if (!Number.isFinite(seconds)) return '0:00';
		const whole = Math.max(0, Math.floor(seconds));
		return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
	}

	function videoElement(node: HTMLVideoElement) {
		video = node;
		if (node.readyState >= 1) prepareNode(node);
		else node.addEventListener('loadedmetadata', () => prepareNode(node), { once: true });
		return () => {
			node.pause();
			savePosition(post.id, node.currentTime);
			if (video === node) video = null;
		};
	}

	function prepareVideo(event: Event) {
		const node = event.currentTarget;
		if (!(node instanceof HTMLVideoElement)) return;
		prepareNode(node);
	}

	function prepareNode(node: HTMLVideoElement) {
		if (node.dataset.prepared === '1') return;
		node.dataset.prepared = '1';
		const preference = readPlaybackPreference();
		node.volume = preference.volume;
		node.muted = preference.muted;
		volume = preference.volume;
		muted = preference.muted;
		duration = node.duration || 0;
		loadedId = post.id;
		const saved = savedPosition(post.id);
		if (saved !== undefined && saved > 0) {
			node.currentTime = Math.min(saved, Number.isFinite(node.duration) ? node.duration : saved);
			elapsed = node.currentTime;
			node.pause();
			return;
		}
		void node.play().then(() => {
			if (!node.isConnected) node.pause();
		}).catch(() => {
			paused = true;
		});
	}

	function trackVideo(event: Event) {
		const node = event.currentTarget;
		if (!(node instanceof HTMLVideoElement)) return;
		elapsed = node.currentTime;
		duration = node.duration || 0;
	}

	function togglePlayback() {
		if (!video) return;
		if (video.paused) {
			void video.play().catch(() => {
				paused = true;
			});
			return;
		}
		video.pause();
	}

	function seekBy(delta: number) {
		if (!video) return;
		const limit = Number.isFinite(video.duration) ? video.duration : 0;
		video.currentTime = Math.min(limit, Math.max(0, video.currentTime + delta));
		elapsed = video.currentTime;
		savePosition(post.id, video.currentTime);
	}

	function seekTo(event: Event) {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement)) return;
		seekBy(Number(input.value) - (video?.currentTime ?? 0));
	}

	function setVolume(event: Event) {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement) || !video) return;
		video.volume = Number(input.value);
		video.muted = video.volume === 0;
		volume = video.volume;
		muted = video.muted;
		writePlaybackPreference(video.volume, video.muted);
	}

	function toggleMute() {
		if (!video) return;
		video.muted = !video.muted;
		muted = video.muted;
		writePlaybackPreference(video.volume, video.muted);
	}

	function onVideoClick() {
		window.clearTimeout(clickTimer);
		clickTimer = window.setTimeout(() => {
			clickTimer = 0;
			togglePlayback();
		}, 250);
	}

	function onVideoDoubleClick(event: MouseEvent) {
		window.clearTimeout(clickTimer);
		clickTimer = 0;
		event.preventDefault();
		toggleFullscreen();
	}

	function onwheel(event: WheelEvent) {
		if (post.kind === 'video') return;
		if (!event.ctrlKey && !event.metaKey) return;
		event.preventDefault();
		remember(wheelZoom(zoom, image, area(), localPoint(event), event.deltaY));
	}

	function ondblclick(event: MouseEvent) {
		const next = doubleClickZoom(zoom, image, area(), localPoint(event));
		const baseline = initialScale(image, area());
		if (next.scale <= baseline + 1e-4 && next.x === 0 && next.y === 0) {
			manualZoom = null;
			manualId = '';
			return;
		}
		remember(next);
	}

	function startDrag(event: PointerEvent) {
		if (event.button !== 0) return;
		dragging = true;
		dragAt = { x: event.clientX, y: event.clientY };
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function drag(event: PointerEvent) {
		if (!dragging) return;
		const dx = event.clientX - dragAt.x;
		const dy = event.clientY - dragAt.y;
		dragAt = { x: event.clientX, y: event.clientY };
		const next = panBy(zoom, image, area(), dx, dy);
		if (next.x === zoom.x && next.y === zoom.y) return;
		remember(next);
	}

	function endDrag() {
		dragging = false;
	}

	function viewerRoot(node: HTMLElement) {
		root = node;
		return () => {
			if (root === node) root = null;
		};
	}

	function postBody() {
		return {
			remoteId: post.id,
			tags: post.tags,
			width: post.width,
			height: post.height,
			mediaRef: post.mediaRef,
			...(post.rating ? { rating: post.rating } : {})
		};
	}

	async function favorite() {
		await fetch('/api/library/favorites', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(postBody())
		});
	}

	async function downloadOriginal() {
		const response = await fetch(`/api/media/${post.mediaRef}?download=1`);
		if (!response.ok) return;
		const blob = await response.blob();
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		const match = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '');
		link.href = url;
		link.download = match?.[1] || 'original';
		document.body.append(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(url);
	}

	async function addToAlbum() {
		const name = albumName.trim();
		if (!name) return;
		const created = await fetch('/api/library/albums', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name })
		});
		if (!created.ok) return;
		const body = (await created.json()) as { data: { id: string } };
		await fetch(`/api/library/albums/${body.data.id}/items`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(postBody())
		});
	}
</script>

<svelte:window {onkeydown} />

	<div
	class="viewer"
	{@attach viewerRoot}
	{@attach neighborPrefetch(sequence, post.id, direction)}
	bind:clientWidth={viewportWidth}
	bind:clientHeight={viewportHeight}
	onwheel={onwheel}
>
	<img class="backdrop" src={`/api/media/${post.mediaRef}?recipe=backdrop`} alt="" />
	{#if playableVideo}
		{#key post.id}
			<div class="player">
				<video
					class="full"
					src={`/api/media/${post.mediaRef}`}
					poster={`/api/media/${post.mediaRef}?recipe=display`}
					aria-label={post.tags.join(' ')}
					data-post={post.id}
					loop
					playsinline
					{@attach videoElement}
					onclick={onVideoClick}
					ondblclick={onVideoDoubleClick}
					onplay={() => (paused = false)}
					onpause={() => (paused = true)}
					onloadedmetadata={prepareVideo}
					ontimeupdate={trackVideo}
					onerror={(event) => {
						const node = event.currentTarget;
						if (node instanceof HTMLVideoElement && node.dataset.post === post.id) loadedId = post.id;
					}}
				>
					<track kind="captions" label="Captions" srclang="en" src="data:text/vtt,WEBVTT" />
				</video>
				<div class="bar">
					<button type="button" onclick={togglePlayback}>{paused ? 'Play' : 'Pause'}</button>
					<input
						aria-label="Timeline"
						type="range"
						min="0"
						max={duration || 0}
						step="0.1"
						value={elapsed}
						oninput={seekTo}
					/>
					<span>{clock(elapsed)} / {clock(duration)}</span>
					<button type="button" onclick={toggleMute}>{muted ? 'Unmute' : 'Mute'}</button>
					<input
						aria-label="Volume"
						type="range"
						min="0"
						max="1"
						step="0.01"
						value={volume}
						oninput={setVolume}
					/>
				</div>
			</div>
		{/key}
	{:else if unsupportedVideo}
		<p class="unsupported">This file can't be played in the viewer.</p>
	{:else}
		{#key post.id}
			<div
				class={['stage', { pannable: canPan, grabbing: dragging }]}
				role="application"
				aria-label="Artwork"
				data-scale={zoom.scale}
				data-x={zoom.x}
				data-y={zoom.y}
				style:left="{left}px"
				style:top="{top}px"
				style:width="{image.width}px"
				style:height="{image.height}px"
				style:transform="scale({zoom.scale})"
				onpointerdown={startDrag}
				onpointermove={drag}
				onpointerup={endDrag}
				onpointercancel={endDrag}
				ondblclick={ondblclick}
			>
				<img
					class="full"
					src={foreground}
					alt={post.tags.join(' ')}
					data-post={post.id}
					draggable="false"
					onload={markLoaded}
					onerror={markLoaded}
				/>
			</div>
		{/key}
	{/if}
	{#if loading}
		<p class="loading">Loading</p>
	{/if}
	<button class="previous" type="button" disabled={index <= 0} onclick={() => move(-1)}>Previous post</button>
	<button class="next" type="button" disabled={index < 0 || index >= sequence.length - 1} onclick={() => move(1)}>Next post</button>
	<button class="back" type="button" onclick={onclose}>Back</button>
	<button class="download" type="button" onclick={downloadOriginal}>Download</button>
	<button class="favorite" type="button" onclick={favorite}>Favorite</button>
	<button class="tags" type="button" onclick={() => (tagsOpen = !tagsOpen)}>Show tags</button>
	{#if tagsOpen}
		<ul aria-label="Post tags">
			{#each post.tags as tag (tag)}
				<li><button type="button" onclick={(event) => ontag(tag, event)}>{tag}</button></li>
			{/each}
		</ul>
	{/if}
	<div
		class="resize"
		role="separator"
		aria-orientation="vertical"
		aria-label="Resize details"
	></div>
	<div
		class="edge-left"
		role="region"
		aria-label="Sidebar edge"
		onpointerenter={() => (viewerChrome.edge = true)}
	></div>
	<div class="album-add">
		<label>
			Album name
			<input bind:value={albumName} />
		</label>
		<button type="button" onclick={addToAlbum}>Add to album</button>
	</div>
</div>

<style>
	.viewer {
		position: fixed;
		inset: 0;
		z-index: 20;
		background: #000;
		overflow: hidden;
	}

	.backdrop {
		position: absolute;
		inset: -55px;
		width: calc(100% + 110px);
		height: calc(100% + 110px);
		max-width: none;
		object-fit: cover;
		filter: blur(46px) brightness(0.23);
		pointer-events: none;
	}

	.stage {
		position: absolute;
		z-index: 1;
		transform-origin: 0 0;
		touch-action: none;
		user-select: none;
	}

	.stage.pannable {
		cursor: grab;
	}

	.stage.grabbing {
		cursor: grabbing;
	}

	.player {
		position: absolute;
		z-index: 1;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.player .full {
		width: auto;
		height: auto;
		max-width: 100%;
		max-height: calc(100% - 84px);
		object-fit: contain;
		pointer-events: auto;
	}

	.bar {
		position: absolute;
		z-index: 8;
		right: 24px;
		bottom: 18px;
		left: 24px;
		display: flex;
		gap: 12px;
		align-items: center;
		color: #dddde3;
	}

	.bar input[aria-label='Timeline'] {
		flex: 1;
	}

	.unsupported {
		position: absolute;
		z-index: 2;
		top: 50%;
		left: 50%;
		margin: 0;
		color: #dddde3;
		transform: translate(-50%, -50%);
	}

	.loading {
		position: absolute;
		z-index: 4;
		top: 50%;
		left: 50%;
		margin: 0;
		color: #dddde3;
		transform: translate(-50%, -50%);
	}

	.previous,
	.next {
		position: absolute;
		z-index: 8;
		top: 50%;
	}

	.previous {
		left: 18px;
	}

	.next {
		right: 18px;
	}

	.full {
		display: block;
		width: 100%;
		height: 100%;
		max-width: none;
		max-height: none;
		object-fit: fill;
		pointer-events: none;
	}

	.back,
	.tags,
	.favorite,
	.download {
		position: absolute;
		z-index: 8;
		top: 18px;
	}

	.download {
		right: 220px;
		color: #dddde3;
	}

	.back {
		left: 20px;
	}

	.favorite {
		right: 124px;
	}

	.tags {
		right: 18px;
	}

	ul {
		position: absolute;
		z-index: 8;
		top: 70px;
		right: 18px;
		width: 240px;
		margin: 0;
		padding: 12px;
		list-style: none;
		background: #14171bf2;
		border: 1px solid #ffffff12;
		border-radius: 14px;
	}

	.resize {
		position: absolute;
		z-index: 8;
		top: 82px;
		right: 292px;
		bottom: 18px;
		width: 8px;
		cursor: ew-resize;
	}

	.edge-left {
		position: absolute;
		z-index: 80;
		top: 0;
		bottom: 0;
		left: 0;
		width: 28px;
	}

	.album-add {
		position: absolute;
		z-index: 8;
		left: 36px;
		bottom: 18px;
		display: flex;
		gap: 8px;
		align-items: end;
	}

	.album-add label {
		color: #dddde3;
	}
</style>
