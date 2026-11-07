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

	await expect
		.poll(async () => {
			await page.goto('/favorites');
			const image = page.getByRole('img');
			if ((await image.count()) !== 1) return 0;
			const src = await image.getAttribute('src');
			if (!src?.includes('/api/library/originals/')) return 0;
			return page.evaluate(async (url) => (await fetch(url)).status, src);
		})
		.toBe(200);
	await expect(page.locator('[data-category="general"]')).toHaveText('sunset');
	await expect(page.getByRole('img')).not.toHaveAttribute('src', /\/api\/media\//);

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

	await openLandscape(page);
	const added = page.waitForResponse(
		(response) =>
			response.url().includes('/api/library/albums/') &&
			response.url().includes('/items') &&
			response.ok()
	);
	await page.getByRole('button', { name: 'Album selector' }).click();
	await page.getByLabel('New album title').fill('Night');
	await page.getByRole('button', { name: 'Create', exact: true }).click();
	await added;

	await page.goto('/albums');
	await page.getByRole('link', { name: 'Night' }).click();
	const albumImage = page.getByRole('img');
	await expect(albumImage).toHaveCount(1);
	await expect(albumImage).toHaveAttribute('src', /\/api\/library\/originals\//);

	await page.goto('/favorites');
	await page.getByRole('button', { name: 'Remove favorite' }).click();
	await expect(page.getByText('No favorites yet.')).toBeVisible();
	await expect(page.getByRole('img')).toHaveCount(0);

	await page.goto('/albums');
	await page.getByRole('link', { name: 'Night' }).click();
	await expect(page.getByRole('img')).toHaveCount(1);

	await page.getByRole('button', { name: 'Remove from album' }).click();
	await expect(page.getByRole('img')).toHaveCount(0);
	await page.goto('/favorites');
	await expect(page.getByText('No favorites yet.')).toBeVisible();
	await expect(page.getByRole('img')).toHaveCount(0);
});

test('a favorites search filters by a tag from the saved post', async ({ page }) => {
	await ownerSession(page);
	await page.goto('/favorites');
	await expect(page.getByText('No favorites yet.')).toBeVisible();

	await openLandscape(page);
	const saved = page.waitForResponse(
		(response) => response.url().includes('/api/library/favorites') && response.ok()
	);
	await page.getByRole('button', { name: 'Favorite', exact: true }).click();
	await saved;

	await page.goto('/favorites');
	await page.getByLabel('Tags').fill('sunset');
	await page.getByRole('button', { name: 'Search', exact: true }).click();
	await expect(page).toHaveURL(/[?&]q=sunset(?:&|$)/);
	await expect(page.getByRole('img')).toHaveCount(1);

	await page.getByLabel('Tags').fill('forest');
	await page.getByRole('button', { name: 'Search', exact: true }).click();
	await expect(page).toHaveURL(/[?&]q=forest(?:&|$)/);
	await expect(page.getByText('No results')).toBeVisible();
	await expect(page.getByLabel('Tags')).toHaveValue('forest');
});

test('a removed favorite returns from the keyboard after reload', async ({ page }) => {
	await ownerSession(page);
	await openLandscape(page);
	const saved = page.waitForResponse(
		(response) => response.url().includes('/api/library/favorites') && response.ok()
	);
	await page.getByRole('button', { name: 'Favorite', exact: true }).click();
	await saved;

	await page.goto('/favorites');
	await expect(page.getByRole('img')).toHaveCount(1);
	await page.getByRole('button', { name: 'Remove favorite' }).click();
	await expect(page.getByRole('img')).toHaveCount(0);

	await page.reload();
	await expect(page).toHaveURL(/\/favorites$/);
	await expect(page.getByRole('img')).toHaveCount(0);

	const tags = page.getByLabel('Tags');
	await tags.focus();
	await page.keyboard.press('ControlOrMeta+Z');
	await expect(page.getByRole('img')).toHaveCount(0);

	await tags.blur();
	await page.keyboard.press('ControlOrMeta+Z');
	await expect(page.getByRole('img')).toHaveCount(1);
	await expect(page).toHaveURL(/\/favorites$/);
});

test('a deleted upstream file is labeled unavailable while a ready favorite stays', async ({
	page
}) => {
	await ownerSession(page);
	await openLandscape(page);
	const ready = page.waitForResponse(
		(response) => response.url().includes('/api/library/favorites') && response.ok()
	);
	await page.getByRole('button', { name: 'Favorite', exact: true }).click();
	await ready;

	await page.goto('/');
	await page.getByLabel('Tags').fill('missing');
	await page.getByRole('button', { name: 'Search', exact: true }).click();
	await page.getByRole('img').first().click();
	await expect(page.locator('.viewer .full')).toBeVisible();
	const missing = page.waitForResponse(
		(response) => response.url().includes('/api/library/favorites') && response.ok()
	);
	await page.getByRole('button', { name: 'Favorite', exact: true }).click();
	await missing;

	await page.goto('/favorites');
	await page.getByLabel('Tags').fill('missing');
	await page.getByRole('button', { name: 'Search', exact: true }).click();
	await expect(page).toHaveURL(/[?&]q=missing(?:&|$)/);
	await expect(page.getByText('Unavailable')).toBeVisible();
	await expect(page.getByRole('img')).toHaveCount(0);

	await page.getByLabel('Tags').fill('sunset');
	await page.getByRole('button', { name: 'Search', exact: true }).click();
	await expect(page).toHaveURL(/[?&]q=sunset(?:&|$)/);
	await expect(page.getByRole('img')).toHaveCount(1);
	await expect(page.getByRole('img')).toHaveAttribute('src', /\/api\/library\/originals\//);
});

test('two sessions share a favorite and keep their own place', async ({ browser }) => {
	const first = await browser.newContext();
	const pageA = await first.newPage();
	await ownerSession(pageA);
	const second = await browser.newContext({ storageState: await first.storageState() });
	const pageB = await second.newPage();

	await pageA.goto('/favorites');
	let remaining = await pageA.getByRole('button', { name: 'Remove favorite' }).count();
	while (remaining > 0) {
		await pageA.getByRole('button', { name: 'Remove favorite' }).first().click();
		remaining -= 1;
		await expect(pageA.getByRole('button', { name: 'Remove favorite' })).toHaveCount(remaining);
	}
	await pageB.goto('/favorites');
	await pageB.reload();
	await expect(pageB.getByRole('img')).toHaveCount(0);

	await openLandscape(pageA);
	const place = pageA.url();
	const saved = pageA.waitForResponse(
		(response) => response.url().includes('/api/library/favorites') && response.ok()
	);
	await pageA.getByRole('button', { name: 'Favorite', exact: true }).click();
	await saved;

	await expect
		.poll(async () => {
			await pageB.reload();
			return pageB.getByRole('img').count();
		})
		.toBe(1);
	await expect(pageA).toHaveURL(place);
	await expect(pageA.locator('.viewer .full')).toBeVisible();
	await first.close();
	await second.close();
});

test('deleting an album keeps a post that is still a favorite', async ({ page }) => {
	await ownerSession(page);
	await openLandscape(page);
	const saved = page.waitForResponse(
		(response) => response.url().includes('/api/library/favorites') && response.ok()
	);
	await page.getByRole('button', { name: 'Favorite', exact: true }).click();
	await saved;
	const added = page.waitForResponse(
		(response) =>
			response.url().includes('/api/library/albums/') &&
			response.url().includes('/items') &&
			response.ok()
	);
	await page.getByRole('button', { name: 'Album selector' }).click();
	await page.getByLabel('New album title').fill('Dusk');
	await page.getByRole('button', { name: 'Create', exact: true }).click();
	await added;

	await page.goto('/albums');
	await page.getByRole('link', { name: 'Dusk' }).click();
	await page.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(page.getByText('Delete this album?')).toBeVisible();
	await page.getByRole('button', { name: 'Cancel' }).click();
	await expect(page.getByRole('heading', { name: 'Dusk' })).toBeVisible();

	await page.getByRole('button', { name: 'Delete', exact: true }).click();
	await page.getByRole('button', { name: 'Delete album', exact: true }).click();
	await expect(page).toHaveURL(/\/albums$/);
	await expect(page.getByRole('link', { name: 'Dusk' })).toHaveCount(0);

	await page.goto('/favorites');
	await expect(page.getByRole('img')).toHaveCount(1);
});
