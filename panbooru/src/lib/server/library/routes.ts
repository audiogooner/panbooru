import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { serveStoredThumb } from '#lib/server/media/serve.ts';
import { fileMediaResponse } from '#lib/server/media/range.ts';
import type { AppServices } from '#lib/server/auth/dispatch.ts';
import { jsonData, jsonError } from '#lib/server/http/json.ts';
import {
	closeTemporaryAlbum,
	createSavedSearch,
	deleteSavedSearch,
	listAlbumCollection,
	listSavedSearches,
	matchSavedSearch,
	openTemporaryAlbum,
	parseCoverSlots,
	pinAlbum,
	readAlbum,
	readAppliedSearch,
	readSavedSearch,
	readSavedSearchName,
	readSavedSearchType,
	renameAlbum,
	saveAlbumCover,
	saveSavedSearchCover,
	updateSavedSearch
} from '#lib/server/library/collections.ts';
import {
	createAlbum,
	deleteAlbumRecord,
	getAlbum,
	removeMemberships,
	saveAlbumMembership,
	saveFavorite,
	type PostMetadata
} from '#lib/server/library/save.ts';
import { inMaintenance } from '#lib/server/library/maintenance.ts';
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
		itemId?: unknown;
	} | null;
	const savedId = typeof body?.itemId === 'string' ? body.itemId : '';
	if (savedId && typeof body?.remoteId !== 'string') {
		const row = services.db.$client
			.prepare(
				`select post_snapshots.snapshot as snapshot
				 from saved_items
				 join post_snapshots on post_snapshots.id = saved_items.snapshot_id
				 where saved_items.id = ?`
			)
			.get(savedId) as { snapshot: string } | undefined;
		if (!row) return null;
		const snapshot = JSON.parse(row.snapshot) as {
			source?: unknown;
			remoteId?: unknown;
			tags?: unknown;
			width?: unknown;
			height?: unknown;
			fileUrl?: unknown;
			rating?: unknown;
		};
		const tags = Array.isArray(snapshot.tags)
			? snapshot.tags.filter((tag): tag is string => typeof tag === 'string')
			: [];
		const width = Number(snapshot.width);
		const height = Number(snapshot.height);
		if (typeof snapshot.remoteId !== 'string' || typeof snapshot.fileUrl !== 'string') return null;
		if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
		const rating = typeof snapshot.rating === 'string' ? snapshot.rating : '';
		return {
			source: typeof snapshot.source === 'string' ? snapshot.source : 'gelbooru',
			remoteId: snapshot.remoteId,
			tags,
			width,
			height,
			fileUrl: snapshot.fileUrl,
			...(rating ? { rating } : {})
		};
	}
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
	if (request.method !== 'GET' && request.method !== 'HEAD' && inMaintenance(services.dataDir)) {
		return jsonError('UNAVAILABLE', 'Library is in maintenance', 503);
	}

	if (request.method === 'POST' && url.pathname === '/api/library/favorites') {
		const metadata = await readMetadata(request, services);
		if (!metadata) return jsonError('BAD_REQUEST', 'Post metadata is invalid', 400);
		return finishSave(services, saveFavorite(services.db, metadata, services.now()));
	}

	if (request.method === 'GET' && url.pathname === '/api/library/favorites/suggestions') {
		const pattern = url.searchParams.get('pattern') ?? '';
		return jsonData({ suggestions: suggestFavorites(services.db, pattern) });
	}

	if (request.method === 'GET' && url.pathname === '/api/library/albums') {
		return jsonData(listAlbumCollection(services.db));
	}

	if (request.method === 'GET' && url.pathname === '/api/library/albums/membership') {
		const remoteId = url.searchParams.get('remoteId') ?? '';
		const itemId = url.searchParams.get('itemId') ?? '';
		if (!remoteId && !itemId) return jsonError('BAD_REQUEST', 'Post is invalid', 400);
		const rows = services.db.$client
			.prepare(
				`select album_items.album_id as albumId, album_items.item_id as itemId
				 from album_items
				 join saved_items on saved_items.id = album_items.item_id
				 where ${itemId ? 'saved_items.id = ?' : "saved_items.source = 'gelbooru' and saved_items.remote_id = ?"}`
			)
			.all(itemId || remoteId) as { albumId: string; itemId: string }[];
		return jsonData({ memberships: rows });
	}

	if (request.method === 'POST' && url.pathname === '/api/library/albums') {
		const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
		const name = typeof body?.name === 'string' ? body.name.trim() : '';
		if (!name || name.length > 80) return jsonError('BAD_REQUEST', 'Album name is invalid', 400);
		const created = createAlbum(services.db, name, services.now());
		const album = readAlbum(services.db, created.id);
		if (!album) return jsonError('NOT_FOUND', 'Album was not found', 404);
		return jsonData(album);
	}

	if (request.method === 'GET' && url.pathname === '/api/library/saved-searches') {
		const rawType = url.searchParams.get('type');
		const parsedType = readSavedSearchType(
			rawType === null || rawType === '' ? undefined : rawType
		);
		if (!parsedType.ok) return jsonError('BAD_REQUEST', 'Saved search type is invalid', 400);
		return jsonData({
			savedSearches: listSavedSearches(services.db, {
				q: url.searchParams.get('q') ?? '',
				...(parsedType.type ? { type: parsedType.type } : {})
			})
		});
	}

	if (request.method === 'POST' && url.pathname === '/api/library/saved-searches') {
		const body = await readJson(request);
		const applied = readAppliedSearch(body);
		if (!applied.ok) return jsonError('BAD_REQUEST', applied.message, 400);
		const parsedType = readSavedSearchType(field(body, 'type'));
		if (!parsedType.ok) return jsonError('BAD_REQUEST', 'Saved search type is invalid', 400);
		const parsedName = readSavedSearchName(field(body, 'name'));
		if (!parsedName.ok) return jsonError('BAD_REQUEST', 'Saved search name is invalid', 400);
		const created = createSavedSearch(
			services.db,
			{ applied: applied.applied, type: parsedType.type ?? 'search', name: parsedName.name },
			services.now()
		);
		if (!created.ok && created.reason === 'conflict') {
			return jsonConflict('A saved search already matches this applied query', created.matchId);
		}
		if (!created.ok) return jsonError('BAD_REQUEST', created.message, 400);
		return jsonData(created.savedSearch);
	}

	if (request.method === 'POST' && url.pathname === '/api/library/saved-searches/match') {
		const applied = readAppliedSearch(await readJson(request));
		if (!applied.ok) return jsonError('BAD_REQUEST', applied.message, 400);
		return jsonData(matchSavedSearch(services.db, applied.applied));
	}

	const savedSearchCover = url.pathname.match(/^\/api\/library\/saved-searches\/([^/]+)\/cover$/);
	if (savedSearchCover && request.method === 'PUT') {
		const slots = coverSlotsFrom(await readJson(request));
		if (!slots) return jsonError('BAD_REQUEST', 'Cover is invalid', 400);
		const saved = saveSavedSearchCover(
			services.db,
			decodeURIComponent(savedSearchCover[1] ?? ''),
			slots,
			services.now()
		);
		if (!saved) return jsonError('NOT_FOUND', 'Saved search was not found', 404);
		return jsonData(saved);
	}

	const savedSearchOpen = url.pathname.match(/^\/api\/library\/saved-searches\/([^/]+)\/open$/);
	if (savedSearchOpen && request.method === 'POST') {
		const saved = readSavedSearch(services.db, decodeURIComponent(savedSearchOpen[1] ?? ''));
		if (!saved) return jsonError('NOT_FOUND', 'Saved search was not found', 404);
		return jsonData(saved);
	}

	const savedSearchItem = url.pathname.match(/^\/api\/library\/saved-searches\/([^/]+)$/);
	if (savedSearchItem) {
		const id = decodeURIComponent(savedSearchItem[1] ?? '');
		if (request.method === 'GET') {
			const saved = readSavedSearch(services.db, id);
			if (!saved) return jsonError('NOT_FOUND', 'Saved search was not found', 404);
			return jsonData(saved);
		}
		if (request.method === 'POST') {
			const body = await readJson(request);
			const parsedType = readSavedSearchType(field(body, 'type'));
			if (!parsedType.ok) return jsonError('BAD_REQUEST', 'Saved search type is invalid', 400);
			const parsedName = readSavedSearchName(field(body, 'name'));
			if (!parsedName.ok) return jsonError('BAD_REQUEST', 'Saved search name is invalid', 400);
			const updated = updateSavedSearch(
				services.db,
				id,
				{
					...(parsedName.name !== null ? { name: parsedName.name } : {}),
					...(parsedType.type ? { type: parsedType.type } : {})
				},
				services.now()
			);
			if (updated === 'invalid') {
				return jsonError('BAD_REQUEST', 'Saved search update is invalid', 400);
			}
			if (!updated) return jsonError('NOT_FOUND', 'Saved search was not found', 404);
			return jsonData(updated);
		}
		if (request.method === 'DELETE') {
			if (!deleteSavedSearch(services.db, id)) {
				return jsonError('NOT_FOUND', 'Saved search was not found', 404);
			}
			return jsonData({ removed: true });
		}
	}

	const albumName = url.pathname.match(/^\/api\/library\/albums\/([^/]+)\/name$/);
	if (albumName && request.method === 'POST') {
		const body = await readJson(request);
		const rawName = field(body, 'name');
		const name = typeof rawName === 'string' ? rawName : '';
		const renamed = renameAlbum(
			services.db,
			decodeURIComponent(albumName[1] ?? ''),
			name,
			services.now()
		);
		if (renamed === 'invalid') return jsonError('BAD_REQUEST', 'Album name is invalid', 400);
		if (!renamed) return jsonError('NOT_FOUND', 'Album was not found', 404);
		return jsonData(renamed);
	}

	const albumPin = url.pathname.match(/^\/api\/library\/albums\/([^/]+)\/pin$/);
	if (albumPin && request.method === 'POST') {
		const pin = readPin(await readJson(request));
		if (!pin) return jsonError('BAD_REQUEST', 'Pin state is invalid', 400);
		const placed = pinAlbum(
			services.db,
			decodeURIComponent(albumPin[1] ?? ''),
			pin,
			services.now()
		);
		if (placed === 'invalid') return jsonError('BAD_REQUEST', 'Pin state is invalid', 400);
		if (!placed) return jsonError('NOT_FOUND', 'Album was not found', 404);
		return jsonData(placed);
	}

	const albumOpen = url.pathname.match(/^\/api\/library\/albums\/([^/]+)\/open$/);
	if (albumOpen && request.method === 'POST') {
		const placed = openTemporaryAlbum(
			services.db,
			decodeURIComponent(albumOpen[1] ?? ''),
			services.now()
		);
		if (!placed) return jsonError('NOT_FOUND', 'Album was not found', 404);
		return jsonData(placed);
	}
	if (albumOpen && request.method === 'DELETE') {
		const placed = closeTemporaryAlbum(services.db, decodeURIComponent(albumOpen[1] ?? ''));
		if (!placed) return jsonError('NOT_FOUND', 'Album was not found', 404);
		return jsonData(placed);
	}

	const albumCover = url.pathname.match(/^\/api\/library\/albums\/([^/]+)\/cover$/);
	if (albumCover && request.method === 'PUT') {
		const slots = coverSlotsFrom(await readJson(request));
		if (!slots) return jsonError('BAD_REQUEST', 'Cover is invalid', 400);
		const saved = saveAlbumCover(
			services.db,
			decodeURIComponent(albumCover[1] ?? ''),
			slots,
			services.now()
		);
		if (saved === 'not-member') {
			return jsonError('BAD_REQUEST', 'Cover image is not in this album', 400);
		}
		if (!saved) return jsonError('NOT_FOUND', 'Album was not found', 404);
		return jsonData(saved);
	}

	const albumRecord = url.pathname.match(/^\/api\/library\/albums\/([^/]+)$/);
	if (albumRecord && request.method === 'GET') {
		const album = readAlbum(services.db, decodeURIComponent(albumRecord[1] ?? ''));
		if (!album) return jsonError('NOT_FOUND', 'Album was not found', 404);
		return jsonData(album);
	}
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
		const actionId = decodeURIComponent(removalUndo[1] ?? '');
		const held = services.db.$client
			.prepare('select item_id as itemId from removal_memberships where action_id = ?')
			.all(actionId) as { itemId: string }[];
		const restored = undoRemoval(services.db, services.dataDir, actionId, services.now());
		if (!restored) return jsonError('NOT_FOUND', 'Removal can no longer be undone', 404);
		const previews = held
			.map((row) =>
				readyOriginal(services, row.itemId)
					? `/api/library/originals/${encodeURIComponent(row.itemId)}`
					: null
			)
			.filter((src): src is string => src !== null);
		return jsonData({ restored: true, previews });
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
		if (url.searchParams.get('recipe') === 'thumb') {
			const thumb = await serveStoredThumb(request, services, itemId, path);
			if (thumb) return thumb;
		}
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

function jsonConflict(message: string, matchId: string) {
	return Response.json(
		{
			code: 'CONFLICT',
			message,
			retryable: false,
			requestId: randomUUID(),
			matchId
		},
		{ status: 409, headers: { 'cache-control': 'private, no-store' } }
	);
}

async function readJson(request: Request) {
	return (await request.json().catch(() => null)) as unknown;
}

function field(body: unknown, key: string) {
	if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
	return (body as Record<string, unknown>)[key];
}

function coverSlotsFrom(body: unknown) {
	if (Array.isArray(body)) return parseCoverSlots(body);
	return parseCoverSlots(field(body, 'slots'));
}

function readPin(body: unknown) {
	const pinned = field(body, 'pinned');
	const position = field(body, 'position');
	const keepOpen = field(body, 'keepOpen');
	if (typeof pinned !== 'boolean') return null;
	if (position !== undefined && typeof position !== 'number') return null;
	if (keepOpen !== undefined && typeof keepOpen !== 'boolean') return null;
	return {
		pinned,
		...(typeof position === 'number' ? { position } : {}),
		keepOpen: keepOpen === true
	};
}

