import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getProcessServices } from '#lib/server/app.ts';
import { searchAlbum } from '#lib/server/library/search.ts';
import { readAlbum } from '#lib/server/library/collections.ts';
import { listAlbumPosts } from '#lib/server/library/save.ts';
import { refreshSavedTags } from '#lib/server/library/tags.ts';

export const load: PageServerLoad = async ({ params, url }) => {
	const services = getProcessServices();
	await refreshSavedTags(services);
	const album = readAlbum(services.db, params.id);
	if (!album) error(404, 'Album was not found');
	const raw = url.searchParams.get('q');
	if (raw === null) {
		return {
			album,
			posts: listAlbumPosts(services.db, album.id),
			query: '',
			searched: false,
			explanation: ''
		};
	}
	const result = searchAlbum(services.db, album.id, raw, []);
	return {
		album,
		posts: result.posts,
		query: raw,
		searched: true,
		explanation: result.explanation ?? ''
	};
};
