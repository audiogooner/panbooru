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

test('album fans filter, edit a cover, and delete after confirmation', async ({ page }) => {
	page.setDefaultTimeout(8_000);
	page.setDefaultNavigationTimeout(8_000);
	await ownerSession(page);
	await ensureCredentials(page);
	const name = `Fan Harbor ${Date.now()}`;

	try {
		await page.goto('/albums');
		await page.getByRole('button', { name: 'Create album' }).first().click();
		await page.getByRole('textbox', { name: 'Title', exact: true }).fill(name);
		await page.getByRole('button', { name: 'Create', exact: true }).click();
		const card = page.locator('[data-kind="album"]', { hasText: name });
		await expect(card).toBeVisible();
		await expect(card.locator('.empty-cover')).toBeVisible();
		await expect(card).toContainText('Empty');

		await page.getByLabel('Album search').fill('no-such-album-fan');
		await expect(page.getByRole('heading', { name: 'No results' })).toBeVisible();
		await page.getByLabel('Album search').fill('');
		await expect(card).toBeVisible();

		await page.goto('/');
		await page.getByLabel('Tags').fill('landscape sunset');
		await page.getByRole('button', { name: 'Search', exact: true }).click();
		await page.getByRole('img').first().click();
		await expect(page.locator('.viewer .full')).toBeVisible();
		const added = page.waitForResponse(
			(response) =>
				response.url().includes('/api/library/albums/') &&
				response.url().includes('/items') &&
				response.ok()
		);
		await page.getByRole('button', { name: 'Album selector' }).click();
		await page.getByLabel('New album title').fill(name);
		await page.getByRole('button', { name: 'Create', exact: true }).click();
		await added;

		await page.goto('/albums');
		const filled = page
			.locator('[data-kind="album"]', { hasText: name })
			.filter({ has: page.locator('.fan img') });
		await expect(filled.locator('.fan img')).toHaveAttribute('src', /\/api\/library\/originals\//);

		let savedCover = false;
		page.on('request', (request) => {
			if (request.method() === 'PUT' && request.url().includes('/cover')) savedCover = true;
		});
		await filled.getByRole('button', { name: `Edit cover for ${name}` }).click();
		await expect(page.getByRole('heading', { name: 'Edit cover' })).toBeVisible();
		await expect(page.locator('[data-cover-slot]')).toHaveCount(4);
		await page.keyboard.press('Escape');
		await expect(page.getByRole('heading', { name: 'Edit cover' })).toHaveCount(0);
		expect(savedCover).toBe(false);

		await filled.getByRole('button', { name: `Edit cover for ${name}` }).click();
		const put = page.waitForResponse(
			(response) => response.url().includes('/cover') && response.request().method() === 'PUT'
		);
		await page.getByRole('button', { name: 'Save', exact: true }).click();
		expect((await put).ok()).toBe(true);

		await filled.getByRole('button', { name: `Delete ${name}` }).click();
		await expect(page.getByRole('heading', { name: 'Delete this album?' })).toBeVisible();
		await page.getByRole('button', { name: 'Cancel' }).click();
		await expect(filled).toBeVisible();
		await filled.getByRole('button', { name: `Delete ${name}` }).click();
		await page.getByRole('button', { name: 'Delete', exact: true }).click();
		await expect(filled).toHaveCount(0);
	} finally {
		await page
			.evaluate(async (albumName) => {
				const response = await fetch('/api/library/albums');
				const body = (await response.json()) as {
					data?: { albums?: { id: string; name: string }[] };
				};
				for (const album of body.data?.albums ?? []) {
					if (album.name !== albumName) continue;
					await fetch(`/api/library/albums/${encodeURIComponent(album.id)}`, { method: 'DELETE' });
				}
			}, name)
			.catch(() => undefined);
	}
});

test('a saved search opens a new view titled with the applied query', async ({ page }) => {
	await ownerSession(page);
	const stamp = Date.now();
	const query = `fan_query_${stamp}`;
	const name = `Fan Query ${stamp}`;
	let savedId = '';

	try {
		savedId = await page.evaluate(
			async ({ query, name }) => {
				const response = await fetch('/api/library/saved-searches', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ query, name, type: 'artist' })
				});
				const body = (await response.json()) as { data?: { id?: string } };
				if (!response.ok || !body.data?.id) throw new Error('saved search was not created');
				return body.data.id;
			},
			{ query, name }
		);

		await page.goto('/saved');
		const card = page.locator('[data-kind="saved-search"]', { hasText: name });
		await expect(card).toBeVisible();
		await expect(card).toContainText('Artist');
		await page.getByLabel('Filter saved search type').click();
		await page.getByRole('button', { name: 'Search', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'No results' })).toBeVisible();
		await page.getByLabel('Filter saved search type').click();
		await page.getByRole('button', { name: 'All', exact: true }).click();
		await expect(card).toBeVisible();

		await card.locator('.card-hit').click();
		await expect(page).toHaveURL('/');
		const nav = page.getByRole('navigation', { name: 'Main navigation' });
		await expect(
			nav.getByRole('button', { name: query.replaceAll('_', ' '), exact: true })
		).toBeVisible();
		await expect(nav.getByRole('button', { name, exact: true })).toHaveCount(0);

		await page.goto('/saved');
		await card.getByRole('button', { name: `Delete ${name}` }).click();
		await expect(page.getByRole('heading', { name: 'Delete this saved search?' })).toBeVisible();
		await page.getByRole('button', { name: 'Delete', exact: true }).click();
		await expect(page.locator('[data-kind="saved-search"]', { hasText: name })).toHaveCount(0);
		savedId = '';
	} finally {
		if (savedId) {
			await page.evaluate(async (id) => {
				await fetch(`/api/library/saved-searches/${encodeURIComponent(id)}`, { method: 'DELETE' });
			}, savedId);
		}
	}
});
