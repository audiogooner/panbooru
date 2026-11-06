import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { startApp } from '#lib/server/app.ts';

const secretMarker = 'master.key';

async function startFixture() {
	const requests: string[] = [];
	const server = createServer((request, response) => {
		requests.push(`${request.method} ${request.url}`);
		response.writeHead(200, { 'content-type': 'application/json' });
		response.end('{"posts":[]}');
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('fixture failed to bind');
	}
	return {
		origin: `http://127.0.0.1:${address.port}`,
		requests,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			})
	};
}

describe('app harness', () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		while (cleanups.length) {
			await cleanups.pop()?.();
		}
	});

	it('serves health with no library paths or secret state', async () => {
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-'));
		const fixture = await startFixture();
		cleanups.push(async () => {
			await fixture.close();
			await rm(dataDir, { recursive: true, force: true });
		});

		const app = await startApp({
			dataDir,
			secretPath: join(dataDir, 'secrets', secretMarker),
			fixtureOrigin: fixture.origin
		});
		cleanups.push(() => app.close());

		const response = await app.fetch('/health');
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).not.toContain(dataDir);
		expect(body).not.toContain(secretMarker);
		expect(body).not.toContain(fixture.origin);
		expect(body.toLowerCase()).not.toContain('api_key');
		expect(fixture.requests).toEqual([]);
	});
});
