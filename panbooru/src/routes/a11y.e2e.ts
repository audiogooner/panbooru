import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../lib/e2e-isolation';

mkdirSync(new URL('../../test-results/', import.meta.url), { recursive: true });

const password = 'correct-horse-battery';

async function focusControl(page: Page, target: Locator) {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		const focused = await target
			.evaluate((element) => element === document.activeElement)
			.catch(() => false);
		if (focused) return;
		await page.keyboard.press('Tab');
	}
	throw new Error('control was not reached from the keyboard');
}

test('login, search, the viewer, and favorite work from the keyboard', async ({ page }) => {
	await page.goto('/setup');
	if ((await page.getByLabel('Bootstrap token').count()) > 0) {
		const dataDir = (
			await readFile(new URL('../../test-results/e2e-data-dir', import.meta.url), 'utf8')
		).trim();
		const token = (await readFile(`${dataDir}/bootstrap.token`, 'utf8')).trim();
		await page.keyboard.press('Tab');
		await expect(page.getByLabel('Bootstrap token')).toBeFocused();
		await page.keyboard.type(token);
		await page.keyboard.press('Tab');
		await page.keyboard.type(password);
		await page.keyboard.press('Enter');
	} else {
		await page.goto('/login');
		await page.keyboard.press('Tab');
		await expect(page.getByLabel('Password')).toBeFocused();
		await page.keyboard.type(password);
		await page.keyboard.press('Enter');
	}
	await expect(page).toHaveURL('/');

	await focusControl(page, page.getByLabel('Tags'));
	await page.keyboard.type('landscape sunset');
	await page.keyboard.press('Enter');
	await expect(page.locator('.gallery img').first()).toBeVisible();

	await focusControl(page, page.locator('.gallery button').first());
	await page.keyboard.press('Enter');
	await expect(page.locator('.viewer .full')).toBeVisible();

	await focusControl(page, page.getByRole('button', { name: 'Favorite', exact: true }));
	const saved = page.waitForResponse(
		(response) => response.url().includes('/api/library/favorites') && response.ok()
	);
	await page.keyboard.press('Enter');
	await saved;

	await focusControl(page, page.getByRole('button', { name: 'Show tags' }));
	await page.keyboard.press('Enter');
	const tags = page.getByRole('list', { name: 'Post tags' });
	await expect(tags).toBeVisible();
	await focusControl(page, tags.getByRole('button', { name: 'sunset', exact: true }));
	await page.keyboard.press('Enter');
	await expect(page.getByLabel('Tags')).toHaveValue('sunset');
	await expect(page.locator('.gallery img').first()).toBeVisible();

	await focusControl(page, page.locator('.gallery button').first());
	await page.keyboard.press('Enter');
	await focusControl(page, page.getByRole('button', { name: 'Show tags' }));
	await page.keyboard.press('Enter');
	await focusControl(
		page,
		page
			.getByRole('list', { name: 'Post tags' })
			.getByRole('button', { name: 'landscape', exact: true })
	);
	await page.keyboard.press('Shift+Enter');
	await expect(page.getByLabel('Tags')).toHaveValue('sunset landscape');

	await focusControl(page, page.locator('.gallery button').first());
	await page.keyboard.press('Enter');
	await focusControl(page, page.getByRole('button', { name: 'Show tags' }));
	await page.keyboard.press('Enter');
	await focusControl(
		page,
		page
			.getByRole('list', { name: 'Post tags' })
			.getByRole('button', { name: 'sunset', exact: true })
	);
	await page.keyboard.press('Control+Enter');
	const nav = page.getByRole('navigation', { name: 'Main navigation' });
	await expect(nav.getByRole('button', { name: 'sunset', exact: true })).toBeVisible();

	const separator = page.getByRole('separator', { name: 'Resize details' });
	await focusControl(page, separator);
	const before = Number(await separator.getAttribute('aria-valuenow'));
	await page.keyboard.press('ArrowRight');
	await expect(separator).toHaveAttribute('aria-valuenow', String(before + 16));
	await page.keyboard.press('ArrowLeft');
	await expect(separator).toHaveAttribute('aria-valuenow', String(before));

	await page.keyboard.press('Escape');
	await expect(page.getByLabel('Tags')).toHaveValue('sunset landscape');
	await expect(nav.getByRole('button', { name: 'sunset', exact: true })).toHaveCount(1);
});
