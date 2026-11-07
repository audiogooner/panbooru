import { createHash, randomUUID } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '#lib/server/db/index.ts';
import { mediaObjects, savedItems } from '#lib/server/db/schema.ts';

export type PromoteRequest = {
	db: AppDatabase;
	dataDir: string;
	itemId: string;
	body: Buffer;
	mime: string;
	expectedBytes: number;
	expectedHash: string;
	afterTempWrite?: () => void;
};

export type PromoteResult = {
	ready: boolean;
	mediaId: string | null;
	relativePath: string | null;
};

const notReady: PromoteResult = { ready: false, mediaId: null, relativePath: null };

export function promoteOriginal(request: PromoteRequest): PromoteResult {
	const tempDir = join(request.dataDir, 'tmp');
	const tempPath = join(tempDir, `original-${randomUUID()}`);
	let written: Buffer;
	try {
		mkdirSync(tempDir, { recursive: true });
		writeFileSync(tempPath, request.body);
		written = readFileSync(tempPath);
	} catch {
		try {
			unlinkSync(tempPath);
		} catch {
			/* the partial file is already gone */
		}
		return notReady;
	}
	const hash = createHash('sha256').update(written).digest('hex');
	if (written.length !== request.expectedBytes || hash !== request.expectedHash) {
		unlinkSync(tempPath);
		return notReady;
	}
	request.afterTempWrite?.();

	const relativePath = join('media', 'originals', hash);
	const finalPath = join(request.dataDir, relativePath);
	try {
		mkdirSync(join(request.dataDir, 'media', 'originals'), { recursive: true });
		if (existsSync(finalPath)) unlinkSync(tempPath);
		else renameSync(tempPath, finalPath);
	} catch {
		return notReady;
	}

	const mediaId = request.db.transaction((tx) => {
		const item = tx.select().from(savedItems).where(eq(savedItems.id, request.itemId)).get();
		if (!item) throw new Error('saved item was not found');
		const existing = tx.select().from(mediaObjects).where(eq(mediaObjects.contentHash, hash)).get();
		const id = existing?.id ?? randomUUID();
		if (existing) {
			tx.update(mediaObjects)
				.set({
					relativePath,
					mime: request.mime,
					byteSize: written.length,
					verifiedAt: Date.now(),
					state: 'ready'
				})
				.where(eq(mediaObjects.id, id))
				.run();
		} else {
			tx.insert(mediaObjects)
				.values({
					id,
					contentHash: hash,
					relativePath,
					mime: request.mime,
					byteSize: written.length,
					verifiedAt: Date.now(),
					state: 'ready'
				})
				.run();
		}
		tx.update(savedItems).set({ mediaId: id }).where(eq(savedItems.id, request.itemId)).run();
		return id;
	});

	return { ready: true, mediaId, relativePath };
}
