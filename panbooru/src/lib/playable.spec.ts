import { describe, expect, it } from 'vitest';
import { isAnimatedMedia, mediaTypeForPath, playable } from '#lib/playable.ts';

describe('playable video types', () => {
	it('accepts mp4 and rejects types the viewer cannot play', () => {
		expect(playable('video/mp4')).toBe(true);
		expect(playable('video/mp4; codecs="avc1"')).toBe(true);
		expect(playable('video/x-matroska')).toBe(false);
		expect(playable('image/jpeg')).toBe(false);
	});
});

describe('animated image types', () => {
	it('detects gif, apng, and webp media types', () => {
		expect(isAnimatedMedia('image/gif')).toBe(true);
		expect(isAnimatedMedia('image/apng')).toBe(true);
		expect(isAnimatedMedia('image/webp')).toBe(true);
		expect(isAnimatedMedia('image/jpeg')).toBe(false);
		expect(mediaTypeForPath('/images/anim.gif')).toBe('image/gif');
		expect(mediaTypeForPath('/images/still.jpg')).toBe('');
	});
});
