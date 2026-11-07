import { redirect } from '@sveltejs/kit';
import { getProcessServices } from '#lib/server/app.ts';
import { listAlbumCollection, listSavedSearches } from '#lib/server/library/collections.ts';
import { expireRemovals, openRemoval } from '#lib/server/library/removal.ts';
import type { LayoutServerLoad } from './$types';

const emptyCollection = {
	albums: [],
	albumSidebar: { temporary: [], pinned: [] },
	savedSearches: []
};

export const load: LayoutServerLoad = ({ locals, url }) => {
	const open = url.pathname === '/login' || url.pathname === '/setup';
	if (!locals.authenticated && !open) redirect(303, '/login');
	if (!locals.authenticated) return { authenticated: false, removalId: null, ...emptyCollection };
	const services = getProcessServices();
	expireRemovals(services.db, services.dataDir, services.now());
	const albums = listAlbumCollection(services.db);
	return {
		authenticated: true,
		removalId: openRemoval(services.db),
		albums: albums.albums,
		albumSidebar: albums.albumSidebar,
		savedSearches: listSavedSearches(services.db)
	};
};
