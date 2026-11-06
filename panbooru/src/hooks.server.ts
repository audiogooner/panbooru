import type { Handle } from '@sveltejs/kit/hooks';
import { createServices, healthResponse } from '#lib/server/app.ts';
import { ensureBootstrap, dispatch, type AppServices } from '#lib/server/auth/dispatch.ts';

let services: AppServices | undefined;

function servicesForRequest() {
	if (!services) {
		services = createServices();
		ensureBootstrap(services);
	}
	return services;
}

export const handle: Handle = async ({ event, resolve }) => {
	if (event.request.method === 'GET' && event.url.pathname === '/health') {
		return healthResponse();
	}
	const api = await dispatch(event.request, servicesForRequest());
	if (api) return api;
	return resolve(event);
};
