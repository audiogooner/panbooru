import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from '../../lib/e2e-isolation';

mkdirSync(new URL('../../../test-results/', import.meta.url), { recursive: true });

const password = 'correct-horse-battery';
const ownerState = new URL('../../../test-results/e2e-owner.json', import.meta.url);

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
			await readFile(new URL('../../../test-results/e2e-data-dir', import.meta.url), 'utf8')
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

test.use({ viewport: { width: 1200, height: 560 } });

test('the section highlight moves directly to the chosen section', async ({ page }) => {
	await ownerSession(page);
	await page.goto('/settings');
	await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
	await expect(page.locator('#main')).toHaveClass(/settings-page-mode/);
	const nav = page.getByRole('navigation', { name: 'Settings sections' });
	await expect(nav.locator('a.active')).toHaveText('Appearance');
	await expect(page.locator('#scroll').getByRole('button', { name: 'Log out' })).toBeVisible();
	await expect(page.getByRole('button', { name: /reset sample/i })).toHaveCount(0);

	const jumped = await page.evaluate(async () => {
		const root = document.querySelector('.settings-nav');
		const link = document.querySelector<HTMLAnchorElement>('a[href="#gelbooru"]');
		if (!root || !link)
			return { seen: [] as string[], y: '', expected: '', shadow: '', border: '' };
		const seen: string[] = [];
		const observer = new MutationObserver(() => {
			seen.push(root.querySelector('a.active')?.textContent?.trim() ?? '');
		});
		observer.observe(root, { attributes: true, subtree: true, attributeFilter: ['class'] });
		link.click();
		await new Promise((resolve) => setTimeout(resolve, 450));
		observer.disconnect();
		seen.push(root.querySelector('a.active')?.textContent?.trim() ?? '');
		const navEl = root as HTMLElement;
		return {
			seen,
			y: navEl.style.getPropertyValue('--indicator-y'),
			expected: `${link.offsetTop - 7}px`,
			shadow: getComputedStyle(link).boxShadow,
			border: getComputedStyle(link).borderLeftWidth
		};
	});

	const names = [...new Set(jumped.seen.filter(Boolean))];
	expect(names).toContain('Gelbooru connection');
	for (const name of names) expect(['Appearance', 'Gelbooru connection']).toContain(name);
	expect(jumped.y).toBe(jumped.expected);
	expect(jumped.shadow).toBe('none');
	expect(jumped.border).toBe('0px');

	await page.waitForFunction(() => {
		const scroller = document.getElementById('scroll');
		if (!scroller) return false;
		return scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
	});
	await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 80)));
	await page.locator('#scroll').evaluate((element) => {
		element.scrollTop = 0;
	});
	await expect(nav.locator('a.active')).toHaveText('Appearance');
	await page.locator('#scroll').evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	await expect(nav.locator('a.active')).toHaveText('Gelbooru connection');
});

test('thumbnail size and shortcut overrides are stored in the browser', async ({ page }) => {
	await ownerSession(page);
	await page.goto('/settings');
	await page.getByLabel('Thumbnail size').fill('240');
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('panbooru-row-height')))
		.toBe('240');

	const created = page.locator('[data-shortcut="new-search"]');
	await created.getByRole('button', { name: 'Change shortcut for New search' }).click();
	await page.keyboard.press('k');
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('panbooru-shortcuts')))
		.toContain('"key":"k"');

	const favorite = page.locator('[data-shortcut="favorite"]');
	await favorite.getByRole('button', { name: 'Change shortcut for Favorite' }).click();
	await page.keyboard.press('k');
	await expect(favorite.getByText('Already used by New search.')).toBeVisible();
	const stored = await page.evaluate(() => localStorage.getItem('panbooru-shortcuts') ?? '');
	expect(stored).toContain('new-search');
	expect(stored).not.toContain('favorite');

	await created.getByRole('button', { name: 'Reset New search shortcut' }).click();
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('panbooru-shortcuts')))
		.toBeNull();
});
