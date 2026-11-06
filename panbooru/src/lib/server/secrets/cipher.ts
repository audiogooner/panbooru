import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

export type EncryptedRecord = {
	ciphertext: Uint8Array;
	nonce: Uint8Array;
	tag: Uint8Array;
	keyVersion: number;
};

type CipherOptions = {
	keyPath: string;
	associatedData: string;
};

function loadKey(keyPath: string) {
	const key = readFileSync(keyPath);
	if (key.length !== 32) {
		throw new Error('master key must be 32 bytes');
	}
	return key;
}

export function encryptCredential(plaintext: Uint8Array, options: CipherOptions): EncryptedRecord {
	const key = loadKey(options.keyPath);
	const nonce = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, nonce);
	cipher.setAAD(Buffer.from(options.associatedData));
	const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	return {
		ciphertext,
		nonce,
		tag: cipher.getAuthTag(),
		keyVersion: 1
	};
}

export function decryptCredential(record: EncryptedRecord, options: CipherOptions) {
	const key = loadKey(options.keyPath);
	const decipher = createDecipheriv('aes-256-gcm', key, record.nonce);
	decipher.setAAD(Buffer.from(options.associatedData));
	decipher.setAuthTag(record.tag);
	return Buffer.concat([decipher.update(record.ciphertext), decipher.final()]);
}

export function writeEncryptedFile(
	options: CipherOptions & { filePath: string; plaintext: Uint8Array }
) {
	const record = encryptCredential(options.plaintext, options);
	writeFileSync(
		options.filePath,
		Buffer.concat([
			Buffer.from(record.nonce),
			Buffer.from(record.tag),
			Buffer.from(record.ciphertext)
		])
	);
}
