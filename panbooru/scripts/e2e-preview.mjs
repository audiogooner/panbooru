import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const dataDir = mkdtempSync(join(tmpdir(), 'panbooru-e2e-'));
const secretPath = join(dataDir, 'secrets', 'master.key');
const infoDir = join(import.meta.dirname, '..', 'test-results');
mkdirSync(infoDir, { recursive: true });
const infoPath = join(infoDir, 'e2e-data-dir');

const fixture = createServer((request, response) => {
	const url = new URL(request.url ?? '/', 'http://127.0.0.1');
	if (url.pathname.startsWith('/images/')) {
		response.writeHead(200, { 'content-type': 'image/jpeg' });
		response.end('jpeg-bytes');
		return;
	}
	if (
		url.searchParams.get('api_key') &&
		url.searchParams.get('api_key') !== 'super-secret-api-key'
	) {
		response.writeHead(401, { 'content-type': 'application/json' });
		response.end('{"error":"unauthorized"}');
		return;
	}
	if (url.searchParams.get('s') === 'tag') {
		response.writeHead(200, { 'content-type': 'application/json' });
		response.end('{"tag":[{"id":3,"name":"sunset","type":0,"count":12}]}');
		return;
	}
	response.writeHead(200, { 'content-type': 'application/json' });
	response.end(
		JSON.stringify({
			post: [
				{
					id: 10,
					tags: 'landscape sunset',
					file_url: 'https://cdn.fixture.test/images/a.jpg',
					preview_url: 'https://cdn.fixture.test/images/a.jpg',
					width: 100,
					height: 50,
					rating: 'general'
				}
			]
		})
	);
});

await new Promise((resolve) => fixture.listen(0, '127.0.0.1', () => resolve(undefined)));
const address = fixture.address();
if (!address || typeof address === 'string') throw new Error('fixture failed to bind');
const fixtureOrigin = `http://127.0.0.1:${address.port}`;
writeFileSync(infoPath, dataDir);

const preview = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4173'], {
	stdio: 'inherit',
	env: {
		...process.env,
		PANBOORU_DATA_DIR: dataDir,
		PANBOORU_SECRET_PATH: secretPath,
		PANBOORU_FIXTURE_ORIGIN: fixtureOrigin,
		PANBOORU_MEDIA_HOSTS: 'cdn.fixture.test'
	}
});

function shutdown() {
	preview.kill('SIGTERM');
	fixture.close();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
preview.on('exit', (code) => {
	fixture.close();
	process.exit(code ?? 0);
});
