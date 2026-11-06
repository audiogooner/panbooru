import { createHash } from 'node:crypto';
import type { AppDatabase } from '#lib/server/db/index.ts';
import { promoteOriginal } from '#lib/server/library/original.ts';

export const ORIGINAL_LEASE_MS = 30_000;

const retryDelayMs = 1_000;

export type OriginalPassOptions = {
	db: AppDatabase;
	dataDir: string;
	now: number;
	fetchFile: (url: string) => Promise<Response>;
	afterTempWrite?: () => void;
};

type ClaimedJob = {
	id: string;
	itemId: string;
	fileUrl: string;
	expectedHash: string | null;
};

function claimJob(db: AppDatabase, now: number, leaseMs: number) {
	return db.$client
		.prepare(
			`update jobs
			 set state = 'leased', lease_until = ?, attempts = attempts + 1
			 where id = (
			 	select id from jobs
			 	where kind = 'original'
			 		and state in ('queued', 'retry', 'leased')
			 		and (lease_until is null or lease_until <= ?)
			 		and (next_attempt_at is null or next_attempt_at <= ?)
			 	order by id
			 	limit 1
			 )
			 returning id, item_id as itemId, file_url as fileUrl, expected_hash as expectedHash`
		)
		.get(now + leaseMs, now, now) as ClaimedJob | undefined;
}

function markRetry(db: AppDatabase, id: string, now: number, error: string) {
	db.$client
		.prepare(
			`update jobs
			 set state = 'retry', lease_until = null, next_attempt_at = ?, error = ?
			 where id = ?`
		)
		.run(now + retryDelayMs, error, id);
}

function markSucceeded(db: AppDatabase, id: string) {
	db.$client
		.prepare(
			`update jobs
			 set state = 'succeeded', lease_until = null, progress = 1, error = null
			 where id = ?`
		)
		.run(id);
}

async function download(job: ClaimedJob, options: OriginalPassOptions) {
	let response: Response;
	try {
		response = await options.fetchFile(job.fileUrl);
	} catch {
		markRetry(options.db, job.id, options.now, 'download failed');
		return;
	}
	const bytes = Buffer.from(await response.arrayBuffer());
	const type = response.headers.get('content-type') ?? '';
	const lengthHeader = response.headers.get('content-length');
	const expectedBytes = lengthHeader === null ? bytes.length : Number(lengthHeader);
	if (!response.ok || !type.startsWith('image/') || !Number.isFinite(expectedBytes)) {
		markRetry(options.db, job.id, options.now, 'verification failed');
		return;
	}
	const expectedHash = job.expectedHash ?? createHash('sha256').update(bytes).digest('hex');
	const promoted = promoteOriginal({
		db: options.db,
		dataDir: options.dataDir,
		itemId: job.itemId,
		body: bytes,
		mime: type.split(';')[0]!.trim(),
		expectedBytes,
		expectedHash,
		afterTempWrite: options.afterTempWrite
	});
	if (!promoted.ready) {
		markRetry(options.db, job.id, options.now, 'verification failed');
		return;
	}
	markSucceeded(options.db, job.id);
}

export async function runOriginalPass(options: OriginalPassOptions) {
	for (;;) {
		const job = claimJob(options.db, options.now, ORIGINAL_LEASE_MS);
		if (!job) return;
		await download(job, options);
	}
}

export function runServiceOriginalPass(services: {
	db: AppDatabase;
	dataDir: string;
	now: () => number;
	fetchUpstream: (url: URL) => Promise<Response>;
}) {
	return runOriginalPass({
		db: services.db,
		dataDir: services.dataDir,
		now: services.now(),
		fetchFile: (url) => services.fetchUpstream(new URL(url))
	});
}
