import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

mkdirSync(new URL('../../test-results/', import.meta.url), { recursive: true });

const password = 'correct-horse-battery';

async function ownerSession(page: Page) {
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
}

async function openLandscape(page: Page) {
	await page.goto('/');
	await page.getByLabel('Tags').fill('landscape sunset');
	await page.getByRole('button', { name: 'Search', exact: true }).click();
	await page.getByRole('img').first().click();
	await expect(page.locator('.viewer .full')).toBeVisible();
}

test('a favorited fixture post is shown from the saved file', async ({ page }) => {
	await ownerSession(page);
	await page.goto('/favorites');
	await expect(page.getByRole('heading', { name: 'Favorites' })).toBeVisible();
	await expect(page.getByText('No favorites yet.')).toBeVisible();

	await openLandscape(page);
	const saved = page.waitForResponse(
		(response) => response.url().includes('/api/library/favorites') && response.ok()
	);
	await page.getByRole('button', { name: 'Favorite', exact: true }).click();
	await saved;

	await page.goto('/favorites');
	const image = page.getByRole('img');
	await expect(image).toHaveCount(1);
	await expect(image).toHaveAttribute('src', /\/api\/library\/originals\//);
	await expect(image).not.toHaveAttribute('src', /\/api\/media\//);
	const src = await image.getAttribute('src');
	expect(src).toBeTruthy();
	const status = await page.evaluate(async (url) => (await fetch(url)).status, src ?? '');
	expect(status).toBe(200);

	await openLandscape(page);
	const again = page.waitForResponse(
		(response) => response.url().includes('/api/library/favorites') && response.ok()
	);
	await page.getByRole('button', { name: 'Favorite', exact: true }).click();
	await again;
	await page.goto('/favorites');
	await expect(page.getByRole('img')).toHaveCount(1);

	await page.reload();
	await expect(page.getByRole('img')).toHaveCount(1);
	await expect(page.getByRole('img')).toHaveAttribute('src', /\/api\/library\/originals\//);
});
