import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from '../lib/e2e-isolation';

mkdirSync(new URL('../../test-results/', import.meta.url), { recursive: true });

const password = 'correct-horse-battery';
const ownerState = new URL('../../test-results/e2e-owner.json', import.meta.url);

async function ownerSession(page: Page) {
	if (existsSync(ownerState)) {
		const saved = JSON.parse(await readFile(ownerState, 'utf8')) as {
			cookies: Parameters<Page['context']['addCookies']>[0];
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

test('shift-click ranges, deselect all keeps the bar, and escape closes it', async ({ page }) => {
	await ownerSession(page);
	await ensureCredentials(page);
	await page.goto('/');
	await page.getByLabel('Tags').fill('sequence');
	await page.getByRole('button', { name: 'Search', exact: true }).click();
	const tiles = page.locator('.gallery .tile .open');
	await expect(tiles).toHaveCount(3);
	await tiles.nth(0).click({ modifiers: ['Shift'] });
	const bar = page.locator('[data-selection-bar]');
	await expect(bar).toBeVisible();
	await expect(bar).toContainText('1 selected');
	await tiles.nth(2).click({ modifiers: ['Shift'] });
	await expect(bar).toContainText('3 selected');
	await expect(page.locator('.tile.selected')).toHaveCount(3);
	await page.getByRole('button', { name: 'Deselect all' }).click();
	await expect(bar).toBeVisible();
	await expect(bar).toContainText('0 selected');
	await page.keyboard.press('Escape');
	await expect(bar).toBeHidden();
});
