import { join } from 'node:path';
import { fileMediaResponse } from '#lib/server/media/range.ts';
import type { AppServices } from '#lib/server/auth/dispatch.ts';
import { jsonData, jsonError } from '#lib/server/http/json.ts';
import {
	createAlbum,
	deleteAlbumRecord,
	getAlbum,
	removeMemberships,
	saveAlbumMembership,
	saveFavorite,
	type PostMetadata
} from '#lib/server/library/save.ts';
import { undoRemoval } from '#lib/server/library/removal.ts';
import { suggestAlbum, suggestFavorites } from '#lib/server/library/search.ts';
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

async function readMetadata(request: Request, services: AppServices): Promise<PostMetadata | null> {
	const body = (await request.json().catch(() => null)) as {
		remoteId?: unknown;
		tags?: unknown;
		width?: unknown;
		height?: unknown;
		mediaRef?: unknown;
		rating?: unknown;
	} | null;
	const remoteId = typeof body?.remoteId === 'string' ? body.remoteId : '';
	const mediaRef = typeof body?.mediaRef === 'string' ? body.mediaRef : '';
	const tags = Array.isArray(body?.tags)
		? body.tags.filter((tag): tag is string => typeof tag === 'string')
		: [];
	const width = Number(body?.width);
	const height = Number(body?.height);
	const rating = typeof body?.rating === 'string' ? body.rating.trim() : '';
	const fileUrl = services.media.get(mediaRef)?.fileUrl ?? '';
	if (!remoteId || !fileUrl || !Number.isFinite(width) || !Number.isFinite(height)) return null;
	return {
		source: 'gelbooru',
		remoteId,
		tags,
		width,
		height,
		fileUrl,
		...(rating ? { rating } : {})
	};
}

function finishSave(
	services: AppServices,
	saved: { itemId: string; membership: 'favorite' | 'album'; original: 'queued' | 'ready' }
) {
	void runServiceOriginalPass(services).catch((error: unknown) => {
		services.log(error instanceof Error ? error.message : 'original worker failed');
	});
	return jsonData({
		itemId: saved.itemId,
		membership: saved.membership,
		original: saved.original
	});
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
		const metadata = await readMetadata(request, services);
		if (!metadata) return jsonError('BAD_REQUEST', 'Post metadata is invalid', 400);
		return finishSave(services, saveFavorite(services.db, metadata, services.now()));
	}

	if (request.method === 'GET' && url.pathname === '/api/library/favorites/suggestions') {
		const pattern = url.searchParams.get('pattern') ?? '';
		return jsonData({ suggestions: suggestFavorites(services.db, pattern) });
	}

	if (request.method === 'POST' && url.pathname === '/api/library/albums') {
		const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
		const name = typeof body?.name === 'string' ? body.name.trim() : '';
		if (!name || name.length > 80) return jsonError('BAD_REQUEST', 'Album name is invalid', 400);
		return jsonData(createAlbum(services.db, name, services.now()));
	}

	const albumRecord = url.pathname.match(/^\/api\/library\/albums\/([^/]+)$/);
	if (request.method === 'DELETE' && albumRecord) {
		const removed = deleteAlbumRecord(
			services.db,
			services.dataDir,
			decodeURIComponent(albumRecord[1] ?? '')
		);
		if (!removed) return jsonError('NOT_FOUND', 'Album was not found', 404);
		return jsonData({ removed: true });
	}

	const albumSuggestions = url.pathname.match(/^\/api\/library\/albums\/([^/]+)\/suggestions$/);
	if (request.method === 'GET' && albumSuggestions) {
		const albumId = decodeURIComponent(albumSuggestions[1] ?? '');
		if (!getAlbum(services.db, albumId)) return jsonError('NOT_FOUND', 'Album was not found', 404);
		const pattern = url.searchParams.get('pattern') ?? '';
		return jsonData({ suggestions: suggestAlbum(services.db, albumId, pattern) });
	}

	const albumItemsPath = url.pathname.match(/^\/api\/library\/albums\/([^/]+)\/items$/);
	if (request.method === 'POST' && albumItemsPath) {
		const albumId = decodeURIComponent(albumItemsPath[1] ?? '');
		if (!getAlbum(services.db, albumId)) return jsonError('NOT_FOUND', 'Album was not found', 404);
		const metadata = await readMetadata(request, services);
		if (!metadata) return jsonError('BAD_REQUEST', 'Post metadata is invalid', 400);
		return finishSave(
			services,
			saveAlbumMembership(services.db, metadata, albumId, services.now())
		);
	}

	const removalUndo = url.pathname.match(/^\/api\/library\/removals\/([^/]+)\/undo$/);
	if (request.method === 'POST' && removalUndo) {
		const restored = undoRemoval(
			services.db,
			services.dataDir,
			decodeURIComponent(removalUndo[1] ?? ''),
			services.now()
		);
		if (!restored) return jsonError('NOT_FOUND', 'Removal can no longer be undone', 404);
		return jsonData({ restored: true });
	}

	const favoriteItem = url.pathname.match(/^\/api\/library\/favorites\/([^/]+)$/);
	if (request.method === 'DELETE' && favoriteItem) {
		const removed = removeMemberships(services.db, services.dataDir, [
			{ itemId: decodeURIComponent(favoriteItem[1] ?? ''), kind: 'favorite' }
		]);
		if (!removed) return jsonError('NOT_FOUND', 'Favorite was not found', 404);
		return jsonData({ removed: true });
	}

	const albumItem = url.pathname.match(/^\/api\/library\/albums\/([^/]+)\/items\/([^/]+)$/);
	if (request.method === 'DELETE' && albumItem) {
		const removed = removeMemberships(services.db, services.dataDir, [
			{
				itemId: decodeURIComponent(albumItem[2] ?? ''),
				kind: 'album',
				albumId: decodeURIComponent(albumItem[1] ?? '')
			}
		]);
		if (!removed) return jsonError('NOT_FOUND', 'Album post was not found', 404);
		return jsonData({ removed: true });
	}

	if (
		(request.method === 'GET' || request.method === 'HEAD') &&
		url.pathname.startsWith('/api/library/originals/')
	) {
		const itemId = decodeURIComponent(url.pathname.slice('/api/library/originals/'.length));
		const row = readyOriginal(services, itemId);
		const path = row ? localPath(services.dataDir, row.relativePath) : null;
		if (!path) return jsonError('NOT_FOUND', 'Original is not ready', 404);
		const streamed = fileMediaResponse(
			path,
			request.method,
			request.headers.get('range'),
			row.mime || 'application/octet-stream'
		);
		if (!streamed) return jsonError('NOT_FOUND', 'Original is not ready', 404);
		return streamed;
	}

	return null;
}
