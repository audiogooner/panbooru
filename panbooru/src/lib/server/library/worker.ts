import { createHash } from 'node:crypto';
import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { AppDatabase } from '#lib/server/db/index.ts';
import {
	runCollectionImportPass,
	type CollectionImportContext
} from '#lib/server/library/collection-import.ts';
import { inMaintenance } from '#lib/server/library/maintenance.ts';
import { promoteOriginal } from '#lib/server/library/original.ts';

export const ORIGINAL_LEASE_MS = 30_000;

const retryDelayMs = 1_000;
let acceptingClaims = true;

export function stopJobClaims() {
	acceptingClaims = false;
}

export function resetJobClaimsForTests() {
	acceptingClaims = true;
}

function onShutdown() {
	stopJobClaims();
}

export function listenForShutdown() {
	if (!process.listeners('SIGTERM').includes(onShutdown)) process.on('SIGTERM', onShutdown);
}

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

function markFailed(db: AppDatabase, id: string, error: string) {
	db.$client
		.prepare(
			`update jobs
			 set state = 'failed', lease_until = null, next_attempt_at = null, error = ?
			 where id = ?`
		)
		.run(error, id);
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
	if (response.status === 404 || response.status === 410) {
		markFailed(options.db, job.id, 'unavailable');
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
	if (!acceptingClaims || inMaintenance(options.dataDir)) return;
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
	if (!acceptingClaims || inMaintenance(options.dataDir)) return;
	if (!promoted.ready) {
		markRetry(options.db, job.id, options.now, 'verification failed');
		return;
	}
	markSucceeded(options.db, job.id);
}

export function reconcileOriginals(db: AppDatabase, dataDir: string, now: number) {
	const tempDir = join(dataDir, 'tmp');
	if (existsSync(tempDir)) {
		for (const name of readdirSync(tempDir)) {
			if (!name.startsWith('original-')) continue;
			try {
				unlinkSync(join(tempDir, name));
			} catch {
				/* a replaced temp file is already gone */
			}
		}
	}
	db.$client
		.prepare(
			`update jobs
			 set state = 'retry', lease_until = null
			 where kind = 'original'
			 	and state = 'leased'
			 	and (lease_until is null or lease_until <= ?)`
		)
		.run(now);
}

export async function runOriginalPass(options: OriginalPassOptions) {
	for (;;) {
		if (!acceptingClaims || inMaintenance(options.dataDir)) return;
		const job = claimJob(options.db, options.now, ORIGINAL_LEASE_MS);
		if (!job) return;
		await download(job, options);
	}
}

export type OriginalJobRow = {
	id: string;
	state: string;
	progress: number;
	error: string | null;
	itemId: string;
};

export function listOriginalJobs(db: AppDatabase) {
	return db.$client
		.prepare(
			`select id, state, progress, error, item_id as itemId
			 from jobs
			 where kind = 'original' and state != 'succeeded'
			 order by id`
		)
		.all() as OriginalJobRow[];
}

export function cancelOriginalJob(db: AppDatabase, id: string) {
	const result = db.$client
		.prepare(
			`update jobs
			 set state = 'cancelled', lease_until = null
			 where id = ? and kind = 'original' and state in ('queued', 'retry')`
		)
		.run(id);
	return result.changes > 0;
}

export function retryOriginalJob(db: AppDatabase, id: string) {
	const result = db.$client
		.prepare(
			`update jobs
			 set state = 'queued', error = null, next_attempt_at = null, lease_until = null
			 where id = ? and kind = 'original' and state = 'failed'`
		)
		.run(id);
	return result.changes > 0;
}

export function dismissOriginalJob(db: AppDatabase, id: string) {
	const result = db.$client
		.prepare(
			`delete from jobs
			 where id = ? and kind = 'original' and state in ('failed', 'cancelled')`
		)
		.run(id);
	return result.changes > 0;
}

export function runServiceOriginalPass(services: CollectionImportContext) {
	const pending = runOriginalPass({
		db: services.db,
		dataDir: services.dataDir,
		now: services.now(),
		fetchFile: (url) => services.fetchUpstream(new URL(url))
	});
	void pending.then(() => {
		kickCollectionImports(services);
	});
	return pending;
}

let pumpingImports = false;
let importsWaiting = false;

function yieldImportTick() {
	return new Promise<void>((resolve) => {
		setTimeout(resolve, 0);
	});
}

/** One collection-import page per turn. Original downloads keep their own pass. */
export function kickCollectionImports(services: CollectionImportContext) {
	importsWaiting = true;
	if (pumpingImports) return;
	pumpingImports = true;
	void drainCollectionImports(services);
}

async function drainCollectionImports(services: CollectionImportContext) {
	try {
		while (importsWaiting) {
			importsWaiting = false;
			if (!acceptingClaims || inMaintenance(services.dataDir)) return;
			let more = false;
			try {
				more = await runCollectionImportPass(services);
			} catch (error) {
				(services.log ?? (() => {}))(
					error instanceof Error ? error.message : 'collection import failed'
				);
				return;
			}
			void runOriginalPass({
				db: services.db,
				dataDir: services.dataDir,
				now: services.now(),
				fetchFile: (url) => services.fetchUpstream(new URL(url))
			}).catch((error: unknown) => {
				(services.log ?? (() => {}))(
					error instanceof Error ? error.message : 'original worker failed'
				);
			});
			if (more) importsWaiting = true;
			if (importsWaiting) await yieldImportTick();
		}
	} finally {
		pumpingImports = false;
		if (importsWaiting && acceptingClaims && !inMaintenance(services.dataDir)) {
			kickCollectionImports(services);
		}
	}
}
