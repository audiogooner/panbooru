import { describe, expect, it } from 'vitest';
import { playable } from '#lib/playable.ts';

describe('playable video types', () => {
	it('accepts mp4 and rejects types the viewer cannot play', () => {
		expect(playable('video/mp4')).toBe(true);
		expect(playable('video/mp4; codecs="avc1"')).toBe(true);
		expect(playable('video/x-matroska')).toBe(false);
		expect(playable('image/jpeg')).toBe(false);
	});
});
