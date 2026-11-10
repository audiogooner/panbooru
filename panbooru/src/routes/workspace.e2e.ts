import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../lib/e2e-isolation';

mkdirSync(new URL('../../test-results/', import.meta.url), { recursive: true });

const password = 'correct-horse-battery';
const ownerState = new URL('../../test-results/e2e-owner.json', import.meta.url);

async function ownerSession(page: Page) {
	if (existsSync(ownerState)) {
		const saved = JSON.parse(await readFile(ownerState, 'utf8')) as {
			cookies: Parameters<BrowserContext['addCookies']>[0];
		};
		await page.context().addCookies(saved.cookies);
		await page.goto('/');
		if (new URL(page.url()).pathname !== '/login') return;
	}
	await page.goto('/setup');
	const tokenField = page.getByLabel('Bootstrap token');
	if ((await tokenField.count()) > 0) {
		const dataDir = (
			await readFile(new URL('../../test-results/e2e-data-dir', import.meta.url), 'utf8')
		).trim();
		const token = (await readFile(`${dataDir}/bootstrap.token`, 'utf8')).trim();
		await tokenField.fill(token);
		await page.getByLabel('Password').fill(password);
		await page.getByRole('button', { name: 'Create owner' }).click();
	} else {
		await page.goto('/login');
		await page.getByLabel('Password').fill(password);
		await page.getByRole('button', { name: 'Log in' }).click();
	}
	await expect(page).toHaveURL('/');
	await page.context().storageState({ path: ownerState.pathname });
}

async function search(page: Page, query: string) {
	await page.goto('/');
	await page.getByLabel('Tags').fill(query);
	await page.getByRole('button', { name: 'Search', exact: true }).click();
	const nav = page.getByRole('navigation', { name: 'Main navigation' });
	await expect(nav.getByRole('button', { name: query, exact: true })).toBeVisible();
	return nav;
}

test('a closed tab leaves its search for the next tab, and reload keeps it', async ({
	page,
	context
}) => {
	await ownerSession(page);
	await search(page, 'landscape sunset');
	await page.reload();
	const nav = page.getByRole('navigation', { name: 'Main navigation' });
	await expect(nav.getByRole('button', { name: 'landscape sunset', exact: true })).toBeVisible();

	await page.close();
	const next = await context.newPage();
	await next.goto('/');
	await expect(
		next.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', {
			name: 'landscape sunset',
			exact: true
		})
	).toBeVisible();
});

test('two open tabs keep separate searches', async ({ page, context }) => {
	await ownerSession(page);
	const first = await search(page, 'landscape sunset');
	const secondPage = await context.newPage();
	await secondPage.goto('/');
	const second = secondPage.getByRole('navigation', { name: 'Main navigation' });
	await expect(second.getByRole('button', { name: 'landscape sunset', exact: true })).toHaveCount(
		0
	);

	await secondPage.getByLabel('Tags').fill('forest');
	await secondPage.getByRole('button', { name: 'Search', exact: true }).click();
	await expect(second.getByRole('button', { name: 'forest', exact: true })).toBeVisible();
	await expect(first.getByRole('button', { name: 'landscape sunset', exact: true })).toBeVisible();
	await expect(first.getByRole('button', { name: 'forest', exact: true })).toHaveCount(0);
});
