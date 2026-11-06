import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startApp, type RunningApp } from '#lib/server/app.ts';
import { AUTH_RATE_LIMIT } from '#lib/server/auth/rate-limit.ts';
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from '#lib/server/auth/session.ts';

const password = 'correct-horse-battery';

async function tempDir() {
	return mkdtemp(join(tmpdir(), 'panbooru-auth-'));
}

function originHeaders(app: RunningApp, extra?: HeadersInit) {
	return { origin: app.origin, ...extra };
}

describe('owner auth', () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		while (cleanups.length) await cleanups.pop()?.();
	});

	async function boot(now: () => number = () => Date.now()) {
		const dataDir = await tempDir();
		const logs: string[] = [];
		const app = await startApp({
			dataDir,
			secretPath: join(dataDir, 'secrets', 'master.key'),
			now,
			log: (line) => logs.push(line)
		});
		cleanups.push(async () => {
			await app.close();
			await rm(dataDir, { recursive: true, force: true });
		});
		return { app, dataDir, logs };
	}

	async function claim(app: RunningApp, dataDir: string) {
		const token = await readFile(join(dataDir, 'bootstrap.token'), 'utf8');
		const response = await app.fetch('/api/setup/owner', {
			method: 'POST',
			headers: { ...originHeaders(app), 'content-type': 'application/json' },
			body: JSON.stringify({ token: token.trim(), password })
		});
		expect(response.status).toBe(200);
		const cookie = response.headers.get('set-cookie');
		expect(cookie).toBeTruthy();
		return { token: token.trim(), cookie: cookie ?? '' };
	}

	it('writes a bootstrap token without logging the secret', async () => {
		const { dataDir, logs } = await boot();
		const token = (await readFile(join(dataDir, 'bootstrap.token'), 'utf8')).trim();
		expect(token.length).toBeGreaterThan(16);
		expect(logs.join('\n')).toContain('bootstrap.token');
		expect(logs.join('\n')).not.toContain(token);
	});

	it('lets the bootstrap token claim the only owner and then rejects setup', async () => {
		const { app, dataDir } = await boot();
		const { token, cookie } = await claim(app, dataDir);
		await expect(readFile(join(dataDir, 'bootstrap.token'))).rejects.toThrow();
		expect(cookie.toLowerCase()).toContain('httponly');

		const session = await app.fetch('/api/auth/session', {
			headers: { cookie: cookie.split(';')[0] }
		});
		expect(session.status).toBe(200);

		const again = await app.fetch('/api/setup/owner', {
			method: 'POST',
			headers: { ...originHeaders(app), 'content-type': 'application/json' },
			body: JSON.stringify({ token, password: 'another-strong-password' })
		});
		expect(again.status).toBe(403);

		const without = await app.fetch('/api/setup/owner', {
			method: 'POST',
			headers: { ...originHeaders(app), 'content-type': 'application/json' },
			body: JSON.stringify({ token: 'nope', password: 'another-strong-password' })
		});
		expect(without.status).toBe(403);
	});

	it('sets an HttpOnly cookie for the right password and revokes it on logout', async () => {
		const { app, dataDir } = await boot();
		await claim(app, dataDir);

		const wrong = await app.fetch('/api/auth/login', {
			method: 'POST',
			headers: { ...originHeaders(app), 'content-type': 'application/json' },
			body: JSON.stringify({ password: 'wrong-password-value' })
		});
		expect(wrong.status).toBe(401);
		expect(wrong.headers.get('set-cookie')).toBeNull();

		const login = await app.fetch('/api/auth/login', {
			method: 'POST',
			headers: { ...originHeaders(app), 'content-type': 'application/json' },
			body: JSON.stringify({ password })
		});
		expect(login.status).toBe(200);
		const setCookie = login.headers.get('set-cookie') ?? '';
		expect(setCookie.toLowerCase()).toContain('httponly');
		const cookie = setCookie.split(';')[0];

		const logout = await app.fetch('/api/auth/logout', {
			method: 'POST',
			headers: { ...originHeaders(app), cookie }
		});
		expect(logout.status).toBe(200);

		const replay = await app.fetch('/api/auth/session', { headers: { cookie } });
		expect(replay.status).toBe(401);
	});

	it('expires sessions after idle and absolute lifetimes', async () => {
		let now = Date.parse('2026-01-01T00:00:00Z');
		const idle = await boot(() => now);
		await claim(idle.app, idle.dataDir);
		const idleLogin = await idle.app.fetch('/api/auth/login', {
			method: 'POST',
			headers: { ...originHeaders(idle.app), 'content-type': 'application/json' },
			body: JSON.stringify({ password })
		});
		const idleCookie = (idleLogin.headers.get('set-cookie') ?? '').split(';')[0];
		now += SESSION_IDLE_MS + 1;
		expect(
			(await idle.app.fetch('/api/auth/session', { headers: { cookie: idleCookie } })).status
		).toBe(401);

		now = Date.parse('2026-01-01T00:00:00Z');
		const absolute = await boot(() => now);
		await claim(absolute.app, absolute.dataDir);
		const absoluteLogin = await absolute.app.fetch('/api/auth/login', {
			method: 'POST',
			headers: { ...originHeaders(absolute.app), 'content-type': 'application/json' },
			body: JSON.stringify({ password })
		});
		const absoluteCookie = (absoluteLogin.headers.get('set-cookie') ?? '').split(';')[0];
		now += 6 * 24 * 60 * 60 * 1000;
		expect(
			(await absolute.app.fetch('/api/auth/session', { headers: { cookie: absoluteCookie } }))
				.status
		).toBe(200);
		now = Date.parse('2026-01-01T00:00:00Z') + SESSION_ABSOLUTE_MS + 1;
		expect(
			(await absolute.app.fetch('/api/auth/session', { headers: { cookie: absoluteCookie } }))
				.status
		).toBe(401);
	});

	it('rejects a foreign origin and rate-limits setup, login, and validate', async () => {
		const { app, dataDir } = await boot();
		const token = (await readFile(join(dataDir, 'bootstrap.token'), 'utf8')).trim();
		const foreign = await app.fetch('/api/auth/login', {
			method: 'POST',
			headers: {
				origin: 'https://evil.example',
				'content-type': 'application/json'
			},
			body: JSON.stringify({ password })
		});
		expect(foreign.status).toBe(403);

		for (let attempt = 0; attempt < AUTH_RATE_LIMIT; attempt += 1) {
			const response = await app.fetch('/api/setup/owner', {
				method: 'POST',
				headers: { ...originHeaders(app), 'content-type': 'application/json' },
				body: JSON.stringify({ token, password })
			});
			expect(response.status).not.toBe(429);
		}
		expect(
			(
				await app.fetch('/api/setup/owner', {
					method: 'POST',
					headers: { ...originHeaders(app), 'content-type': 'application/json' },
					body: JSON.stringify({ token, password })
				})
			).status
		).toBe(429);

		const loginApp = await boot();
		await claim(loginApp.app, loginApp.dataDir);
		for (let attempt = 0; attempt < AUTH_RATE_LIMIT; attempt += 1) {
			const response = await loginApp.app.fetch('/api/auth/login', {
				method: 'POST',
				headers: { ...originHeaders(loginApp.app), 'content-type': 'application/json' },
				body: JSON.stringify({ password: 'wrong-password-value' })
			});
			expect(response.status).not.toBe(429);
		}
		expect(
			(
				await loginApp.app.fetch('/api/auth/login', {
					method: 'POST',
					headers: { ...originHeaders(loginApp.app), 'content-type': 'application/json' },
					body: JSON.stringify({ password: 'wrong-password-value' })
				})
			).status
		).toBe(429);

		const validateApp = await boot();
		for (let attempt = 0; attempt < AUTH_RATE_LIMIT; attempt += 1) {
			const response = await validateApp.app.fetch('/api/settings/gelbooru/validate', {
				method: 'POST',
				headers: { ...originHeaders(validateApp.app), 'content-type': 'application/json' },
				body: JSON.stringify({ userId: '1', apiKey: 'x' })
			});
			expect(response.status).not.toBe(429);
		}
		expect(
			(
				await validateApp.app.fetch('/api/settings/gelbooru/validate', {
					method: 'POST',
					headers: { ...originHeaders(validateApp.app), 'content-type': 'application/json' },
					body: JSON.stringify({ userId: '1', apiKey: 'x' })
				})
			).status
		).toBe(429);
	});

	it('leaves health open and requires a session for private routes', async () => {
		const { app } = await boot();
		expect((await app.fetch('/health')).status).toBe(200);
		expect((await app.fetch('/api/auth/session')).status).toBe(401);
		expect((await app.fetch('/api/settings/gelbooru')).status).toBe(401);
	});
});
