import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppDatabase } from '#lib/server/db/index.ts';
import { gelbooruCredentialState } from '#lib/server/sources/gelbooru.ts';

type ReadinessServices = {
	db: AppDatabase;
	dataDir: string;
	secretPath?: string;
};

export function readinessReport(services: ReadinessServices) {
	let database: 'ok' | 'unavailable' = 'ok';
	try {
		services.db.$client.prepare('select 1 as ok').get();
	} catch {
		database = 'unavailable';
	}

	let key: 'ok' | 'missing' | 'unavailable' = 'missing';
	if (services.secretPath && existsSync(services.secretPath)) {
		try {
			const bytes = readFileSync(services.secretPath);
			key =
				bytes.length === 32 &&
				gelbooruCredentialState(services.db, services.secretPath) !== 'unavailable'
					? 'ok'
					: 'unavailable';
		} catch {
			key = 'unavailable';
		}
	}

	let storage: 'ok' | 'unavailable' = 'ok';
	const probe = join(services.dataDir, 'tmp', `.ready-${randomUUID()}`);
	try {
		writeFileSync(probe, 'ok');
		unlinkSync(probe);
	} catch {
		storage = 'unavailable';
	}

	return { database, key, storage };
}
