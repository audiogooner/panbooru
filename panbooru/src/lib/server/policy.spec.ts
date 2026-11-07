import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	decryptCredential,
	encryptCredential,
	writeEncryptedFile
} from '#lib/server/secrets/cipher.ts';
import { checkDestination, checkRedirect } from '#lib/server/media/policy.ts';
import { formatUpstreamError, redactSecrets } from '#lib/server/http/redact.ts';

const aad = 'gelbooru:1';
const approvedHost = 'cdn.fixture.test';
const publicAddress = '93.184.216.34';

function lookupPublic(host: string) {
	if (host === approvedHost) return [publicAddress];
	return ['203.0.113.10'];
}

async function tempDir() {
	const dir = join(tmpdir(), `panbooru-secrets-${randomBytes(4).toString('hex')}`);
	await mkdir(dir, { recursive: true });
	return dir;
}

describe('credential encryption', () => {
	it('decrypts the original credential bytes', async () => {
		const dir = await tempDir();
		const keyPath = join(dir, 'master.key');
		await writeFile(keyPath, randomBytes(32));
		const plaintext = new TextEncoder().encode('user-1:api-key-value');
		const record = encryptCredential(plaintext, { keyPath, associatedData: aad });
		expect(Buffer.from(decryptCredential(record, { keyPath, associatedData: aad }))).toEqual(
			Buffer.from(plaintext)
		);
	});

	it('rejects a flipped ciphertext, tag, or associated-data byte', async () => {
		const dir = await tempDir();
		const keyPath = join(dir, 'master.key');
		await writeFile(keyPath, randomBytes(32));
		const plaintext = new TextEncoder().encode('secret');
		const record = encryptCredential(plaintext, { keyPath, associatedData: aad });

		const flippedCiphertext = Uint8Array.from(record.ciphertext);
		flippedCiphertext[0] ^= 0xff;
		expect(() =>
			decryptCredential(
				{ ...record, ciphertext: flippedCiphertext },
				{ keyPath, associatedData: aad }
			)
		).toThrow();

		const flippedTag = Uint8Array.from(record.tag);
		flippedTag[0] ^= 0xff;
		expect(() =>
			decryptCredential({ ...record, tag: flippedTag }, { keyPath, associatedData: aad })
		).toThrow();

		expect(() => decryptCredential(record, { keyPath, associatedData: 'gelbooru:2' })).toThrow();
	});

	it('leaves an existing ciphertext file untouched when the key file is missing', async () => {
		const dir = await tempDir();
		const filePath = join(dir, 'credential.bin');
		const original = Buffer.from('existing-ciphertext');
		await writeFile(filePath, original);

		expect(() =>
			writeEncryptedFile({
				filePath,
				keyPath: join(dir, 'missing.key'),
				plaintext: new TextEncoder().encode('new'),
				associatedData: aad
			})
		).toThrow();
		expect(await readFile(filePath)).toEqual(original);
	});
});

describe('media destination policy', () => {
	const allowed = {
		allowHosts: [approvedHost],
		lookup: lookupPublic
	};

	it('accepts an approved host and path', () => {
		expect(checkDestination(`https://${approvedHost}/images/a.jpg`, allowed)).toEqual({ ok: true });
		expect(checkDestination(`https://${approvedHost}/images/e1/eb/e1eb7e26.png`, allowed)).toEqual({
			ok: true
		});
		expect(
			checkDestination(`https://${approvedHost}/thumbnails/e1/eb/thumbnail_e1eb7e26.jpg`, allowed)
		).toEqual({ ok: true });
	});

	it('rejects unsafe destinations', () => {
		const cases = [
			`http://${approvedHost}/images/a.jpg`,
			`https://user:pass@${approvedHost}/images/a.jpg`,
			'https://93.184.216.34/images/a.jpg',
			`https://${approvedHost}/images/a.jpg#frag`,
			`https://${approvedHost}/images/a.jpg?width=1`,
			`https://${approvedHost}/images/a.jpg?api_key=secret`,
			`https://${approvedHost}/images/a.jpg?user_id=7`,
			`https://${approvedHost}:8443/images/a.jpg`,
			`https://${approvedHost}/other/a.jpg`,
			`https://${approvedHost}/samples/e1/eb/sample_file.jpg`,
			`https://${approvedHost}/images/e1/file.jpg`,
			`https://${approvedHost}/images/../a.jpg`,
			`https://not-in-payload.example/images/e1/eb/file.jpg`
		];
		for (const target of cases) {
			expect(checkDestination(target, allowed).ok, target).toBe(false);
		}
	});

	it('rejects private, loopback, and link-local answers', () => {
		const blocked = [
			'10.1.2.3',
			'127.0.0.1',
			'169.254.1.1',
			'172.16.0.5',
			'192.168.0.5',
			'::1',
			'fe80::1'
		];
		for (const address of blocked) {
			expect(
				checkDestination(`https://${approvedHost}/images/a.jpg`, {
					allowHosts: [approvedHost],
					lookup: () => [address]
				}).ok,
				address
			).toBe(false);
		}
	});

	it('rejects redirects', () => {
		for (const status of [301, 302, 303, 307, 308]) {
			expect(checkRedirect(status).ok).toBe(false);
		}
		expect(checkRedirect(200).ok).toBe(true);
	});
});

describe('secret redaction', () => {
	const url = 'https://gelbooru.com/index.php?page=dapi&api_key=supersecret&user_id=42';

	it('strips api_key and user_id from text and upstream errors', () => {
		expect(redactSecrets(url)).not.toContain('supersecret');
		expect(redactSecrets(url)).not.toContain('user_id=42');
		expect(formatUpstreamError(url)).not.toContain('supersecret');
		expect(formatUpstreamError(url)).not.toContain('user_id=42');
	});
});
