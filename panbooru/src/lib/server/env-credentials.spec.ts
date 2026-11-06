import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { startApp } from '#lib/server/app.ts';

const apiKey = 'super-secret-api-key';
const userId = '7';

async function startFixture(accept: boolean) {
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? '/', 'http://127.0.0.1');
		const ok = accept && url.searchParams.get('api_key') === apiKey;
		response.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
		response.end(ok ? '{"post":[]}' : '{"error":"unauthorized"}');
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

function row(dataDir: string) {
	const sqlite = new Database(join(dataDir, 'db', 'panbooru.sqlite'), { readonly: true });
	const found = sqlite
		.prepare('select ciphertext, user_id from source_credentials where source = ?')
		.get('gelbooru') as { ciphertext: Buffer; user_id: string } | undefined;
	sqlite.close();
	return found;
}

describe('environment credentials', () => {
	const cleanups: Array<() => Promise<void>> = [];
	const previous = {
		user: process.env.PANBOORU_GELBOORU_USER_ID,
		key: process.env.PANBOORU_GELBOORU_API_KEY
	};

	afterEach(async () => {
		if (previous.user === undefined) delete process.env.PANBOORU_GELBOORU_USER_ID;
		else process.env.PANBOORU_GELBOORU_USER_ID = previous.user;
		if (previous.key === undefined) delete process.env.PANBOORU_GELBOORU_API_KEY;
		else process.env.PANBOORU_GELBOORU_API_KEY = previous.key;
		while (cleanups.length) await cleanups.pop()?.();
	});

	it('stores ciphertext when the fixture accepts the env key', async () => {
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-env-'));
		const secretPath = join(dataDir, 'secrets', 'master.key');
		await mkdir(join(dataDir, 'secrets'), { recursive: true });
		await writeFile(secretPath, randomBytes(32));
		const fixture = await startFixture(true);
		const logs: string[] = [];
		process.env.PANBOORU_GELBOORU_USER_ID = userId;
		process.env.PANBOORU_GELBOORU_API_KEY = apiKey;
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
		const stored = row(dataDir);
		expect(stored?.user_id).toBe(userId);
		expect(Buffer.from(stored!.ciphertext).toString('utf8')).not.toContain(apiKey);
		expect(logs.join('\n')).not.toContain(apiKey);
		expect(logs.join('\n').toLowerCase()).toContain('validated');
	});

	it('keeps the previous ciphertext when the env key is rejected', async () => {
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-env-'));
		const secretPath = join(dataDir, 'secrets', 'master.key');
		await mkdir(join(dataDir, 'secrets'), { recursive: true });
		await writeFile(secretPath, randomBytes(32));
		const good = await startFixture(true);
		process.env.PANBOORU_GELBOORU_USER_ID = userId;
		process.env.PANBOORU_GELBOORU_API_KEY = apiKey;
		const first = await startApp({
			dataDir,
			secretPath,
			fixtureOrigin: good.origin,
			log: () => {}
		});
		const before = row(dataDir);
		await first.close();
		await good.close();

		const bad = await startFixture(false);
		process.env.PANBOORU_GELBOORU_API_KEY = 'wrong-key';
		const second = await startApp({
			dataDir,
			secretPath,
			fixtureOrigin: bad.origin,
			log: () => {}
		});
		cleanups.push(async () => {
			await second.close();
			await bad.close();
			await rm(dataDir, { recursive: true, force: true });
		});
		const after = row(dataDir);
		expect(Buffer.from(after!.ciphertext)).toEqual(Buffer.from(before!.ciphertext));
	});
});
