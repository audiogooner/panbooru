import { describe, expect, it } from 'vitest';
import {
	backdropFromImage,
	flipTransform,
	morphFromOrigin,
	morphRest
} from '#lib/viewer-morph.ts';

describe('viewer morph math', () => {
	it('maps a stage onto the origin tile with transform-origin 0 0', () => {
		const transform = morphFromOrigin(
			{ left: 100, top: 200, width: 80, height: 120 },
			{ left: 40, top: 60 },
			{ width: 400, height: 600 }
		);
		expect(transform).toEqual({
			tx: 60,
			ty: 140,
			sx: 0.2,
			sy: 0.2
		});
	});

	it('builds a FLIP transform from a destination box back to the origin', () => {
		expect(
			flipTransform(
				{ left: 100, top: 200, width: 80, height: 120 },
				{ left: 40, top: 60, width: 400, height: 600 }
			)
		).toEqual({
			tx: 60,
			ty: 140,
			sx: 0.2,
			sy: 0.2
		});
	});

	it('rests at a uniform zoom scale', () => {
		expect(morphRest(0.5)).toEqual({ tx: 0, ty: 0, sx: 0.5, sy: 0.5 });
	});
});

describe('backdropFromImage', () => {
	it('no-ops without a DOM document', () => {
		expect(backdropFromImage({} as CanvasImageSource, 40, 60)).toBeNull();
	});
});
