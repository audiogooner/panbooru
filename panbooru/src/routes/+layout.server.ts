import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, url }) => {
	const open = url.pathname === '/login' || url.pathname === '/setup';
	if (!locals.authenticated && !open) redirect(303, '/login');
	return { authenticated: locals.authenticated };
};
