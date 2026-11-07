import { describe, expect, it } from 'vitest';
import {
	CONTAIN_MIN_HEIGHT,
	CONTAIN_MIN_WIDTH,
	MAX_SCALE,
	doubleClickZoom,
	imageCoordinate,
	initialScale,
	initialZoom,
	needsOriginal,
	panBy,
	retainZoom,
	wheelZoom
} from '#lib/zoom.ts';

const large = { width: 4000, height: 3000 };
const small = { width: 800, height: 600 };

describe('viewer zoom', () => {
	it('fits large images and keeps smaller images native unless they must shrink', () => {
		expect(CONTAIN_MIN_WIDTH).toBe(1920);
		expect(CONTAIN_MIN_HEIGHT).toBe(1080);
		const full = { width: 1000, height: 900 };
		const panel = { width: 800, height: 900 };
		expect(initialScale(large, full)).toBeCloseTo(Math.min(full.width / large.width, full.height / large.height));
		expect(initialScale(large, panel)).toBeLessThan(initialScale(large, full));
		expect(initialScale(small, { width: 2000, height: 2000 })).toBe(1);
		expect(initialScale(small, { width: 400, height: 300 })).toBeCloseTo(0.5);
	});

	it('zooms around the pointer from the baseline and resets once zoomed', () => {
		const area = { width: 800, height: 600 };
		const pointer = { x: 120, y: 80 };
		const fitted = initialZoom(large, area);
		const before = imageCoordinate(fitted, large, area, pointer);
		const native = doubleClickZoom(fitted, large, area, pointer);
		expect(native.scale).toBe(1);
		const after = imageCoordinate(native, large, area, pointer);
		expect(after.x).toBeCloseTo(before.x);
		expect(after.y).toBeCloseTo(before.y);

		const reset = doubleClickZoom(native, large, area, pointer);
		expect(reset.scale).toBeCloseTo(fitted.scale);
		expect(reset.x).toBe(0);
		expect(reset.y).toBe(0);

		const alreadyNative = initialZoom(small, { width: 2000, height: 2000 });
		const doubled = doubleClickZoom(alreadyNative, small, { width: 2000, height: 2000 }, {
			x: 100,
			y: 100
		});
		expect(doubled.scale).toBe(2);
	});

	it('clamps each axis, stops zoom-out at the baseline, and stops zoom-in at 8×', () => {
		const area = { width: 800, height: 600 };
		const wide = { width: 4000, height: 100 };
		const clamped = panBy({ scale: 1, x: 9999, y: 80 }, wide, area, 0, 0);
		expect(clamped.y).toBe(0);
		expect(clamped.x).toBe((4000 - 800) / 2);

		const fitted = initialZoom(large, area);
		const shrunk = wheelZoom(fitted, large, area, { x: 400, y: 300 }, 100000);
		expect(shrunk.scale).toBeCloseTo(fitted.scale);
		const expanded = wheelZoom(fitted, large, area, { x: 400, y: 300 }, -100000);
		expect(expanded.scale).toBe(MAX_SCALE);
		expect(MAX_SCALE).toBe(8);
	});

	it('resets for a new post and keeps a manual scale when the panel area changes', () => {
		const area = { width: 1600, height: 900 };
		const zoomed = wheelZoom(initialZoom(large, area), large, area, { x: 200, y: 150 }, -400);
		const next = initialZoom(small, area);
		expect(next.x).toBe(0);
		expect(next.y).toBe(0);
		expect(next.scale).not.toBe(zoomed.scale);

		const retained = retainZoom(zoomed, large, { width: 1100, height: 900 });
		expect(retained.scale).toBeCloseTo(zoomed.scale);
		expect(retained.x).toBeCloseTo(zoomed.x);
		expect(retained.y).toBeCloseTo(zoomed.y);
	});

	it('asks for the original once the display derivative would be upscaled', () => {
		expect(needsOriginal(large, initialScale(large, { width: 800, height: 600 }))).toBe(false);
		expect(needsOriginal(large, 1)).toBe(true);
	});
});
