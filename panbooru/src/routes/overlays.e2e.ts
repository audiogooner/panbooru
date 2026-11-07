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

async function ensureCredentials(page: Page) {
	await page.goto('/settings');
	if ((await page.getByText('Credentials saved').count()) > 0) return;
	await page.getByLabel('User ID').fill('7');
	await page.getByLabel('API key').fill('super-secret-api-key');
	await page.getByRole('button', { name: 'Validate' }).click();
	await expect(page.getByText('Credentials saved')).toBeVisible();
}

test('bookmarking the applied search highlights the save button', async ({ page }) => {
	await ownerSession(page);
	await ensureCredentials(page);
	await page.goto('/');
	await page.getByLabel('Tags').fill(`bookmark_${Date.now()}`);
	await page.getByRole('button', { name: 'Search', exact: true }).click();
	await expect(page.locator('.gallery img').first()).toBeVisible();
	const bookmark = page.getByRole('button', { name: 'Save search', exact: true });
	await expect(bookmark).toHaveAttribute('aria-pressed', 'false');
	const saved = page.waitForResponse(
		(response) =>
			response.url().includes('/api/library/saved-searches') &&
			!response.url().includes('/match') &&
			response.request().method() === 'POST'
	);
	await bookmark.click();
	expect((await saved).status()).toBeLessThan(500);
	await expect(bookmark).toHaveAttribute('aria-pressed', 'true');
});

test('shift-click opens the selection bar and marks the tile', async ({ page }) => {
	await ownerSession(page);
	await ensureCredentials(page);
	await page.goto('/');
	await page.getByLabel('Tags').fill('landscape sunset');
	await page.getByRole('button', { name: 'Search', exact: true }).click();
	const tile = page.locator('[data-post]').first();
	await expect(tile).toBeVisible();
	await tile.locator('.open').click({ modifiers: ['Shift'] });
	await expect(page.locator('[data-selection-bar]')).toBeVisible();
	await expect(page.locator('[data-action="deselect-all"]')).toBeVisible();
	await expect(tile).toHaveClass(/selected/);
	await page.getByRole('button', { name: 'Exit selection' }).click();
	await expect(page.locator('[data-selection-bar]')).toBeHidden();
});

test('album fans and the settings section nav stay available', async ({ page }) => {
	await ownerSession(page);
	await page.goto('/albums');
	await expect(page.locator('.album-grid, .empty').first()).toBeVisible();
	await page.goto('/settings');
	const nav = page.getByRole('navigation', { name: 'Settings sections' });
	await expect(nav).toBeVisible();
	await expect(page.locator('.settings-nav-indicator')).toBeVisible();
	await nav.getByRole('link', { name: 'Keyboard shortcuts' }).click();
	await expect(page.locator('#shortcuts')).toBeInViewport();
});
