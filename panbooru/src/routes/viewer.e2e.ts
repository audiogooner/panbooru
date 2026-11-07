import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

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

test.use({ viewport: { width: 1280, height: 720 } });

test('viewer fits, zooms, pans, and leaves fullscreen before it closes', async ({ page }) => {
	await ownerSession(page);
	await page.goto('/');
	await page.getByLabel('Tags').fill('huge');
	await page.getByRole('button', { name: 'Search', exact: true }).click();
	await page.getByRole('img').first().click();

	const stage = page.locator('.viewer .stage');
	await expect(stage).toBeVisible();
	const fitted = Number(await stage.getAttribute('data-scale'));
	expect(fitted).toBeGreaterThan(0);
	expect(fitted).toBeLessThan(1);
	expect(fitted).toBeCloseTo(Math.min(1280 / 4000, 720 / 3000), 2);

	await stage.dblclick({ position: { x: 200, y: 120 } });
	await expect.poll(async () => Number(await stage.getAttribute('data-scale'))).toBeCloseTo(1, 2);
	const zoomedX = Number(await stage.getAttribute('data-x'));

	await page.mouse.move(420, 280);
	await page.mouse.down();
	await page.mouse.move(520, 320);
	await page.mouse.up();
	const pannedX = Number(await stage.getAttribute('data-x'));
	expect(Math.abs(pannedX - zoomedX)).toBeGreaterThan(20);

	await page.keyboard.press('f');
	await expect.poll(() => page.evaluate(() => document.fullscreenElement?.className ?? '')).toContain('viewer');
	await page.keyboard.press('Escape');
	await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
	await expect(page.locator('.viewer')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.locator('.viewer')).toHaveCount(0);
});
