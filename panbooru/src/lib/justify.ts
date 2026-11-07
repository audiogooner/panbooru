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
export function squirclePath(width: number, height: number, radius = squircleRadius) {
	const safeWidth = Math.max(width, 0);
	const safeHeight = Math.max(height, 0);
	const r = Math.max(0, Math.min(radius, safeWidth / 2, safeHeight / 2));
	const k = squircleControl;
	return [
		`M ${round(r)} 0`,
		`H ${round(safeWidth - r)}`,
		`C ${round(safeWidth - r * (1 - k))} 0 ${round(safeWidth)} ${round(r * (1 - k))} ${round(safeWidth)} ${round(r)}`,
		`V ${round(safeHeight - r)}`,
		`C ${round(safeWidth)} ${round(safeHeight - r * (1 - k))} ${round(safeWidth - r * (1 - k))} ${round(safeHeight)} ${round(safeWidth - r)} ${round(safeHeight)}`,
		`H ${round(r)}`,
		`C ${round(r * (1 - k))} ${round(safeHeight)} 0 ${round(safeHeight - r * (1 - k))} 0 ${round(safeHeight - r)}`,
		`V ${round(r)}`,
		`C 0 ${round(r * (1 - k))} ${round(r * (1 - k))} 0 ${round(r)} 0`,
		'Z'
	].join(' ');
}

/** Inset squircle for the favorite stroke, so the stroke sits inside the tile clip. */
export function favoriteOutline(width: number, height: number, radius = squircleRadius) {
	return squirclePath(Math.max(0, width - 2), Math.max(0, height - 2), Math.max(0, radius - 1));
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
