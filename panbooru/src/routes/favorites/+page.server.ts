import type { PageServerLoad } from './$types';
import { getProcessServices } from '#lib/server/app.ts';
import { listFavorites } from '#lib/server/library/save.ts';

export const load: PageServerLoad = () => {
	return { favorites: listFavorites(getProcessServices().db) };
};
