import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppServices } from '#lib/server/auth/dispatch.ts';
import { jsonData, jsonError } from '#lib/server/http/json.ts';
import { saveFavorite } from '#lib/server/library/save.ts';
import { runServiceOriginalPass } from '#lib/server/library/worker.ts';

type ReadyOriginal = {
	relativePath: string;
	mime: string | null;
};

function readyOriginal(services: AppServices, itemId: string) {
	return services.db.$client
		.prepare(
			`select media_objects.relative_path as relativePath, media_objects.mime as mime
			 from saved_items
			 join media_objects on media_objects.id = saved_items.media_id
			 where saved_items.id = ? and media_objects.state = 'ready'`
		)
		.get(itemId) as ReadyOriginal | undefined;
}

function localPath(dataDir: string, relativePath: string) {
	if (!relativePath || relativePath.startsWith('/') || relativePath.includes('..')) return null;
	return join(dataDir, relativePath);
}

export async function handleLibrary(
	request: Request,
	url: URL,
	services: AppServices,
	hasSession: boolean
) {
	if (!url.pathname.startsWith('/api/library/')) return null;
	if (!hasSession) return jsonError('UNAUTHORIZED', 'Session required', 401);

	if (request.method === 'POST' && url.pathname === '/api/library/favorites') {
		const body = (await request.json().catch(() => null)) as {
			remoteId?: unknown;
			tags?: unknown;
			width?: unknown;
			height?: unknown;
			mediaRef?: unknown;
		} | null;
		const remoteId = typeof body?.remoteId === 'string' ? body.remoteId : '';
		const mediaRef = typeof body?.mediaRef === 'string' ? body.mediaRef : '';
		const tags = Array.isArray(body?.tags)
			? body.tags.filter((tag): tag is string => typeof tag === 'string')
			: [];
		const width = Number(body?.width);
		const height = Number(body?.height);
		const fileUrl = services.media.get(mediaRef);
		if (!remoteId || !fileUrl || !Number.isFinite(width) || !Number.isFinite(height)) {
			return jsonError('BAD_REQUEST', 'Post metadata is invalid', 400);
		}
		const saved = saveFavorite(
			services.db,
			{ source: 'gelbooru', remoteId, tags, width, height, fileUrl },
			services.now()
		);
		await runServiceOriginalPass(services);
		const ready = readyOriginal(services, saved.itemId);
		return jsonData({
			itemId: saved.itemId,
			membership: saved.membership,
			original: ready ? 'ready' : saved.original
		});
	}

	if (
		(request.method === 'GET' || request.method === 'HEAD') &&
		url.pathname.startsWith('/api/library/originals/')
	) {
		const itemId = decodeURIComponent(url.pathname.slice('/api/library/originals/'.length));
		const row = readyOriginal(services, itemId);
		const path = row ? localPath(services.dataDir, row.relativePath) : null;
		if (!path) return jsonError('NOT_FOUND', 'Original is not ready', 404);
		let bytes: Buffer;
		try {
			bytes = readFileSync(path);
		} catch {
			return jsonError('NOT_FOUND', 'Original is not ready', 404);
		}
		return new Response(request.method === 'HEAD' ? null : bytes, {
			headers: {
				'content-type': row?.mime || 'application/octet-stream',
				'content-length': String(bytes.length),
				'x-content-type-options': 'nosniff',
				'cache-control': 'private, no-store'
			}
		});
	}

	return null;
}
