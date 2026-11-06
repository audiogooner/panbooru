import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { startApp, type RunningApp } from '#lib/server/app.ts';
import { decryptCredential } from '#lib/server/secrets/cipher.ts';

const password = 'correct-horse-battery';
const apiKey = 'super-secret-api-key';
const userId = '7';

async function startFixture() {
	const requests: string[] = [];
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? '/', 'http://127.0.0.1');
		requests.push(url.search);
		const key = url.searchParams.get('api_key');
		if (key === apiKey) {
			response.writeHead(200, { 'content-type': 'application/json' });
			response.end('{"post":[]}');
			return;
		}
		response.writeHead(401, { 'content-type': 'application/json' });
		response.end('{"error":"unauthorized"}');
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('fixture failed to bind');
	return {
		origin: `http://127.0.0.1:${address.port}`,
		requests,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			})
	};
}

describe('gelbooru credentials', () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		while (cleanups.length) await cleanups.pop()?.();
	});

	async function boot() {
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-cred-'));
		const secretPath = join(dataDir, 'secrets', 'master.key');
		await mkdir(join(dataDir, 'secrets'), { recursive: true });
		const logs: string[] = [];
		const fixture = await startFixture();
		const app = await startApp({
			dataDir,
			secretPath,
			fixtureOrigin: fixture.origin,
			log: (line) => logs.push(line)
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
		return { app, dataDir, secretPath, logs, fixture, cookie };
	}

	function credentialRow(dataDir: string) {
		const sqlite = new Database(join(dataDir, 'db', 'panbooru.sqlite'), { readonly: true });
		const row = sqlite
			.prepare(
				'select ciphertext, nonce, auth_tag, key_version, user_id, validated from source_credentials where source = ?'
			)
			.get('gelbooru') as
			| {
					ciphertext: Buffer;
					nonce: Buffer;
					auth_tag: Buffer;
					key_version: number;
					user_id: string;
					validated: number;
			  }
			| undefined;
		sqlite.close();
		return row;
	}

	async function validate(app: RunningApp, cookie: string, key: string) {
		return app.fetch('/api/settings/gelbooru/validate', {
			method: 'POST',
			headers: { origin: app.origin, cookie, 'content-type': 'application/json' },
			body: JSON.stringify({ userId, apiKey: key })
		});
	}

	it('reports unconfigured credentials without an api key field', async () => {
		const { app, cookie } = await boot();
		const response = await app.fetch('/api/settings/gelbooru', { headers: { cookie } });
		expect(response.status).toBe(200);
		const body = await response.text();
		const payload = JSON.parse(body) as { data: { configured: boolean; apiKey?: string } };
		expect(payload.data.configured).toBe(false);
		expect(payload.data.apiKey).toBeUndefined();
		expect(body).not.toContain('api_key');
	});

	it('stores ciphertext only after the fixture accepts the key', async () => {
		const { app, cookie, dataDir, secretPath, logs, fixture } = await boot();
		await writeFile(secretPath, randomBytes(32));
		const response = await validate(app, cookie, apiKey);
		expect(response.status).toBe(200);
		const body = await response.text();
		const payload = JSON.parse(body) as {
			data: { configured: boolean; validated: boolean; userId: string };
		};
		expect(payload.data).toMatchObject({ configured: true, validated: true, userId });
		expect(body).not.toContain(apiKey);
		expect(logs.join('\n')).not.toContain(apiKey);
		expect(
			fixture.requests.some(
				(query) => query.includes(`user_id=${userId}`) && query.includes(`api_key=${apiKey}`)
			)
		).toBe(true);

		const row = credentialRow(dataDir);
		expect(row).toBeTruthy();
		expect(row?.user_id).toBe(userId);
		expect(Buffer.from(row!.ciphertext).toString('utf8')).not.toContain(apiKey);
		const decrypted = decryptCredential(
			{
				ciphertext: row!.ciphertext,
				nonce: row!.nonce,
				tag: row!.auth_tag,
				keyVersion: row!.key_version
			},
			{ keyPath: secretPath, associatedData: 'gelbooru:1' }
		);
		expect(Buffer.from(decrypted).toString('utf8')).toBe(apiKey);

		const page = await app.fetch('/');
		expect(await page.text()).not.toContain(apiKey);
	});

	it('keeps the previous ciphertext when validation fails', async () => {
		const { app, cookie, dataDir, secretPath } = await boot();
		await writeFile(secretPath, randomBytes(32));
		expect((await validate(app, cookie, apiKey)).status).toBe(200);
		const before = credentialRow(dataDir);
		const failed = await validate(app, cookie, 'wrong-key');
		expect(failed.status).toBeGreaterThanOrEqual(400);
		expect(await failed.text()).not.toContain(apiKey);
		const after = credentialRow(dataDir);
		expect(Buffer.from(after!.ciphertext)).toEqual(Buffer.from(before!.ciphertext));
	});

	it('does not overwrite ciphertext when the master key cannot decrypt it', async () => {
		const { app, cookie, dataDir, secretPath } = await boot();
		await writeFile(secretPath, randomBytes(32));
		expect((await validate(app, cookie, apiKey)).status).toBe(200);
		const before = credentialRow(dataDir);
		await writeFile(secretPath, randomBytes(32));
		const failed = await validate(app, cookie, apiKey);
		expect(failed.status).toBeGreaterThanOrEqual(500);
		expect(await failed.text()).not.toContain(apiKey);
		const after = credentialRow(dataDir);
		expect(Buffer.from(after!.ciphertext)).toEqual(Buffer.from(before!.ciphertext));
		expect(() =>
			decryptCredential(
				{
					ciphertext: before!.ciphertext,
					nonce: before!.nonce,
					tag: before!.auth_tag,
					keyVersion: before!.key_version
				},
				{ keyPath: secretPath, associatedData: 'gelbooru:1' }
			)
		).toThrow();
	});
});
