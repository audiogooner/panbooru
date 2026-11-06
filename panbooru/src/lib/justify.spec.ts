import { describe, expect, it } from 'vitest';
import { justifyRows } from '#lib/justify.ts';

describe('justified rows', () => {
	it('fills a complete row, keeps aspect ratios, and leaves the last row short', () => {
		const items = [
			{ id: 'a', width: 200, height: 100 },
			{ id: 'b', width: 100, height: 100 },
			{ id: 'c', width: 300, height: 100 },
			{ id: 'd', width: 50, height: 100 }
		];
		const rows = justifyRows(items, 400, 100);
		expect(rows.length).toBeGreaterThan(1);
		const full = rows[0]!;
		const filled = full.reduce((sum, item) => sum + item.width, 0) + 4 * (full.length - 1);
		expect(Math.round(filled)).toBe(400);
		for (const item of full) {
			const source = items.find((entry) => entry.id === item.id)!;
			expect(item.width / item.height).toBeCloseTo(source.width / source.height, 5);
		}
		const last = rows.at(-1)!;
		const lastWidth = last.reduce((sum, item) => sum + item.width, 0) + 4 * (last.length - 1);
		expect(lastWidth).toBeLessThan(400);
	});
});
