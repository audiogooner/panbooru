import { eq } from 'drizzle-orm';
import { getProcessServices } from '#lib/server/app.ts';
import { sourceCredentials } from '#lib/server/db/schema.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const row = getProcessServices()
		.db.select()
		.from(sourceCredentials)
		.where(eq(sourceCredentials.source, 'gelbooru'))
		.get();
	return {
		configured: Boolean(row?.validated),
		userId: row?.userId ?? ''
	};
};
