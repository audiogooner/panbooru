import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';

const require = createRequire(import.meta.url);

type StoreZipFile = {
	addFile(realPath: string, metadataPath: string, options?: { compress?: boolean }): void;
	end(): void;
	outputStream: Readable;
	on(event: 'error', listener: (error: Error) => void): void;
};

const { ZipFile } = require('yazl') as { ZipFile: new () => StoreZipFile };

export const ZIP_EXPORT_MAX_FILES = 500;
export const ZIP_EXPORT_MAX_BYTES = 2 * 1024 * 1024 * 1024;

export type ZipExportFile = {
	path: string;
	name: string;
};

export type ZipExportRequest = {
	files: readonly ZipExportFile[];
	omitted: readonly string[];
	destination: string;
};

export type ZipExportResult = {
	destination: string;
	includedCount: number;
	omittedCount: number;
	bytes: number;
};

/** Selection is too large for a bulk ZIP. Routes map `status` to HTTP 413. */
export class ZipExportTooLargeError extends Error {
	readonly status = 413;
	readonly code = 'ZIP_TOO_LARGE';
	readonly limit: 'files' | 'bytes';

	constructor(limit: 'files' | 'bytes', message: string) {
		super(message);
		this.name = 'ZipExportTooLargeError';
		this.limit = limit;
	}
}

export async function writeExportZip(request: ZipExportRequest): Promise<ZipExportResult> {
	const includedCount = request.files.length;
	const omittedCount = request.omitted.length;
	const selectionCount = includedCount + omittedCount;
	if (selectionCount > ZIP_EXPORT_MAX_FILES) {
		throw new ZipExportTooLargeError(
			'files',
			`Selection has ${selectionCount} files, over the limit of ${ZIP_EXPORT_MAX_FILES}`
		);
	}

	const bytes = await readyBytes(request.files);
	await mkdir(dirname(request.destination), { recursive: true });
	try {
		await streamStoreZip(request.files, request.destination);
	} catch (error) {
		await rm(request.destination, { force: true });
		throw error;
	}

	return { destination: request.destination, includedCount, omittedCount, bytes };
}

async function readyBytes(files: readonly ZipExportFile[]) {
	let bytes = 0;
	for (const file of files) {
		const info = await stat(file.path);
		if (!info.isFile()) throw new Error(`ready original is not a file: ${file.path}`);
		bytes += info.size;
		if (bytes > ZIP_EXPORT_MAX_BYTES) {
			throw new ZipExportTooLargeError(
				'bytes',
				`Ready originals are ${bytes} bytes, which exceeds the limit of ${ZIP_EXPORT_MAX_BYTES}`
			);
		}
	}
	return bytes;
}

async function streamStoreZip(files: readonly ZipExportFile[], destination: string) {
	const zip = new ZipFile();
	const output = createWriteStream(destination);
	const completed = finished(output);
	zip.on('error', (error) => {
		output.destroy(error);
	});
	output.on('error', () => {
		zip.outputStream.destroy();
	});
	zip.outputStream.pipe(output);
	try {
		for (const file of files) {
			zip.addFile(file.path, file.name, { compress: false });
		}
		zip.end();
	} catch (error) {
		output.destroy(error instanceof Error ? error : new Error(String(error)));
	}
	await completed;
}
