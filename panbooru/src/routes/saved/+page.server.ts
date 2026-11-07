import type { PageServerLoad } from './$types';
import { getProcessServices } from '#lib/server/app.ts';
import { listSavedSearches } from '#lib/server/library/collections.ts';

export const load: PageServerLoad = () => {
	return { savedSearches: listSavedSearches(getProcessServices().db) };
};
