import { getProcessServices } from '#lib/server/app.ts';
import { owner } from '#lib/server/db/schema.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const row = getProcessServices().db.select().from(owner).get();
	return { claimed: Boolean(row) };
};
