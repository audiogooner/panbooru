import { describe, expect, it } from 'vitest';
import { matchSavedPosts } from '#lib/server/library/query.ts';

const sunset = { id: 'sunset', tags: ['landscape', 'sunset'], rating: 'general' };
const partial = { id: 'partial', tags: ['landscape'], rating: 'general' };
const forest = { id: 'forest', tags: ['forest', 'sunset'], rating: 'sensitive' };
const explicit = { id: 'explicit', tags: ['landscape', 'sunset'], rating: 'explicit' };

describe('local post match', () => {
	it('keeps a post only when every requested tag is present', () => {
		const result = matchSavedPosts([sunset, partial], 'landscape sunset', []);
		expect(result.posts).toEqual([sunset]);
		expect(result.explanation).toBeUndefined();
	});

	it('drops a post that has an excluded tag', () => {
		const result = matchSavedPosts([forest, sunset], '-forest', []);
		expect(result.posts).toEqual([sunset]);
		expect(result.explanation).toBeUndefined();
	});

	it('keeps either selected rating and drops the others', () => {
		const result = matchSavedPosts([sunset, forest, explicit], '', ['general', 'sensitive']);
		expect(result.posts).toEqual([sunset, forest]);
		expect(result.explanation).toBeUndefined();
	});

	it('explains grouping, or, score:, and id: instead of returning posts', () => {
		for (const query of ['(landscape sunset)', 'sunset or forest', 'score:>10', 'id:10']) {
			const result = matchSavedPosts([sunset], query, []);
			expect(result.posts).toEqual([]);
			expect(result.explanation).toEqual(expect.any(String));
			expect((result.explanation ?? '').length).toBeGreaterThan(0);
		}
	});
});
