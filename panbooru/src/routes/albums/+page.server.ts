import type { PageServerLoad } from './$types';
import { getProcessServices } from '#lib/server/app.ts';
import { listAlbumCollection } from '#lib/server/library/collections.ts';
import { listAlbumPosts } from '#lib/server/library/save.ts';

export const load: PageServerLoad = () => {
	const db = getProcessServices().db;
	const collection = listAlbumCollection(db);
	const albumPosts = Object.fromEntries(
		collection.albums.map((album) => [album.id, listAlbumPosts(db, album.id)])
	);
	return { ...collection, albumPosts };
};
