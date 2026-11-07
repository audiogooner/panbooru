import { describe, expect, it } from 'vitest';
import {
	appendTag,
	back,
	closeView,
	closeViewer,
	createNavigation,
	forward,
	newView,
	openPost,
	replaceTag
} from '#lib/navigation.ts';

describe('exploration navigation', () => {
	it('starts with one empty gallery view', () => {
		const state = createNavigation();
		expect(state.views).toHaveLength(1);
		expect(state.views[0]).toMatchObject({ query: '', mode: 'gallery', postId: null });
		expect(state.activeId).toBe(state.views[0]?.id);
	});

	it('adds an active view, or a background view that leaves the current one active', () => {
		const start = createNavigation();
		const added = newView(start, 'forest');
		expect(added.views).toHaveLength(2);
		expect(added.views.find((view) => view.id === added.activeId)?.query).toBe('forest');
		const background = newView(added, 'water', { background: true });
		expect(background.activeId).toBe(added.activeId);
		expect(background.views.map((view) => view.query)).toEqual(['forest', 'water', '']);
	});

	it('closes a view and leaves one empty view when the last one closes', () => {
		const added = newView(createNavigation(), 'forest');
		const forest = added.views.find((view) => view.query === 'forest')!;
		const closed = closeView(added, forest.id);
		expect(closed.views.map((view) => view.query)).not.toContain('forest');
		expect(closed.views.some((view) => view.id === closed.activeId)).toBe(true);
		const only = closeView(closed, closed.activeId);
		expect(only.views).toHaveLength(1);
		expect(only.views[0]).toMatchObject({ query: '', mode: 'gallery' });
	});

	it('restores replaced and appended queries with back and forward', () => {
		const forest = replaceTag(newView(createNavigation(), 'forest'), 'canopy');
		expect(forest.views.find((view) => view.id === forest.activeId)?.query).toBe('canopy');
		const sunset = replaceTag(forest, 'landscape sunset');
		const restored = back(sunset);
		expect(restored.views.find((view) => view.id === restored.activeId)?.query).toBe('canopy');
		const again = forward(restored);
		expect(again.views.find((view) => view.id === again.activeId)?.query).toBe('landscape sunset');

		const appended = appendTag(again, 'night');
		expect(appended.views.find((view) => view.id === appended.activeId)?.query).toBe(
			'landscape sunset night'
		);
		expect(back(appended).views.find((view) => view.id === appended.activeId)?.query).toBe(
			'landscape sunset'
		);
	});

	it('opens and closes the viewer without changing the query', () => {
		const start = replaceTag(createNavigation(), 'forest');
		const viewing = openPost(start, '10');
		const current = viewing.views.find((view) => view.id === viewing.activeId);
		expect(current).toMatchObject({ mode: 'viewer', postId: '10', query: 'forest' });
		const gallery = closeViewer(viewing);
		expect(gallery.views.find((view) => view.id === gallery.activeId)).toMatchObject({
			mode: 'gallery',
			query: 'forest'
		});
	});
});
