import { existsSync } from 'node:fs';
import { chmod, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	ZIP_EXPORT_MAX_BYTES,
	ZIP_EXPORT_MAX_FILES,
	ZipExportTooLargeError,
	writeExportZip
} from '#lib/server/library/export-zip.ts';

describe('bulk zip packager', () => {
	const directories: string[] = [];

	afterEach(async () => {
		while (directories.length) {
			const directory = directories.pop();
			if (directory) await rm(directory, { recursive: true, force: true });
		}
	});

	async function directory() {
		const path = await mkdtemp(join(tmpdir(), 'panbooru-zip-'));
		directories.push(path);
		return path;
	}

	it('refuses a selection over 500 files before writing', async () => {
		expect(ZIP_EXPORT_MAX_FILES).toBe(500);
		const root = await directory();
		const destination = join(root, 'too-many.zip');
		const files = Array.from({ length: ZIP_EXPORT_MAX_FILES }, (_, index) => ({
			path: join(root, 'missing', `${index}.bin`),
			name: `${index}.bin`
		}));
		const error = await writeExportZip({
			files,
			omitted: ['not-ready.jpg'],
			destination
		}).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(ZipExportTooLargeError);
		expect(error).toMatchObject({ status: 413, code: 'ZIP_TOO_LARGE', limit: 'files' });
		expect(existsSync(destination)).toBe(false);
		expect(existsSync(join(root, 'missing'))).toBe(false);
	});

	it('refuses when ready bytes exceed 2 GB before writing', async () => {
		expect(ZIP_EXPORT_MAX_BYTES).toBe(2 * 1024 * 1024 * 1024);
		const root = await directory();
		const source = join(root, 'huge.bin');
		const destination = join(root, 'too-big.zip');
		const handle = await open(source, 'w');
		await handle.truncate(ZIP_EXPORT_MAX_BYTES + 1);
		await handle.close();
		await chmod(source, 0o000);

		try {
			const error = await writeExportZip({
				files: [{ path: source, name: 'huge.bin' }],
				omitted: [],
				destination
			}).catch((caught: unknown) => caught);

			expect(error).toBeInstanceOf(ZipExportTooLargeError);
			expect(error).toMatchObject({ status: 413, code: 'ZIP_TOO_LARGE', limit: 'bytes' });
			expect(existsSync(destination)).toBe(false);
		} finally {
			await chmod(source, 0o644);
		}
	});

	it('stores a ready file uncompressed and counts omitted names', async () => {
		const root = await directory();
		const body = Buffer.from('panbooru-ready-original');
		const source = join(root, 'original.bin');
		const destination = join(root, 'export.zip');
		await writeFile(source, body);

		const result = await writeExportZip({
			files: [{ path: source, name: 'sunset.jpg' }],
			omitted: ['pending-a.png', 'pending-b.png'],
			destination
		});

		expect(result).toEqual({
			destination,
			includedCount: 1,
			omittedCount: 2,
			bytes: body.length
		});
		const zip = await readFile(destination);
		expect(storedPayload(zip, 'sunset.jpg', body.length)).toEqual(body);
		expect(zip.includes('pending-a.png')).toBe(false);
		expect(zip.includes('pending-b.png')).toBe(false);
	});
});

function storedPayload(zip: Buffer, name: string, size: number) {
	const marker = Buffer.from(name);
	const nameAt = zip.indexOf(marker);
	expect(nameAt).toBeGreaterThanOrEqual(30);
	const header = nameAt - 30;
	expect(zip.readUInt32LE(header)).toBe(0x04034b50);
	expect(zip.readUInt16LE(header + 8)).toBe(0);
	expect(zip.readUInt16LE(header + 26)).toBe(marker.length);
	const extra = zip.readUInt16LE(header + 28);
	const dataStart = nameAt + marker.length + extra;
	return zip.subarray(dataStart, dataStart + size);
}
