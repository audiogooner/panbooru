import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getProcessServices } from '#lib/server/app.ts';
import { getAlbum, listAlbumPosts } from '#lib/server/library/save.ts';

export const load: PageServerLoad = ({ params }) => {
	const services = getProcessServices();
	const album = getAlbum(services.db, params.id);
	if (!album) error(404, 'Album was not found');
	return { album, posts: listAlbumPosts(services.db, album.id) };
};
