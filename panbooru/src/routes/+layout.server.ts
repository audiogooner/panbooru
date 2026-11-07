import { redirect } from '@sveltejs/kit';
import { getProcessServices } from '#lib/server/app.ts';
import { expireRemovals, openRemoval } from '#lib/server/library/removal.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, url }) => {
	const open = url.pathname === '/login' || url.pathname === '/setup';
	if (!locals.authenticated && !open) redirect(303, '/login');
	if (!locals.authenticated) return { authenticated: false, removalId: null };
	const services = getProcessServices();
	expireRemovals(services.db, services.dataDir, services.now());
	return { authenticated: true, removalId: openRemoval(services.db) };
};
