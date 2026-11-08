export type JustifiedItem = { id: string; width: number; height: number };

/** Gap between justified tiles. Gallery CSS uses the same value. */
export const thumbnailGap = 4;

/** Production squircle radius. The corner playground from the prototype is not included. */
export const squircleRadius = 23;

const squircleControl = 0.75;

function round(value: number) {
	return Math.round(value * 100) / 100;
}

/** Squircle outline, using the prototype's cubic control so Firefox can clip without `corner-shape`. */
export function squirclePath(
	width: number,
	height: number,
	radius = squircleRadius,
	ox = 0,
	oy = 0
) {
	const safeWidth = Math.max(width, 0);
	const safeHeight = Math.max(height, 0);
	const r = Math.max(0, Math.min(radius, safeWidth / 2, safeHeight / 2));
	const k = squircleControl;
	return [
		`M ${round(ox + r)} ${round(oy)}`,
		`H ${round(ox + safeWidth - r)}`,
		`C ${round(ox + safeWidth - r * (1 - k))} ${round(oy)} ${round(ox + safeWidth)} ${round(oy + r * (1 - k))} ${round(ox + safeWidth)} ${round(oy + r)}`,
		`V ${round(oy + safeHeight - r)}`,
		`C ${round(ox + safeWidth)} ${round(oy + safeHeight - r * (1 - k))} ${round(ox + safeWidth - r * (1 - k))} ${round(oy + safeHeight)} ${round(ox + safeWidth - r)} ${round(oy + safeHeight)}`,
		`H ${round(ox + r)}`,
		`C ${round(ox + r * (1 - k))} ${round(oy + safeHeight)} ${round(ox)} ${round(oy + safeHeight - r * (1 - k))} ${round(ox)} ${round(oy + safeHeight - r)}`,
		`V ${round(oy + r)}`,
		`C ${round(ox)} ${round(oy + r * (1 - k))} ${round(ox + r * (1 - k))} ${round(oy)} ${round(ox + r)} ${round(oy)}`,
		'Z'
	].join(' ');
}

/** Inset squircle for the favorite stroke, so the stroke sits inside the tile clip. */
export function favoriteOutline(width: number, height: number, radius = squircleRadius) {
	return squirclePath(Math.max(0, width - 2), Math.max(0, height - 2), Math.max(0, radius - 1));
}

/**
 * Selection ring whose outer edge is the same path as the tile clip.
 * Use with `fill-rule="evenodd"` so the inset path cuts the hole.
 */
export function selectionOutline(
	width: number,
	height: number,
	stroke = 3,
	radius = squircleRadius
) {
	const inset = Math.max(0, stroke);
	const outer = squirclePath(width, height, radius);
	const inner = squirclePath(
		Math.max(0, width - inset * 2),
		Math.max(0, height - inset * 2),
		Math.max(0, radius - inset),
		inset,
		inset
	);
	return `${outer} ${inner}`;
}

const gap = thumbnailGap;

export function justifyRows<T extends JustifiedItem>(
	items: T[],
	containerWidth: number,
	targetHeight: number
) {
	const rows: (T & { width: number; height: number })[][] = [];
	let row: T[] = [];
	let ratio = 0;
	for (const item of items) {
		row.push(item);
		ratio += item.width / Math.max(item.height, 1);
		const width = ratio * targetHeight + gap * (row.length - 1);
		if (width >= containerWidth && row.length > 1) {
			const scale = (containerWidth - gap * (row.length - 1)) / ratio;
			rows.push(
				row.map((entry) => ({
					...entry,
					width: (entry.width / Math.max(entry.height, 1)) * scale,
					height: scale
				}))
			);
			row = [];
			ratio = 0;
		}
	}
	if (row.length) {
		rows.push(
			row.map((entry) => ({
				...entry,
				width: (entry.width / Math.max(entry.height, 1)) * targetHeight,
				height: targetHeight
			}))
		);
	}
	return rows;
}
