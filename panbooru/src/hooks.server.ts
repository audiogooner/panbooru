import type { Handle } from '@sveltejs/kit/hooks';
import { healthResponse, prepareProcessServices, getProcessServices } from '#lib/server/app.ts';
import { dispatch, readSession } from '#lib/server/auth/dispatch.ts';

export const handle: Handle = async ({ event, resolve }) => {
	await prepareProcessServices();
	const services = getProcessServices();
	event.locals.authenticated = Boolean(readSession(event.request, services));
	if (event.request.method === 'GET' && event.url.pathname === '/health') {
		return healthResponse();
	}
	const api = await dispatch(event.request, services);
	if (api) return api;
	return resolve(event);
};
