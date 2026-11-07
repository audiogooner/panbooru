export const CONTAIN_MIN_WIDTH = 1920;
export const CONTAIN_MIN_HEIGHT = 1080;
export const MAX_SCALE = 8;
const DISPLAY_WIDTH = 1920;
const DISPLAY_HEIGHT = 1080;

export type Size = { width: number; height: number };
export type Point = { x: number; y: number };
export type Zoom = { scale: number; x: number; y: number };

export function initialScale(image: Size, area: Size) {
	const contain = Math.min(area.width / image.width, area.height / image.height);
	if (image.width >= CONTAIN_MIN_WIDTH || image.height >= CONTAIN_MIN_HEIGHT) return contain;
	return Math.min(1, contain);
}

export function initialZoom(image: Size, area: Size): Zoom {
	return { scale: initialScale(image, area), x: 0, y: 0 };
}

export function imageCoordinate(zoom: Zoom, image: Size, area: Size, pointer: Point) {
	const left = area.width / 2 + zoom.x - (image.width * zoom.scale) / 2;
	const top = area.height / 2 + zoom.y - (image.height * zoom.scale) / 2;
	return { x: (pointer.x - left) / zoom.scale, y: (pointer.y - top) / zoom.scale };
}

export function zoomAt(zoom: Zoom, image: Size, area: Size, pointer: Point, scale: number) {
	const next = clamp(scale, initialScale(image, area), MAX_SCALE);
	const point = imageCoordinate(zoom, image, area, pointer);
	const left = pointer.x - point.x * next;
	const top = pointer.y - point.y * next;
	return place(image, area, next, left + (image.width * next) / 2, top + (image.height * next) / 2);
}

export function doubleClickZoom(zoom: Zoom, image: Size, area: Size, pointer: Point) {
	const baseline = initialScale(image, area);
	if (zoom.scale > baseline + 1e-6) return initialZoom(image, area);
	return zoomAt(zoom, image, area, pointer, baseline >= 1 ? baseline * 2 : 1);
}

export function panBy(zoom: Zoom, image: Size, area: Size, dx: number, dy: number) {
	const scale = clamp(zoom.scale, initialScale(image, area), MAX_SCALE);
	return place(image, area, scale, area.width / 2 + zoom.x + dx, area.height / 2 + zoom.y + dy);
}

export function wheelZoom(zoom: Zoom, image: Size, area: Size, pointer: Point, deltaY: number) {
	return zoomAt(zoom, image, area, pointer, zoom.scale * Math.exp(-deltaY * 0.002));
}

export function retainZoom(zoom: Zoom, image: Size, area: Size) {
	return place(image, area, Math.min(MAX_SCALE, zoom.scale), area.width / 2 + zoom.x, area.height / 2 + zoom.y);
}

export function needsOriginal(image: Size, scale: number) {
	const factor = Math.min(1, DISPLAY_WIDTH / image.width, DISPLAY_HEIGHT / image.height);
	const width = image.width * factor;
	const height = image.height * factor;
	return scale * image.width > width + 0.5 || scale * image.height > height + 0.5;
}

function place(image: Size, area: Size, scale: number, centerX: number, centerY: number): Zoom {
	const limitX = Math.max(0, (image.width * scale - area.width) / 2);
	const limitY = Math.max(0, (image.height * scale - area.height) / 2);
	return {
		scale,
		x: clamp(centerX - area.width / 2, -limitX, limitX),
		y: clamp(centerY - area.height / 2, -limitY, limitY)
	};
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}
