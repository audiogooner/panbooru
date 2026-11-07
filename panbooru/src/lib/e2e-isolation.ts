import { readFile } from 'node:fs/promises';
import { test as base } from '@playwright/test';

/**
 * One preview process serves every spec, so they share one database.
 * Clear library rows before each test. Owner, sessions, and credentials stay.
 */
export const test = base.extend<{ libraryIsolation: void }>({
	libraryIsolation: [
		async ({ request }, use) => {
			const token = (
				await readFile(new URL('../../test-results/e2e-reset-token', import.meta.url), 'utf8')
			).trim();
			const response = await request.post('/api/e2e/reset-library', {
				data: {},
				headers: {
					origin: 'http://127.0.0.1:4173',
					'x-panbooru-e2e-reset': token
				}
			});
			if (!response.ok()) throw new Error(`library reset failed (${response.status()})`);
			await use();
		},
		{ auto: true }
	]
});

export { expect } from '@playwright/test';
