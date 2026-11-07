import { describe, expect, it } from 'vitest';
import {
	adoptLoaded,
	deselectAll,
	excludedIds,
	exitSelection,
	exportRequest,
	galleryClick,
	importRequest,
	isSelected,
	selectLoaded,
	selectedIds,
	selectionLabel,
	selectionQuery,
	selectionSnapshot,
	type SelectionQuery
} from './selection.svelte.ts';

const key = 'selection-spec';
const ordered = ['a', 'b', 'c'];
const plain = { shiftKey: false, metaKey: false, ctrlKey: false };
const shift = { shiftKey: true, metaKey: false, ctrlKey: false };

describe('gallery selection', () => {
	it('opens on a plain click and ranges on shift-click', () => {
		exitSelection(key);
		expect(galleryClick(key, 'a', ordered, plain)).toBe('open');
		expect(selectionSnapshot(key).active).toBe(false);
		expect(galleryClick(key, 'a', ordered, shift)).toBe('select');
		expect(galleryClick(key, 'c', ordered, shift)).toBe('select');
		expect(selectedIds(key, ordered)).toEqual(ordered);
		expect(selectionLabel(key)).toBe('3');
	});

	it('keeps the mode open after deselect all and labels a whole query', () => {
		selectLoaded(key, ordered);
		expect(selectionLabel(key)).toBe('All');
		deselectAll(key);
		expect(selectionSnapshot(key).active).toBe(true);
		expect(selectedIds(key, ordered)).toEqual([]);
		expect(selectionLabel(key)).toBe('0');
		exitSelection(key);
		expect(selectionLabel(key)).toBeNull();
	});

	it('stores the applied query and posts one descriptor instead of loaded ids', () => {
		exitSelection(key);
		const rating = ['General', 'Sensitive'];
		const query: SelectionQuery = {
			source: 'favorites',
			sourceAlbumId: null,
			query: 'landscape',
			rating,
			media: ['Images'],
			sort: 'Oldest',
			seed: 4
		};
		selectLoaded(key, ['a', 'b'], query);
		rating.push('Explicit');
		expect(selectionQuery(key)?.rating).toEqual(['General', 'Sensitive']);
		expect(isSelected(key, 'c')).toBe(true);
		galleryClick(key, 'b', ['a', 'b', 'c'], plain);
		adoptLoaded(key, ['a', 'b', 'c']);
		expect(selectedIds(key, ['a', 'b', 'c'])).toEqual(['a', 'c']);
		expect(excludedIds(key)).toEqual(['b']);
		expect(importRequest(key, { operation: 'remove', destination: 'favorite' })).toEqual({
			operation: 'remove',
			destination: 'favorite',
			source: 'favorites',
			query: 'landscape',
			rating: ['General', 'Sensitive'],
			media: ['Images'],
			sort: 'Oldest',
			excludedIds: ['b']
		});
		expect(exportRequest(key, ['a', 'c'])).toEqual({
			source: 'favorites',
			query: 'landscape',
			rating: ['General', 'Sensitive'],
			media: ['Images'],
			sort: 'Oldest',
			excludedIds: ['b']
		});
		expect(importRequest(key, { operation: 'add', destination: 'album' })).toBeNull();

		selectLoaded(key, ['a'], {
			source: 'gelbooru',
			sourceAlbumId: null,
			query: 'sunset',
			rating: ['Explicit'],
			media: ['Images', 'Animated images', 'Videos'],
			sort: 'Random',
			seed: 9
		});
		expect(importRequest(key, { operation: 'add', destination: 'album', albumId: 'album-1' })).toMatchObject({
			operation: 'add',
			destination: 'album',
			albumId: 'album-1',
			source: 'gelbooru',
			query: 'sunset',
			sort: 'Random',
			seed: 9,
			excludedIds: []
		});

		deselectAll(key);
		expect(selectionQuery(key)).toBeNull();
		expect(importRequest(key, { operation: 'add', destination: 'favorite' })).toBeNull();
		expect(exportRequest(key, ['a'])).toEqual({ itemIds: ['a'] });
		expect(exportRequest(key, [])).toBeNull();
		exitSelection(key);
	});
});
