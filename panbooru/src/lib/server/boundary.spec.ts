import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { startApp, type RunningApp } from '#lib/server/app.ts';
import LoginPage from '../../routes/login/+page.svelte';
import SettingsPage from '../../routes/settings/+page.svelte';
import Database from 'better-sqlite3';

const password = 'correct-horse-battery';
const apiKey = 'super-secret-api-key';
const userId = '7';
const approvedHost = 'cdn.fixture.test';

async function startFixture() {
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? '/', 'http://127.0.0.1');
		if (url.pathname.startsWith('/images/')) {
			response.writeHead(200, { 'content-type': 'image/jpeg' });
			response.end('jpeg-bytes');
			return;
		}
		const key = url.searchParams.get('api_key');
		if (key && key !== apiKey) {
			response.writeHead(401, { 'content-type': 'application/json' });
			response.end('{"error":"unauthorized"}');
			return;
		}
		response.writeHead(200, { 'content-type': 'application/json' });
		response.end(
			JSON.stringify({
				post: [
					{
						id: 10,
						tags: 'landscape sunset',
						file_url: `https://${approvedHost}/images/a.jpg`,
						preview_url: `https://${approvedHost}/images/a.jpg`,
						width: 100,
						height: 50,
						rating: 'general'
					}
				]
			})
		);
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('fixture failed to bind');
	return {
		origin: `http://127.0.0.1:${address.port}`,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			})
	};
}

describe('secret and origin boundary', () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		while (cleanups.length) await cleanups.pop()?.();
	});

	async function boot() {
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-boundary-'));
		const secretPath = join(dataDir, 'secrets', 'master.key');
		const logs: string[] = [];
		const fixture = await startFixture();
		const app = await startApp({
			dataDir,
			secretPath,
			fixtureOrigin: fixture.origin,
			allowHosts: [approvedHost],
			lookup: () => ['93.184.216.34'],
			log: (line) => logs.push(line),
			fetchUpstream: (input) => fetch(new URL(`${input.pathname}${input.search}`, fixture.origin))
		});
		cleanups.push(async () => {
			await app.close();
			await fixture.close();
			await rm(dataDir, { recursive: true, force: true });
		});
		const token = (await readFile(join(dataDir, 'bootstrap.token'), 'utf8')).trim();
		const setup = await app.fetch('/api/setup/owner', {
			method: 'POST',
			headers: { origin: app.origin, 'content-type': 'application/json' },
			body: JSON.stringify({ token, password })
		});
		expect(setup.status).toBe(200);
		const cookie = (setup.headers.get('set-cookie') ?? '').split(';')[0];
		return { app, dataDir, secretPath, logs, cookie };
	}

	async function mediaRef(app: RunningApp, cookie: string) {
		const found = await app.fetch('/api/source/gelbooru/search', {
			method: 'POST',
			headers: { origin: app.origin, cookie, 'content-type': 'application/json' },
			body: JSON.stringify({ query: 'landscape' })
		});
		expect(found.status).toBe(200);
		const body = (await found.json()) as { data: { posts: Array<{ mediaRef: string }> } };
		return body.data.posts[0]?.mediaRef ?? '';
	}

	function favorite(app: RunningApp, cookie: string, ref: string, origin?: string) {
		const headers: Record<string, string> = { cookie, 'content-type': 'application/json' };
		if (origin) headers.origin = origin;
		return app.fetch('/api/library/favorites', {
			method: 'POST',
			headers,
			body: JSON.stringify({
				remoteId: '10',
				tags: ['landscape', 'sunset'],
				width: 100,
				height: 50,
				mediaRef: ref,
				rating: 'general'
			})
		});
	}

	it('rejects a foreign origin for media and library writes, and allows the same origin or none', async () => {
		const { app, cookie } = await boot();
		const ref = await mediaRef(app, cookie);

		expect(
			(
				await app.fetch(`/api/media/${ref}`, {
					headers: { cookie, origin: 'https://evil.example' }
				})
			).status
		).toBe(403);
		expect((await favorite(app, cookie, ref, 'https://evil.example')).status).toBe(403);

		expect(
			(await app.fetch(`/api/media/${ref}`, { headers: { cookie, origin: app.origin } })).status
		).toBe(200);
		expect((await favorite(app, cookie, ref, app.origin)).status).toBe(200);

		const again = await boot();
		const second = await mediaRef(again.app, again.cookie);
		expect(
			(await again.app.fetch(`/api/media/${second}`, { headers: { cookie: again.cookie } })).status
		).toBe(200);
		expect((await favorite(again.app, again.cookie, second)).status).toBe(200);
	});

	it('keeps secrets out of settings, the session, rendered pages, and credential logs', async () => {
		const { app, cookie, dataDir, secretPath, logs } = await boot();
		const saved = await app.fetch('/api/settings/gelbooru/validate', {
			method: 'POST',
			headers: { origin: app.origin, cookie, 'content-type': 'application/json' },
			body: JSON.stringify({ userId, apiKey })
		});
		expect(saved.status).toBe(200);

		const sqlite = new Database(join(dataDir, 'db', 'panbooru.sqlite'), { readonly: true });
		const row = sqlite.prepare('select password_hash from owner').get() as {
			password_hash: string;
		};
		sqlite.close();
		const masterKey = await readFile(secretPath);
		const secrets = [
			apiKey,
			password,
			row.password_hash,
			masterKey.toString('hex'),
			masterKey.toString('base64')
		];

		const settings = await app.fetch('/api/settings/gelbooru', { headers: { cookie } });
		const session = await app.fetch('/api/auth/session', { headers: { cookie } });
		expect(settings.status).toBe(200);
		expect(session.status).toBe(200);
		const settingsText = await settings.text();
		const sessionText = await session.text();
		const loginHtml = render(LoginPage).body;
		const settingsHtml = render(SettingsPage, {
			props: { data: { configured: true, userId } }
		}).body;
		for (const secret of secrets) {
			expect(settingsText).not.toContain(secret);
			expect(sessionText).not.toContain(secret);
			expect(loginHtml).not.toContain(secret);
			expect(settingsHtml).not.toContain(secret);
			expect(logs.join('\n')).not.toContain(secret);
		}
		expect(logs.join('\n')).toContain('api_key=REDACTED');
	});
});
