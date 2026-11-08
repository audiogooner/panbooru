import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { MediaTarget } from '#lib/server/sources/gelbooru.ts';

const associatedData = 'media-ref:1';

export type MediaRegistry = {
	get(ref: string): MediaTarget | undefined;
	put(target: MediaTarget): string;
};

export function createMediaRegistry(options: {
	dataDir: string;
	secretPath?: string;
}): MediaRegistry {
	const keyPath = options.secretPath ?? join(options.dataDir, 'secrets', 'media.key');
	ensureKey(keyPath);
	const key = readFileSync(keyPath);
	return {
		put(target) {
			return seal(target, key);
		},
		get(ref) {
			return open(ref, key);
		}
	};
}

/** In-memory only. Used by tests that do not need durable media refs. */
export function memoryMediaRegistry(
	seed: Iterable<readonly [string, MediaTarget]> = []
): MediaRegistry {
	const entries = new Map(seed);
	return {
		put(target) {
			const ref = randomBytes(16).toString('hex');
			entries.set(ref, target);
			return ref;
		},
		get(ref) {
			return entries.get(ref);
		}
	};
}

function ensureKey(keyPath: string) {
	if (existsSync(keyPath)) {
		const key = readFileSync(keyPath);
		if (key.length !== 32) throw new Error('media key must be 32 bytes');
		return;
	}
	mkdirSync(dirname(keyPath), { recursive: true });
	writeFileSync(keyPath, randomBytes(32), { mode: 0o600 });
}

function seal(target: MediaTarget, key: Buffer) {
	const nonce = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, nonce);
	cipher.setAAD(Buffer.from(associatedData));
	const plaintext = Buffer.from(JSON.stringify({ f: target.fileUrl, p: target.previewUrl }));
	const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	const tag = cipher.getAuthTag();
	return encode(Buffer.concat([nonce, tag, ciphertext]));
}

function open(ref: string, key: Buffer): MediaTarget | undefined {
	let packed: Buffer;
	try {
		packed = decode(ref);
	} catch {
		return undefined;
	}
	if (packed.length < 12 + 16 + 1) return undefined;
	const nonce = packed.subarray(0, 12);
	const tag = packed.subarray(12, 28);
	const ciphertext = packed.subarray(28);
	try {
		const decipher = createDecipheriv('aes-256-gcm', key, nonce);
		decipher.setAAD(Buffer.from(associatedData));
		decipher.setAuthTag(tag);
		const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
		const parsed = JSON.parse(plaintext.toString('utf8')) as { f?: unknown; p?: unknown };
		if (typeof parsed.f !== 'string' || typeof parsed.p !== 'string') return undefined;
		return { fileUrl: parsed.f, previewUrl: parsed.p };
	} catch {
		return undefined;
	}
}

function encode(bytes: Buffer) {
	return bytes.toString('base64url');
}

function decode(value: string) {
	if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid media ref');
	return Buffer.from(value, 'base64url');
}
