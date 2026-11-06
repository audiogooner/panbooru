import { describe, expect, it } from 'vitest';
import {
	addAlbumMembership,
	deleteAlbum,
	favorite,
	removeAlbumMembership,
	unfavorite,
	type SavedPost
} from '#lib/server/library/retention.ts';

function post(overrides: Partial<SavedPost> = {}): SavedPost {
	return {
		id: 'post-1',
		favorite: false,
		albumIds: [],
		originalId: 'original-1',
		...overrides
	};
}

describe('library retention', () => {
	it('marks the item and its original for removal when a favorite has no album', () => {
		const saved = favorite(post());
		const result = unfavorite(saved);
		expect(result.post).toBeNull();
		expect(result.removeOriginal).toBe(true);
		expect(result.removed).toEqual({ itemId: 'post-1', originalId: 'original-1' });
	});

	it('keeps the item and its original when unfavoriting leaves an album membership', () => {
		const saved = addAlbumMembership(favorite(post()), 'night');
		expect(saved.favorite).toBe(true);
		expect(saved.albumIds).toEqual(['night']);
		const result = unfavorite(saved);
		expect(result.post).toEqual({ ...saved, favorite: false });
		expect(result.removeOriginal).toBe(false);
		expect(result.removed).toBeNull();
	});

	it('marks them for removal when the last album membership goes and it is not a favorite', () => {
		const saved = addAlbumMembership(post(), 'night');
		expect(saved.albumIds).toEqual(['night']);
		const result = removeAlbumMembership(saved, 'night');
		expect(result.post).toBeNull();
		expect(result.removeOriginal).toBe(true);
		expect(result.removed).toEqual({ itemId: 'post-1', originalId: 'original-1' });
	});

	it('keeps an item that is still favorited or still in another album when an album is deleted', () => {
		const favorited = addAlbumMembership(favorite(post({ id: 'favorited' })), 'night');
		const alsoDay = addAlbumMembership(
			addAlbumMembership(post({ id: 'shared', originalId: 'original-2' }), 'night'),
			'day'
		);
		const onlyNight = addAlbumMembership(
			post({ id: 'only-night', originalId: 'original-3' }),
			'night'
		);
		const untouched = post({ id: 'elsewhere', originalId: 'original-4', albumIds: ['day'] });

		const result = deleteAlbum([favorited, alsoDay, onlyNight, untouched], 'night');

		expect(result.posts.map((item) => item.id)).toEqual(['favorited', 'shared', 'elsewhere']);
		expect(result.posts.find((item) => item.id === 'favorited')).toMatchObject({
			favorite: true,
			albumIds: []
		});
		expect(result.posts.find((item) => item.id === 'shared')?.albumIds).toEqual(['day']);
		expect(result.removed).toEqual([{ itemId: 'only-night', originalId: 'original-3' }]);
	});

	it('does not create a second membership when a favorite or an album add is repeated', () => {
		const once = favorite(post());
		expect(favorite(once)).toEqual(once);
		expect(favorite(once).favorite).toBe(true);

		const inAlbum = addAlbumMembership(post(), 'night');
		const again = addAlbumMembership(inAlbum, 'night');
		expect(again).toEqual(inAlbum);
		expect(again.albumIds).toEqual(['night']);
	});
});
