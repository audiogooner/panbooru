import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

mkdirSync(new URL('../../test-results/', import.meta.url), { recursive: true });

test('owner can set up, sign in, save Gelbooru credentials, and search', async ({ page }) => {
	await page.goto('/setup');
	const dataDir = (
		await readFile(new URL('../../test-results/e2e-data-dir', import.meta.url), 'utf8')
	).trim();
	const token = (await readFile(`${dataDir}/bootstrap.token`, 'utf8')).trim();
	await page.getByLabel('Bootstrap token').fill(token);
	await page.getByLabel('Password').fill('correct-horse-battery');
	await page.getByRole('button', { name: 'Create owner' }).click();
	await expect(page).toHaveURL('/');

	await page.goto('/setup');
	await expect(page.getByLabel('Bootstrap token')).toHaveCount(0);

	await page.getByRole('button', { name: 'Log out' }).click();
	await expect(page).toHaveURL('/login');
	await page.getByLabel('Password').fill('correct-horse-battery');
	await page.getByRole('button', { name: 'Log in' }).click();
	await expect(page).toHaveURL('/');

	await page.goto('/settings');
	await page.getByLabel('User ID').fill('7');
	const key = page.getByLabel('API key');
	await expect(key).toHaveAttribute('type', 'password');
	await key.fill('super-secret-api-key');
	await page.getByRole('button', { name: 'Show' }).click();
	await expect(key).toHaveAttribute('type', 'text');
	await page.getByRole('button', { name: 'Validate' }).click();
	await expect(page.getByText('Credentials saved')).toBeVisible();
	await expect(key).toHaveValue('');
	await expect(page.getByRole('button', { name: /remove credentials/i })).toHaveCount(0);

	await key.fill('wrong-key');
	await page.getByRole('button', { name: 'Validate' }).click();
	await expect(page.getByRole('alert')).toBeVisible();
	await expect(page.getByText('Credentials saved')).toBeVisible();

	await page.goto('/');
	const nav = page.getByRole('navigation', { name: 'Main navigation' });
	await expect(page.getByText('Panbooru').first()).toBeVisible();
	await expect(nav.getByRole('button', { name: 'New search' })).toBeVisible();
	await expect(nav.getByRole('button', { name: 'Untitled search' })).toBeVisible();
	await expect(nav.getByRole('link', { name: 'Albums' })).toBeVisible();
	await expect(nav.getByRole('link', { name: 'Favorites' })).toBeVisible();
	await expect(nav.getByRole('link', { name: 'Saved searches' })).toBeVisible();
	await expect(nav.getByRole('link', { name: 'Settings' })).toBeVisible();

	await page.getByLabel('Tags').fill('landscape sunset');
	await page.getByRole('button', { name: 'Search', exact: true }).click();
	const image = page.getByRole('img').first();
	await expect(image).toBeVisible();
	await expect(image).toHaveAttribute('src', /\/api\/media\//);
	await expect(nav.getByRole('button', { name: 'landscape sunset' })).toBeVisible();

	await nav.getByRole('button', { name: 'New search' }).click();
	await expect(nav.getByRole('button', { name: 'Untitled search' })).toBeVisible();
	await expect(nav.getByRole('button', { name: 'landscape sunset' })).toBeVisible();
	await expect(page.getByRole('img')).toHaveCount(0);

	await nav.getByRole('link', { name: 'Albums' }).click();
	await expect(page.getByRole('heading', { name: 'Albums' })).toBeVisible();
	await expect(page.getByText('No albums yet.')).toBeVisible();
	await page.goto('/favorites');
	await expect(page.getByRole('heading', { name: 'Favorites' })).toBeVisible();
	await expect(page.getByText('No favorites yet.')).toBeVisible();
	await page.goto('/saved');
	await expect(page.getByRole('heading', { name: 'Saved searches' })).toBeVisible();
	await expect(page.getByText('No saved searches yet.')).toBeVisible();
	await page.goto('/settings');
	await expect(page.getByLabel('User ID')).toHaveValue('7');
});
