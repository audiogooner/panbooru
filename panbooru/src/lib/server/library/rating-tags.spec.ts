import { describe, expect, it } from 'vitest';
import { compileRatingTags } from '#lib/server/library/rating-tags.ts';

describe('Gelbooru rating tag text', () => {
	it('sends no rating terms when every rating is selected', () => {
		expect(compileRatingTags(['general', 'sensitive', 'questionable', 'explicit'])).toBe('');
	});

	it('sends one positive term when only explicit is selected', () => {
		expect(compileRatingTags(['explicit'])).toBe('rating:explicit');
	});

	it('excludes the ratings that are not selected, in a fixed order', () => {
		expect(compileRatingTags(['general', 'sensitive'])).toBe(
			'-rating:explicit -rating:questionable'
		);
		expect(compileRatingTags(['explicit', 'questionable', 'sensitive'])).toBe('-rating:general');
	});

	it('treats an empty selection as every rating', () => {
		expect(compileRatingTags([])).toBe('');
	});
});
