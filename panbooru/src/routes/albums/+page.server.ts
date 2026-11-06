import type { PageServerLoad } from './$types';
import { getProcessServices } from '#lib/server/app.ts';
import { listAlbums } from '#lib/server/library/save.ts';

export const load: PageServerLoad = () => {
	return { albums: listAlbums(getProcessServices().db) };
};
