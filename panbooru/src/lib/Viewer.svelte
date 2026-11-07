<script lang="ts">
	import Icon from '#lib/Icon.svelte';
	import AlbumPicker from '#lib/AlbumPicker.svelte';
	import type { DragPost } from '#lib/selection.svelte.ts';
	import { editingText, matchesShortcut } from '#lib/shortcuts.ts';
	import type { ExplorationPost } from '#lib/navigation.ts';
	import { playable } from '#lib/playable.ts';
	import {
		readPlaybackPreference,
		savePosition,
		savedPosition,
		writePlaybackPreference
	} from '#lib/playback.ts';
	import { neighborPrefetch, withRecipe } from '#lib/prefetch.ts';
	import { ensureTagMeta, missingTagNames, readTagMeta, type TagMeta } from '#lib/tag-meta.ts';
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

	const DETAILS_MIN = 160;
	const DETAILS_MAX = 560;
	const DETAILS_PANEL = 282;
	const tagGroups = [
		['artist', 'Artist'],
		['character', 'Character'],
		['copyright', 'Copyright'],
		['metadata', 'Metadata'],
		['general', 'General'],
		['deprecated', 'Deprecated']
	] as const;
	const ratingLabels: Record<string, string> = {
		g: 'General',
		s: 'Sensitive',
		q: 'Questionable',
		e: 'Explicit',
		general: 'General',
		sensitive: 'Sensitive',
		questionable: 'Questionable',
		explicit: 'Explicit'
	};

	type TagCategory = (typeof tagGroups)[number][0];
	let {
		post,
		posts = [],
		onclose,
		ontag,
		onmove,
		collection = 'remote',
		albumId = '',
		imageSrc = '',
		onremoved
	}: {
		post: ExplorationPost;
		posts?: ExplorationPost[];
		onclose: () => void;
		ontag: (
			tag: string,
			event: {
				shiftKey: boolean;
				metaKey: boolean;
				ctrlKey: boolean;
				altKey: boolean;
				button?: number;
			},
			anchor?: HTMLElement
		) => void;
		onmove: (id: string) => void;
		collection?: 'remote' | 'favorite' | 'album';
		albumId?: string;
		imageSrc?: string;
		onremoved?: (id: string) => void;
	} = $props();
	let tagsOpen = $state(false);
	let detailsWidth = $state(DETAILS_PANEL);
	let albumPickerFor = $state<string | null>(null);
	let root = $state<HTMLElement | null>(null);
	let viewportWidth = $state(1);
	let viewportHeight = $state(1);
	let manualZoom = $state<Zoom | null>(null);
	let manualId = $state('');
	let dragging = $state(false);
	let dragAt = { x: 0, y: 0 };
	let direction = $state(1);
	let loadedId = $state('');
	let previewId = $state('');
	let paused = $state(true);
	let elapsed = $state(0);
	let duration = $state(0);
	let volume = $state(1);
	let muted = $state(false);
	let chromeHidden = $state(false);
	let zoomShown = $state(false);
	let favoriteFor = $state('');
	let favoriteItemId = $state('');
	let departing = $state<{ src: string } | null>(null);
	// Last painted still image; stays on screen while the next post loads so navigation never flashes black.
	let held = $state.raw<{
		id: string;
		src: string;
		backdrop: string;
		width: number;
		height: number;
		left: number;
		top: number;
		scale: number;
	} | null>(null);
	let tagMeta = $state<Record<string, TagMeta>>({});
	let tagMetaPost = $state('');
	let clickTimer = 0;
	let chromeTimer = 0;
	let zoomTimer = 0;
	let alive = true;
	let video: HTMLVideoElement | null = null;

	const image = $derived({ width: Math.max(post.width, 1), height: Math.max(post.height, 1) });
	const manual = $derived(manualZoom !== null && manualId === post.id);
	const frameWidth = $derived(
		Math.max(1, viewportWidth - (manual || !tagsOpen ? 0 : detailsWidth))
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
	const mediaBase = $derived(imageSrc || `/api/media/${post.mediaRef}`);
	const foreground = $derived(
		imageSrc ||
			(needsOriginal(image, zoom.scale) ? mediaBase : withRecipe(mediaBase, 'display'))
	);
	const previewSrc = $derived(withRecipe(mediaBase, 'thumb'));
	// Library originals only serve thumb derivatives; remote media has recipe=backdrop.
	const blurBackdrop = $derived(
		imageSrc ? withRecipe(mediaBase, 'thumb') : withRecipe(mediaBase, 'backdrop')
	);
	const dragPost = $derived<DragPost>({
		remoteId: post.id,
		tags: post.tags,
		width: post.width,
		height: post.height,
		...(imageSrc ? { itemId: post.id } : { mediaRef: post.mediaRef }),
		...(post.rating ? { rating: post.rating } : {})
	});
	const playableVideo = $derived(post.kind === 'video' && playable(post.mediaType ?? ''));
	const unsupportedVideo = $derived(post.kind === 'video' && !playable(post.mediaType ?? ''));
	const sequence = $derived(posts.length ? posts : [post]);
	const index = $derived(sequence.findIndex((item) => item.id === post.id));
	const loading = $derived(!unsupportedVideo && loadedId !== post.id);
	const showPreview = $derived(loading && previewSrc !== foreground);
	const previewReady = $derived(previewId === post.id);
	const ghost = $derived(loading && held && held.id !== post.id ? held : null);
	const canPan = $derived(
		image.width * zoom.scale > (manual ? viewportWidth : frameWidth) + 0.5 ||
			image.height * zoom.scale > viewportHeight + 0.5
	);
	const sourcePage = $derived(
		`https://gelbooru.com/index.php?page=post&s=view&id=${encodeURIComponent(post.id)}`
	);
	const ratingLabel = $derived(
		post.rating ? (ratingLabels[post.rating.toLowerCase()] ?? post.rating) : '—'
	);
	const zoomPercent = $derived(`${Math.round(zoom.scale * 100)}%`);
	const albumPickerOpen = $derived(albumPickerFor === post.id);
	const hearted = $derived(favoriteFor === post.id && favoriteItemId !== '');
	const groupedTags = $derived.by(() => {
		const known = tagMetaPost === post.id ? tagMeta : {};
		const buckets: Partial<Record<TagCategory, { name: string; count: number | null }[]>> = {};
		for (const name of post.tags) {
			const raw = known[name]?.category;
			const category: TagCategory = tagGroups.some(([entry]) => entry === raw)
				? (raw as TagCategory)
				: 'general';
			const countValue = known[name]?.count;
			const count =
				typeof countValue === 'number' && Number.isFinite(countValue) ? countValue : null;
			const row = { name, count };
			const list = buckets[category];
			if (list) list.push(row);
			else buckets[category] = [row];
		}
		return tagGroups.flatMap(([category, label]) => {
			const tags = buckets[category];
			if (!tags?.length) return [];
			tags.sort((a, b) => a.name.localeCompare(b.name));
			return [{ category, label, tags }];
		});
	});

	function area() {
		return manual
			? { width: viewportWidth, height: viewportHeight }
			: { width: frameWidth, height: viewportHeight };
	}

	function remember(next: Zoom, announce = false) {
		if (manual) manualZoom = next;
		else {
			manualZoom = {
				scale: next.scale,
				x: frameWidth / 2 + next.x - viewportWidth / 2,
				y: next.y
			};
		}
		manualId = post.id;
		if (announce) flashZoom();
	}

	function flashZoom() {
		zoomShown = true;
		window.clearTimeout(zoomTimer);
		zoomTimer = window.setTimeout(() => {
			if (alive) zoomShown = false;
		}, 900);
	}

	function revealChrome() {
		chromeHidden = false;
		window.clearTimeout(chromeTimer);
		chromeTimer = window.setTimeout(() => {
			if (!alive || albumPickerOpen) return;
			const active = document.activeElement;
			if (
				active instanceof HTMLElement &&
				root?.contains(active) &&
				active.closest('button, a, input, textarea, [role="separator"]')
			) {
				return;
			}
			chromeHidden = true;
		}, 2200);
	}

	function hideChrome() {
		chromeHidden = true;
		window.clearTimeout(chromeTimer);
	}

	function localPoint(event: { clientX: number; clientY: number }) {
		const rect = root?.getBoundingClientRect();
		return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
	}

	function typing(event: KeyboardEvent) {
		const target = event.target;
		return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
	}

	function plainKey(event: KeyboardEvent, key: string) {
		return (
			!event.repeat &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.altKey &&
			!event.shiftKey &&
			event.key.toLowerCase() === key
		);
	}

	function tagAnchor(event: Event) {
		return event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined;
	}

	function onTagKey(tag: string, event: KeyboardEvent) {
		if (event.key !== 'Enter' || event.altKey || event.repeat) return;
		event.preventDefault();
		event.stopPropagation();
		ontag(tag, event, tagAnchor(event));
	}

	function onTagAux(tag: string, event: MouseEvent) {
		if (event.button !== 1) return;
		event.preventDefault();
		ontag(tag, event, tagAnchor(event));
	}

	function resizeDetails(event: KeyboardEvent) {
		if (typing(event)) return;
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		event.stopPropagation();
		const delta = event.key === 'ArrowRight' ? 16 : -16;
		detailsWidth = Math.min(DETAILS_MAX, Math.max(DETAILS_MIN, detailsWidth + delta));
	}

	function toggleAlbumPicker() {
		albumPickerFor = albumPickerOpen ? null : post.id;
		revealChrome();
	}

	function onViewerClick(event: MouseEvent) {
		const target = event.target;
		if (!(target instanceof Element)) return;
		if (!target.closest('.album-picker, [data-album-picker]')) albumPickerFor = null;
	}

	function startResize(event: PointerEvent) {
		if (event.button !== 0) return;
		const handle = event.currentTarget;
		if (!(handle instanceof HTMLElement)) return;
		event.preventDefault();
		handle.setPointerCapture(event.pointerId);
		const originX = event.clientX;
		const origin = detailsWidth;
		const drag = (moveEvent: PointerEvent) => {
			detailsWidth = Math.min(
				DETAILS_MAX,
				Math.max(DETAILS_MIN, origin + originX - moveEvent.clientX)
			);
		};
		const stop = () => {
			handle.removeEventListener('pointermove', drag);
			handle.removeEventListener('pointerup', stop);
			handle.removeEventListener('pointercancel', stop);
		};
		handle.addEventListener('pointermove', drag);
		handle.addEventListener('pointerup', stop);
		handle.addEventListener('pointercancel', stop);
	}

	function toggleDetails() {
		tagsOpen = !tagsOpen;
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			if (albumPickerOpen) {
				event.preventDefault();
				albumPickerFor = null;
				return;
			}
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
		if (
			(event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
			event.target instanceof HTMLElement &&
			event.target.getAttribute('role') === 'separator'
		) {
			return;
		}
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
		if (plainKey(event, 'i')) {
			event.preventDefault();
			toggleDetails();
		}
		if (matchesShortcut(event, 'favorite')) {
			event.preventDefault();
			void favorite();
		}
		if (matchesShortcut(event, 'album')) {
			event.preventDefault();
			toggleAlbumPicker();
		}
		if (matchesShortcut(event, 'remove')) {
			event.preventDefault();
			void removeDisplayed();
		}
		if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') {
			event.preventDefault();
			move(-1, true);
		}
		if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') {
			event.preventDefault();
			move(1, true);
		}
	}

	async function removeDisplayed() {
		if (collection === 'remote' || editingText(document.activeElement)) return;
		const outgoing = foreground;
		const id = post.id;
		departing = { src: outgoing };
		const path =
			collection === 'album'
				? `/api/library/albums/${encodeURIComponent(albumId)}/items/${encodeURIComponent(id)}`
				: `/api/library/favorites/${encodeURIComponent(id)}`;
		const response = await fetch(path, { method: 'DELETE' });
		if (!response.ok) {
			departing = null;
			return;
		}
		held = null;
		onremoved?.(id);
		window.setTimeout(() => {
			if (departing?.src === outgoing) departing = null;
		}, 480);
		const next = sequence[index + 1] ?? sequence[index - 1];
		if (next && next.id !== id) onmove(next.id);
		else onclose();
	}

	function move(delta: number, keyboard = false) {
		const next = sequence[index + delta];
		if (!next) return;
		direction = delta;
		albumPickerFor = null;
		if (keyboard) hideChrome();
		onmove(next.id);
	}

	function decodeUrl(src: string) {
		return new Promise<void>((resolve) => {
			const probe = new Image();
			probe.decoding = 'async';
			probe.onload = () => resolve();
			probe.onerror = () => resolve();
			probe.src = src;
			if (probe.complete) resolve();
		});
	}

	function markLoaded(event: Event) {
		const image = event.currentTarget;
		if (!(image instanceof HTMLImageElement) || image.dataset.post !== post.id) return;
		const id = post.id;
		const backdrop = blurBackdrop;
		void (async () => {
			await decodeUrl(backdrop);
			if (image.dataset.post !== id || post.id !== id) return;
			loadedId = id;
			if (image.complete && image.naturalWidth > 0) {
				held = {
					id,
					src: foreground,
					backdrop,
					width: Math.max(post.width, 1),
					height: Math.max(post.height, 1),
					left,
					top,
					scale: zoom.scale
				};
			}
		})();
	}

	function markPreview(event: Event) {
		const image = event.currentTarget;
		if (!(image instanceof HTMLImageElement) || image.dataset.post !== post.id) return;
		previewId = post.id;
	}

	function watchPreview(img: HTMLImageElement) {
		void previewSrc;
		if (img.complete && img.naturalWidth > 0 && img.dataset.post === post.id) {
			previewId = post.id;
		}
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
		held = null;
		const saved = savedPosition(post.id);
		if (saved !== undefined && saved > 0) {
			node.currentTime = Math.min(saved, Number.isFinite(node.duration) ? node.duration : saved);
			elapsed = node.currentTime;
			node.pause();
			return;
		}
		void node
			.play()
			.then(() => {
				if (!node.isConnected) node.pause();
			})
			.catch(() => {
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
		remember(wheelZoom(zoom, image, area(), localPoint(event), event.deltaY), true);
	}

	function ondblclick(event: MouseEvent) {
		const next = doubleClickZoom(zoom, image, area(), localPoint(event));
		const baseline = initialScale(image, area());
		if (next.scale <= baseline + 1e-4 && next.x === 0 && next.y === 0) {
			manualZoom = null;
			manualId = '';
			flashZoom();
			return;
		}
		remember(next, true);
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
			alive = false;
			window.clearTimeout(chromeTimer);
			window.clearTimeout(zoomTimer);
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
		const id = post.id;
		const payload = postBody();
		if (favoriteFor === id && favoriteItemId) {
			const response = await fetch(`/api/library/favorites/${encodeURIComponent(favoriteItemId)}`, {
				method: 'DELETE'
			});
			if (!response.ok || post.id !== id) return;
			favoriteFor = '';
			favoriteItemId = '';
			return;
		}
		const response = await fetch('/api/library/favorites', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		});
		if (!response.ok || post.id !== id) return;
		const body = (await response.json().catch(() => null)) as {
			data?: { itemId?: string };
		} | null;
		const itemId = body?.data?.itemId;
		if (!itemId || post.id !== id) return;
		favoriteFor = id;
		favoriteItemId = itemId;
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

	async function lookupTags(id: string, names: string[], signal: AbortSignal) {
		await ensureTagMeta(names, signal);
		if (signal.aborted || post.id !== id) return;
		tagMeta = readTagMeta(names);
		tagMetaPost = id;
	}

	function trackTags() {
		const id = post.id;
		const names = post.tags;
		// Seed from the session cache so known tags regroup immediately.
		tagMeta = readTagMeta(names);
		tagMetaPost = id;
		if (missingTagNames(names).length === 0) return;
		const controller = new AbortController();
		void lookupTags(id, names, controller.signal);
		return () => controller.abort();
	}
</script>

<svelte:window
	{onkeydown}
	onpointermove={revealChrome}
	onfocusin={revealChrome}
	onclick={onViewerClick}
/>

<div
	class={[
		'viewer',
		{
			'panel-open': tagsOpen,
			'image-over-info': manual,
			'hide-controls': chromeHidden
		}
	]}
	style:--view-right={tagsOpen ? `${detailsWidth}px` : '0px'}
	{@attach viewerRoot}
	{@attach neighborPrefetch(sequence, post.id, direction)}
	bind:clientWidth={viewportWidth}
	bind:clientHeight={viewportHeight}
	{onwheel}
>
	<img class="backdrop" src={ghost?.backdrop ?? blurBackdrop} alt="" aria-hidden="true" />
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
						if (node instanceof HTMLVideoElement && node.dataset.post === post.id)
							loadedId = post.id;
					}}
				>
					<track kind="captions" label="Captions" srclang="en" src="data:text/vtt,WEBVTT" />
				</video>
				<div class="bar glass">
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
		{#if ghost}
			<div
				class="stage held"
				aria-hidden="true"
				style:left="{ghost.left}px"
				style:top="{ghost.top}px"
				style:width="{ghost.width}px"
				style:height="{ghost.height}px"
				style:transform="scale({ghost.scale})"
			>
				<img class="full" src={ghost.src} alt="" draggable="false" />
			</div>
		{/if}
		{#key post.id}
			<div
				class={[
					'stage',
					{
						pannable: canPan,
						grabbing: dragging,
						ready: !loading,
						previewed: showPreview && previewReady
					}
				]}
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
				{ondblclick}
			>
				{#if showPreview}
					<img
						class="full preview"
						src={previewSrc}
						alt=""
						aria-hidden="true"
						data-post={post.id}
						draggable="false"
						{@attach watchPreview}
						onload={markPreview}
						onerror={markPreview}
					/>
				{/if}
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
	<!-- Wave 3 adds class "leaving" and the outgoing image to play the downward fade. -->
	<div
		class={['departure', departing && 'leaving']}
		data-departure="downward-fade"
		aria-hidden="true"
	>
		{#if departing}<img src={departing.src} alt="" />{/if}
	</div>
	{#if loading}
		<p class="loading">Loading</p>
	{/if}
	<div class="edge-zone previous-zone"></div>
	<div class="edge-zone next-zone"></div>
	<button
		class="previous edge-button glass"
		type="button"
		aria-label="Previous post"
		title="Previous · ← / A"
		disabled={index <= 0}
		onclick={() => move(-1)}
	>
		<Icon name="left" />
	</button>
	<button
		class="next edge-button glass"
		type="button"
		aria-label="Next post"
		title="Next · → / D"
		disabled={index < 0 || index >= sequence.length - 1}
		onclick={() => move(1)}
	>
		<Icon name="right" />
	</button>
	<button
		class="back glass"
		type="button"
		aria-label="Back"
		title="Back to gallery · Escape"
		onclick={onclose}
	>
		<Icon name="left" />
	</button>
	<div class="viewer-bar glass">
		<button
			type="button"
			aria-label="Album selector"
			aria-pressed={albumPickerOpen}
			title="Album selector · S"
			data-album-picker={albumPickerOpen ? 'open' : 'closed'}
			onclick={toggleAlbumPicker}
		>
			<Icon name="book-image" />
		</button>
		<button
			type="button"
			class={{ hearted }}
			aria-label="Favorite"
			aria-pressed={hearted}
			title="Favorite · W"
			onclick={favorite}
		>
			<Icon name="heart" />
		</button>
		<button
			type="button"
			aria-label="Download"
			title="Download original"
			onclick={downloadOriginal}
		>
			<Icon name="download" />
		</button>
		<a
			href={sourcePage}
			target="_blank"
			rel="noopener noreferrer"
			aria-label="Gelbooru page"
			title="Open Gelbooru page"
		>
			<Icon name="external" />
		</a>
		<button type="button" aria-label="Fullscreen" title="Fullscreen · F" onclick={toggleFullscreen}>
			<Icon name="full" />
		</button>
		<button
			type="button"
			aria-label="Show tags"
			aria-pressed={tagsOpen}
			title="Details and tags · I"
			onclick={toggleDetails}
		>
			<Icon name="panel" />
		</button>
	</div>
	<div class="album-picker popup" data-album-picker-panel="hook" hidden={!albumPickerOpen}>
		<h3>Albums</h3>
		{#if albumPickerOpen}
			{#key post.id}
				<AlbumPicker posts={[dragPost]} />
			{/key}
		{/if}
	</div>
	{#if tagsOpen}
		<aside class="right-panel">
			{#key post.id}
				<div class="right-scroll" {@attach trackTags}>
					<div class="details glass">
						<div class="details-grid">
							<div>
								<span>Resolution</span>
								<strong>{post.width} × {post.height}</strong>
							</div>
							<div>
								<span>File size</span>
								<strong>—</strong>
							</div>
							<div>
								<span>Rating</span>
								<strong>{ratingLabel}</strong>
							</div>
							<div>
								<span>Score</span>
								<strong>—</strong>
							</div>
							<div>
								<span>Original post</span>
								<a href={sourcePage} target="_blank" rel="noopener noreferrer">Gelbooru</a>
							</div>
						</div>
					</div>
					<div class="tags-card glass">
						<ul aria-label="Post tags">
							{#each groupedTags as group (group.category)}
								<li class="tag-group">
									<h3>{group.label}</h3>
									<ul>
										{#each group.tags as tag (tag.name)}
											<li>
												<button
													type="button"
													class="tag-row"
													aria-label={tag.name}
													onclick={(event) => ontag(tag.name, event, tagAnchor(event))}
													onauxclick={(event) => onTagAux(tag.name, event)}
													onkeydown={(event) => onTagKey(tag.name, event)}
												>
													<span class={group.category}>{tag.name.replaceAll('_', ' ')}</span>
													{#if tag.count !== null}
														<small aria-hidden="true">{tag.count}</small>
													{/if}
												</button>
											</li>
										{/each}
									</ul>
								</li>
							{/each}
						</ul>
					</div>
				</div>
			{/key}
			<!-- After the tags in source order. Firefox will not Tab out of this fixed viewer to reach an earlier stop, and the background toast sits later in the document. Absolute positioning keeps the handle on the panel edge. -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div
				class="resize"
				role="separator"
				tabindex="0"
				aria-orientation="vertical"
				aria-label="Resize details"
				aria-valuemin={DETAILS_MIN}
				aria-valuemax={DETAILS_MAX}
				aria-valuenow={detailsWidth}
				onkeydown={resizeDetails}
				onpointerdown={startResize}
			></div>
		</aside>
	{/if}
	<p class={['zoom-readout', { visible: zoomShown }]} aria-hidden="true">{zoomPercent}</p>
</div>

<style>
	.viewer {
		position: fixed;
		inset: 0;
		z-index: 20;
		overflow: hidden;
		background: #000;
		color: #dddde3;
	}

	.backdrop {
		position: absolute;
		inset: -55px;
		width: calc(100% + 110px);
		height: calc(100% + 110px);
		max-width: none;
		object-fit: cover;
		filter: blur(46px) brightness(0.23) saturate(0.7);
		transform: scale(1.08);
		pointer-events: none;
	}

	.stage {
		position: absolute;
		z-index: 1;
		transform-origin: 0 0;
		touch-action: none;
		user-select: none;
		visibility: hidden;
	}

	.stage.ready,
	.stage.held,
	.stage.previewed {
		visibility: visible;
	}

	.stage.held {
		pointer-events: none;
	}

	.stage .preview {
		position: absolute;
		inset: 0;
	}

	.stage.pannable {
		cursor: grab;
	}

	.stage.grabbing {
		cursor: grabbing;
	}

	.viewer.hide-controls .stage {
		cursor: none;
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
		padding: 8px 12px;
		border-radius: 14px;
		color: #dddde3;
		transition: opacity 0.2s;
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
		pointer-events: none;
		transform: translate(-50%, -50%);
		/* Stay invisible for fast loads so cached switches never flash the label. */
		animation: viewer-loading 0.15s linear 220ms backwards;
	}

	@keyframes viewer-loading {
		from {
			opacity: 0;
		}
	}

	.departure {
		position: absolute;
		z-index: 2;
		inset: 0;
		transform-origin: 50% 65%;
		pointer-events: none;
		opacity: 0;
	}

	.departure img {
		position: absolute;
		inset: 0;
		max-width: 100%;
		max-height: calc(100% - 84px);
		margin: auto;
		object-fit: contain;
	}

	.departure.leaving {
		animation: viewer-depart 480ms cubic-bezier(0.2, 0.65, 0.3, 1) forwards;
	}

	.album-picker {
		position: absolute;
		z-index: 30;
		top: 64px;
		left: 24px;
	}

	@media (prefers-reduced-motion: reduce) {
		.departure.leaving {
			animation: none;
			opacity: 0;
		}
	}

	@keyframes viewer-depart {
		from {
			transform: translateY(0) rotate(0deg) scale(1);
			opacity: 1;
		}

		to {
			transform: translateY(90px) rotate(4deg) scale(0.94);
			opacity: 0;
		}
	}

	.edge-zone {
		position: absolute;
		z-index: 4;
		top: 18%;
		bottom: 18%;
		width: 75px;
	}

	.previous-zone {
		left: 0;
	}

	.next-zone {
		right: var(--view-right);
	}

	.edge-button {
		position: absolute;
		z-index: 81;
		top: calc(50% - 22px);
		display: grid;
		width: 44px;
		height: 44px;
		place-items: center;
		padding: 0;
		border: 0;
		border-radius: 50%;
		color: white;
		pointer-events: auto;
		opacity: 0;
		transition: opacity 0.15s;
	}

	.edge-button:disabled {
		pointer-events: none;
		opacity: 0;
	}

	.previous {
		left: 22px;
	}

	.next {
		right: calc(var(--view-right) + 22px);
	}

	.previous-zone:hover ~ .previous:not(:disabled),
	.previous:hover:not(:disabled),
	.previous:focus-visible:not(:disabled),
	.next-zone:hover ~ .next:not(:disabled),
	.next:hover:not(:disabled),
	.next:focus-visible:not(:disabled) {
		opacity: 1;
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
	.viewer-bar {
		transition: opacity 0.2s;
	}

	.viewer.hide-controls .back,
	.viewer.hide-controls .viewer-bar,
	.viewer.hide-controls .bar {
		pointer-events: none;
		opacity: 0;
	}

	.viewer.hide-controls.panel-open .viewer-bar {
		pointer-events: auto;
		opacity: 1;
	}

	.back {
		position: absolute;
		z-index: 8;
		top: 20px;
		left: 20px;
		display: grid;
		width: 44px;
		height: 44px;
		place-items: center;
		padding: 0;
		border: 0;
		border-radius: 50%;
		color: white;
	}

	.viewer-bar {
		position: absolute;
		z-index: 8;
		top: 8px;
		right: 8px;
		display: flex;
		gap: 2px;
		padding: 5px;
		border-radius: 14px;
	}

	.viewer-bar button,
	.viewer-bar a {
		display: flex;
		width: auto;
		height: auto;
		padding: 10px;
		border: 0;
		border-radius: 9px;
		background: transparent;
		color: white;
		text-decoration: none;
	}

	.viewer-bar button:hover,
	.viewer-bar a:hover {
		background: #ffffff14;
	}

	.viewer-bar button.hearted {
		color: #ff899c;
	}

	.viewer-bar button.hearted :global(svg) {
		fill: currentColor;
	}

	.right-panel {
		position: absolute;
		z-index: 5;
		top: 64px;
		right: 8px;
		bottom: 8px;
		width: calc(var(--view-right) - 8px);
	}

	.right-scroll {
		height: 100%;
		overflow: auto;
		padding-right: 1px;
		scrollbar-width: thin;
	}

	.details,
	.tags-card {
		margin-bottom: 8px;
		padding: 18px;
		border-radius: 14px;
	}

	.details-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 17px;
	}

	.details span {
		display: block;
		margin-bottom: 3px;
		color: #87909d;
		font-size: 10px;
	}

	.details strong {
		font-size: 12px;
		font-weight: 450;
	}

	.details a {
		color: #abbfdc;
		font-size: 12px;
		text-decoration: none;
	}

	.tags-card ul {
		display: grid;
		gap: 0;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tag-group {
		margin-bottom: 12px;
	}

	.tag-group:last-child {
		margin-bottom: 0;
	}

	.tag-group h3 {
		margin: 0 0 5px;
		color: #c6cdd8;
		font-size: 11px;
		font-weight: 650;
	}

	.tag-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 10px;
		width: 100%;
		height: auto;
		padding: 2px 0;
		border: 0;
		background: none;
		line-height: 1.4;
		text-align: left;
	}

	.tag-row span {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.tag-row small {
		flex: none;
		padding-top: 2px;
		color: #6e7887;
		font-size: 10px;
	}

	.tag-row:hover span {
		text-decoration: underline;
	}

	.artist {
		color: var(--red);
	}

	.character {
		color: var(--green);
	}

	.copyright {
		color: var(--pink);
	}

	.metadata {
		color: var(--yellow);
	}

	.general {
		color: var(--blue);
	}

	.deprecated {
		color: #888f99;
	}

	.resize {
		position: absolute;
		z-index: 6;
		top: 0;
		bottom: 0;
		left: -7px;
		width: 8px;
		cursor: ew-resize;
	}

	.zoom-readout {
		position: absolute;
		z-index: 8;
		bottom: 22px;
		left: 50%;
		margin: 0;
		padding: 5px 11px;
		border-radius: 8px;
		background: #14171ba0;
		color: #bbc5d4;
		font-size: 11px;
		pointer-events: none;
		opacity: 0;
		transform: translateX(-50%);
		backdrop-filter: blur(10px);
		transition: opacity 0.15s;
	}

	.zoom-readout.visible {
		opacity: 1;
	}
</style>
