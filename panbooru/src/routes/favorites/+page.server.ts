import type { PageServerLoad } from './$types';
import { getProcessServices } from '#lib/server/app.ts';
import { searchFavorites } from '#lib/server/library/search.ts';
import { listFavorites } from '#lib/server/library/save.ts';

export const load: PageServerLoad = ({ url }) => {
	const db = getProcessServices().db;
	const raw = url.searchParams.get('q');
	if (raw === null) {
		return { favorites: listFavorites(db), query: '', searched: false, explanation: '' };
	}
	const result = searchFavorites(db, raw, []);
	return {
		favorites: result.posts,
		query: raw,
		searched: true,
		explanation: result.explanation ?? ''
	};
};
