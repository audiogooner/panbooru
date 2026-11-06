export type JustifiedItem = { id: string; width: number; height: number };

const gap = 4;

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
