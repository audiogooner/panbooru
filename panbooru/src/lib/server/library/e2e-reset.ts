import { timingSafeEqual } from 'node:crypto';
import type { AppDatabase } from '#lib/server/db/index.ts';
import { jsonData, jsonError } from '#lib/server/http/json.ts';

function tokensMatch(left: string, right: string) {
	const a = Buffer.from(left);
	const b = Buffer.from(right);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

/**
 * The e2e preview is one process and one database. Drop library rows so a spec
 * cannot see albums, favorites, or saved searches left by an earlier spec.
 * Owner, sessions, and Gelbooru credentials stay so each spec's login fixture
 * still works.
 */
export function resetLibraryForE2e(db: AppDatabase) {
	db.$client.transaction(() => {
		for (const table of [
			'removal_memberships',
			'removal_actions',
			'album_items',
			'favorites',
			'jobs',
			'post_snapshots',
			'saved_items',
			'albums',
			'saved_searches',
			'media_objects'
		]) {
			db.$client.prepare(`delete from ${table}`).run();
		}
	})();
}

export function e2eLibraryReset(request: Request, url: URL, db: AppDatabase): Response | null {
	if (request.method !== 'POST' || url.pathname !== '/api/e2e/reset-library') return null;
	const expected = process.env.PANBOORU_E2E_RESET ?? '';
	if (!expected) return null;
	const provided = request.headers.get('x-panbooru-e2e-reset') ?? '';
	if (!tokensMatch(provided, expected)) return jsonError('FORBIDDEN', 'Reset rejected', 403);
	resetLibraryForE2e(db);
	return jsonData({ reset: true });
}
