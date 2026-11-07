import { randomUUID } from 'node:crypto';
import { createReadStream, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
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
	mediaChoices,
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
import { matchSavedPosts } from '#lib/server/library/query.ts';
import { compileRatingTags } from '#lib/server/library/rating-tags.ts';
import { isVideoFile } from '#lib/server/media/derivative.ts';
import {
	ZIP_EXPORT_MAX_FILES,
	ZipExportTooLargeError,
	writeExportZip,
	type ZipExportFile
} from '#lib/server/library/export-zip.ts';
import {
	gelbooruCredentialState,
	gelbooruJson,
	readGelbooruAuth
} from '#lib/server/sources/gelbooru.ts';
import type { AppliedSearch, MediaChoice, SortChoice } from '#lib/server/library/collections.ts';
import {
	cancelCollectionImport,
	createCollectionImport,
	dismissCollectionImport,
	listCollectionImports,
	pauseAllCollectionImports,
	pauseCollectionImport,
	readCollectionImport,
	resumeCollectionImport,
	retryCollectionImport
} from '#lib/server/library/collection-import.ts';
import {
	cancelOriginalJob,
	dismissOriginalJob,
	kickCollectionImports,
	listOriginalJobs,
	retryOriginalJob,
	runServiceOriginalPass
} from '#lib/server/library/worker.ts';

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

	if (request.method === 'GET' && url.pathname === '/api/library/jobs') {
		return jsonData({
			jobs: listOriginalJobs(services.db),
			imports: listCollectionImports(services.db)
		});
	}

	if (request.method === 'POST' && url.pathname === '/api/library/imports') {
		const created = createCollectionImport(services.db, await readJson(request), services.now());
		if (!created.ok) {
			return jsonError(
				created.status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST',
				created.message,
				created.status
			);
		}
		kickCollectionImports(services);
		return jsonData({ import: created.import });
	}

	if (request.method === 'POST' && url.pathname === '/api/library/exports') {
		return exportOriginals(services, await readJson(request));
	}

	if (request.method === 'POST' && url.pathname === '/api/library/imports/pause-all') {
		pauseAllCollectionImports(services.db, services.now());
		return jsonData({ imports: listCollectionImports(services.db) });
	}

	const importAction = url.pathname.match(
		/^\/api\/library\/imports\/([^/]+)\/(pause|resume|cancel|retry|dismiss)$/
	);
	if (importAction && request.method === 'POST') {
		const id = decodeURIComponent(importAction[1] ?? '');
		const action = importAction[2];
		const changed =
			action === 'pause'
				? pauseCollectionImport(services.db, id, services.now())
				: action === 'resume'
					? resumeCollectionImport(services.db, id, services.now())
					: action === 'cancel'
						? cancelCollectionImport(services.db, id, services.now())
						: action === 'retry'
							? retryCollectionImport(services.db, id, services.now())
							: dismissCollectionImport(services.db, id);
		if (!changed) return jsonError('NOT_FOUND', 'Import was not found', 404);
		if (action === 'resume' || action === 'retry') kickCollectionImports(services);
		if (action === 'dismiss') return jsonData({ removed: true });
		return jsonData({ import: readCollectionImport(services.db, id) });
	}

	const jobAction = url.pathname.match(/^\/api\/library\/jobs\/([^/]+)\/(retry|dismiss|cancel)$/);
	if (jobAction && request.method === 'POST') {
		const id = decodeURIComponent(jobAction[1] ?? '');
		const action = jobAction[2];
		const changed =
			action === 'retry'
				? retryOriginalJob(services.db, id)
				: action === 'cancel'
					? cancelOriginalJob(services.db, id)
					: dismissOriginalJob(services.db, id);
		if (!changed) return jsonError('NOT_FOUND', 'Download job was not found', 404);
		if (action === 'retry') {
			void runServiceOriginalPass(services).catch((error: unknown) => {
				services.log(error instanceof Error ? error.message : 'original worker failed');
			});
		}
		return jsonData({ jobs: listOriginalJobs(services.db) });
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
		const download = url.searchParams.get('download') === '1';
		if (!download && url.searchParams.get('recipe') === 'thumb') {
			const thumb = await serveStoredThumb(request, services, itemId, path);
			if (thumb) return thumb;
		}
		const streamed = fileMediaResponse(
			path,
			request.method,
			request.headers.get('range'),
			row.mime || 'application/octet-stream',
			download ? { filename: originalDownloadName(services, itemId) } : undefined
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

type OriginalCandidate = {
	itemId: string;
	remoteId: string;
	relativePath: string | null;
	state: string | null;
	snapshot: string;
};

type ExportCommand =
	| { kind: 'ids'; ids: string[] }
	| {
			kind: 'query';
			source: 'gelbooru' | 'favorites' | 'album';
			sourceAlbumId: string | null;
			applied: AppliedSearch;
			excluded: string[];
			seed: number;
	  };

type ExportPacked = {
	files: ZipExportFile[];
	omitted: string[];
};

const originalColumns = `
	saved_items.id as itemId,
	saved_items.remote_id as remoteId,
	post_snapshots.snapshot as snapshot,
	media_objects.relative_path as relativePath,
	media_objects.state as state
`;

const exportPageLimit = 100;

function readIdList(value: unknown) {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) return null;
	const ids: string[] = [];
	for (const item of value) {
		if (typeof item !== 'string') return null;
		const id = item.trim();
		if (!id || id.length > 200) return null;
		if (!ids.includes(id)) ids.push(id);
	}
	if (ids.length > 10_000) return null;
	return ids;
}

function readExportSeed(value: unknown) {
	if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1_000_000) {
		return value;
	}
	return 0;
}

function parseExport(body: unknown): ExportCommand | Response {
	const draft = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
	const itemIds = readIdList(draft.itemIds);
	if (itemIds === null) return jsonError('BAD_REQUEST', 'Export selection is invalid', 400);
	const excluded = readIdList(draft.excludedIds);
	if (excluded === null) return jsonError('BAD_REQUEST', 'Excluded posts are invalid', 400);
	const whole =
		typeof draft.query === 'string' || (typeof draft.source === 'string' && itemIds === undefined);
	if (!whole) {
		if (!itemIds?.length) return jsonError('BAD_REQUEST', 'Export selection is invalid', 400);
		return { kind: 'ids', ids: itemIds };
	}
	const source = draft.source;
	if (source !== 'gelbooru' && source !== 'favorites' && source !== 'album') {
		return jsonError('BAD_REQUEST', 'Export source is invalid', 400);
	}
	const applied = readAppliedSearch({
		query: draft.query === undefined ? '' : draft.query,
		rating: draft.rating,
		media: draft.media,
		sort: draft.sort
	});
	if (!applied.ok) return jsonError('BAD_REQUEST', applied.message, 400);
	let sourceAlbumId: string | null = null;
	if (source === 'album') {
		sourceAlbumId = typeof draft.sourceAlbumId === 'string' ? draft.sourceAlbumId.trim() : '';
		if (!sourceAlbumId) return jsonError('BAD_REQUEST', 'Source album is invalid', 400);
	}
	return {
		kind: 'query',
		source,
		sourceAlbumId,
		applied: applied.applied,
		excluded: excluded ?? [],
		seed: readExportSeed(draft.seed)
	};
}

function parsedSnapshot(snapshot: string) {
	try {
		const parsed = JSON.parse(snapshot) as {
			tags?: unknown;
			rating?: unknown;
			fileUrl?: unknown;
		};
		const tags = Array.isArray(parsed.tags)
			? parsed.tags.filter((tag): tag is string => typeof tag === 'string')
			: [];
		const fileUrl = typeof parsed.fileUrl === 'string' ? parsed.fileUrl : '';
		const rating = typeof parsed.rating === 'string' && parsed.rating ? parsed.rating : null;
		return { tags, rating, fileUrl };
	} catch {
		return null;
	}
}

function exportFileName(fileUrl: string) {
	try {
		const name = new URL(fileUrl).pathname.split('/').pop() ?? '';
		return /^[A-Za-z0-9._-]+$/.test(name) ? name : 'original';
	} catch {
		return 'original';
	}
}

function uniqueZipName(used: Set<string>, label: string) {
	const base = label.includes('://') ? exportFileName(label) : label.replace(/[^A-Za-z0-9._-]/g, '') || 'original';
	if (!used.has(base)) {
		used.add(base);
		return base;
	}
	const dot = base.lastIndexOf('.');
	const stem = dot > 0 ? base.slice(0, dot) : base;
	const ext = dot > 0 ? base.slice(dot) : '';
	let index = 2;
	let name = `${stem}-${index}${ext}`;
	while (used.has(name)) {
		index += 1;
		name = `${stem}-${index}${ext}`;
	}
	used.add(name);
	return name;
}

function exportSortTag(sort: SortChoice, seed: number) {
	if (sort === 'Oldest') return 'sort:id:asc';
	if (sort === 'Highest score') return 'sort:score';
	if (sort === 'Random') return `sort:random:${seed}`;
	return '';
}

function exportMediaTag(selected: readonly MediaChoice[]) {
	const images = selected.includes('Images');
	const animated = selected.includes('Animated images');
	const videos = selected.includes('Videos');
	if ((images && animated && videos) || (!images && !animated && !videos)) return '';
	if (videos && !images && !animated) return 'video';
	if (animated && !images && !videos) return 'animated';
	if (!images) return '';
	return [videos ? '' : '-video', animated ? '' : '-animated'].filter(Boolean).join(' ');
}

function exportPath(fileUrl: string) {
	try {
		return new URL(fileUrl).pathname.toLowerCase();
	} catch {
		return fileUrl.toLowerCase();
	}
}

function allowsExportMedia(selected: readonly MediaChoice[], fileUrl: string) {
	if (selected.length === 0 || selected.length === mediaChoices.length) return true;
	if (isVideoFile(fileUrl)) return selected.includes('Videos');
	const path = exportPath(fileUrl);
	const animated = path.endsWith('.gif') || path.endsWith('.webp') || path.endsWith('.apng');
	if (animated) return selected.includes('Animated images');
	return selected.includes('Images');
}

function exportUpstreamTags(applied: AppliedSearch, seed: number) {
	const ratingText = compileRatingTags(applied.rating.map((rating) => rating.toLowerCase()));
	return [applied.query, ratingText, exportSortTag(applied.sort, seed), exportMediaTag(applied.media)]
		.filter(Boolean)
		.join(' ')
		.trim();
}

function chunkedRows(
	db: AppServices['db'],
	sql: (placeholders: string) => string,
	ids: readonly string[],
	leading: readonly unknown[] = []
) {
	if (!ids.length) return [];
	const rows: OriginalCandidate[] = [];
	for (let index = 0; index < ids.length; index += 200) {
		const chunk = ids.slice(index, index + 200);
		const placeholders = chunk.map(() => '?').join(', ');
		rows.push(
			...(db.$client.prepare(sql(placeholders)).all(...leading, ...chunk) as OriginalCandidate[])
		);
	}
	return rows;
}

function rowsByItemId(db: AppServices['db'], ids: readonly string[]) {
	return chunkedRows(
		db,
		(slots) => `
			select ${originalColumns}
			from saved_items
			join post_snapshots on post_snapshots.id = saved_items.snapshot_id
			left join media_objects on media_objects.id = saved_items.media_id
			where saved_items.id in (${slots})
		`,
		ids
	);
}

function rowsByRemoteId(db: AppServices['db'], ids: readonly string[], source?: string) {
	return chunkedRows(
		db,
		(slots) => `
			select ${originalColumns}
			from saved_items
			join post_snapshots on post_snapshots.id = saved_items.snapshot_id
			left join media_objects on media_objects.id = saved_items.media_id
			where ${source ? 'saved_items.source = ? and ' : ''}saved_items.remote_id in (${slots})
		`,
		ids,
		source ? [source] : []
	);
}

function favoriteRows(db: AppServices['db']) {
	return db.$client
		.prepare(
			`select ${originalColumns}
			 from favorites
			 join saved_items on saved_items.id = favorites.item_id
			 join post_snapshots on post_snapshots.id = saved_items.snapshot_id
			 left join media_objects on media_objects.id = saved_items.media_id`
		)
		.all() as OriginalCandidate[];
}

function albumRows(db: AppServices['db'], albumId: string) {
	return db.$client
		.prepare(
			`select ${originalColumns}
			 from album_items
			 join saved_items on saved_items.id = album_items.item_id
			 join post_snapshots on post_snapshots.id = saved_items.snapshot_id
			 left join media_objects on media_objects.id = saved_items.media_id
			 where album_items.album_id = ?`
		)
		.all(albumId) as OriginalCandidate[];
}

function packRow(
	packed: ExportPacked,
	used: Set<string>,
	dataDir: string,
	row: OriginalCandidate | undefined,
	fallback: string
) {
	const snapshot = row ? parsedSnapshot(row.snapshot) : null;
	const fileUrl = snapshot?.fileUrl ?? '';
	const readyPath =
		row?.state === 'ready' && row.relativePath ? localPath(dataDir, row.relativePath) : null;
	if (readyPath) {
		packed.files.push({ path: readyPath, name: uniqueZipName(used, fileUrl || fallback) });
		return;
	}
	const omitted = fileUrl || fallback;
	packed.omitted.push(omitted.includes('://') ? exportFileName(omitted) : omitted);
}

function packGroup(
	packed: ExportPacked,
	used: Set<string>,
	dataDir: string,
	rows: readonly OriginalCandidate[],
	fallback: string
) {
	const ready = rows.find(
		(row) => row.state === 'ready' && row.relativePath && localPath(dataDir, row.relativePath)
	);
	packRow(packed, used, dataDir, ready ?? rows[0], fallback);
}

function packIds(services: AppServices, ids: readonly string[]): ExportPacked {
	const byItem = new Map(rowsByItemId(services.db, ids).map((row) => [row.itemId, row]));
	const missing = ids.filter((id) => !byItem.has(id));
	const byRemote = new Map<string, OriginalCandidate[]>();
	for (const row of rowsByRemoteId(services.db, missing)) {
		const list = byRemote.get(row.remoteId) ?? [];
		list.push(row);
		byRemote.set(row.remoteId, list);
	}
	const packed: ExportPacked = { files: [], omitted: [] };
	const used = new Set<string>();
	for (const id of ids) {
		const item = byItem.get(id);
		if (item) packRow(packed, used, services.dataDir, item, id);
		else packGroup(packed, used, services.dataDir, byRemote.get(id) ?? [], id);
	}
	return packed;
}

function packScope(
	services: AppServices,
	rows: readonly OriginalCandidate[],
	applied: AppliedSearch,
	excluded: readonly string[]
) {
	const skipped = new Set(excluded);
	const prepared = rows
		.filter((row) => !skipped.has(row.itemId))
		.map((row) => {
			const snapshot = parsedSnapshot(row.snapshot);
			return {
				row,
				tags: snapshot?.tags ?? [],
				rating: snapshot?.rating ?? null,
				fileUrl: snapshot?.fileUrl ?? ''
			};
		});
	const matched = matchSavedPosts(
		prepared.map((item) => ({ item, tags: item.tags, rating: item.rating })),
		applied.query,
		applied.rating.map((rating) => rating.toLowerCase())
	);
	const packed: ExportPacked = { files: [], omitted: [] };
	const used = new Set<string>();
	for (const entry of matched.posts) {
		if (!allowsExportMedia(applied.media, entry.item.fileUrl)) continue;
		packRow(packed, used, services.dataDir, entry.item.row, entry.item.row.itemId);
	}
	return packed;
}

function gelbooruCount(json: unknown) {
	if (!json || typeof json !== 'object') return null;
	const attributes = (json as { '@attributes'?: { count?: unknown } })['@attributes'];
	const count = Number(attributes?.count);
	if (!Number.isFinite(count) || count < 0) return null;
	return count;
}

function gelbooruExportPosts(json: unknown) {
	const root = json as { post?: unknown };
	const value = root.post;
	const records = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
	const posts: { id: string; fileUrl: string }[] = [];
	for (const post of records) {
		if (!post || typeof post !== 'object') continue;
		const record = post as { id?: unknown; file_url?: unknown };
		const id = String(record.id ?? '');
		const fileUrl = String(record.file_url ?? '');
		if (!id) continue;
		posts.push({ id, fileUrl });
	}
	return posts;
}

async function gelbooruMatches(
	services: AppServices,
	applied: AppliedSearch,
	excluded: ReadonlySet<string>,
	seed: number
) {
	if (gelbooruCredentialState(services.db, services.secretPath) === 'unavailable') {
		return {
			ok: false as const,
			response: jsonError('SECRET_UNAVAILABLE', 'Master key is unavailable', 503)
		};
	}
	const base = services.fixtureOrigin ?? 'https://gelbooru.com';
	const tags = exportUpstreamTags(applied, seed);
	const posts: { id: string; fileUrl: string }[] = [];
	const seen = new Set<string>();
	let finished = false;
	for (let page = 0; page < 200; page += 1) {
		let result: Awaited<ReturnType<typeof gelbooruJson>>;
		try {
			result = await gelbooruJson(
				base,
				{
					s: 'post',
					q: 'index',
					tags,
					limit: String(exportPageLimit),
					pid: String(page),
					...readGelbooruAuth(services.db, services.secretPath)
				},
				services.fetchUpstream,
				services.log
			);
		} catch {
			return {
				ok: false as const,
				response: jsonError('UPSTREAM_INVALID', 'Gelbooru returned an unreadable response', 502)
			};
		}
		if (!result.ok) {
			return {
				ok: false as const,
				response:
					result.reason === 'auth'
						? jsonError('SOURCE_AUTH_REQUIRED', 'Gelbooru rejected the request', 502)
						: jsonError('UPSTREAM_INVALID', 'Gelbooru returned an unreadable response', 502)
			};
		}
		const total = gelbooruCount(result.json);
		if (page === 0 && total != null && excluded.size === 0 && total > ZIP_EXPORT_MAX_FILES) {
			throw new ZipExportTooLargeError(
				'files',
				`Selection has ${total} files, over the limit of ${ZIP_EXPORT_MAX_FILES}`
			);
		}
		const batch = gelbooruExportPosts(result.json);
		if (batch.length < exportPageLimit) finished = true;
		if (total != null && (page + 1) * exportPageLimit >= total) finished = true;
		for (const post of batch) {
			if (seen.has(post.id)) continue;
			seen.add(post.id);
			if (excluded.has(post.id)) continue;
			posts.push(post);
			if (posts.length > ZIP_EXPORT_MAX_FILES) {
				throw new ZipExportTooLargeError(
					'files',
					`Selection has ${posts.length} files, over the limit of ${ZIP_EXPORT_MAX_FILES}`
				);
			}
		}
		if (finished || batch.length === 0) break;
	}
	if (!finished) {
		throw new ZipExportTooLargeError(
			'files',
			`Selection is over the limit of ${ZIP_EXPORT_MAX_FILES} files`
		);
	}
	return { ok: true as const, posts };
}

async function collectPacked(services: AppServices, command: ExportCommand) {
	if (command.kind === 'ids') return packIds(services, command.ids);
	if (command.source === 'gelbooru') {
		const remote = await gelbooruMatches(
			services,
			command.applied,
			new Set(command.excluded),
			command.seed
		);
		if (!remote.ok) return remote.response;
		const rows = rowsByRemoteId(
			services.db,
			remote.posts.map((post) => post.id),
			'gelbooru'
		);
		const byRemote = new Map<string, OriginalCandidate[]>();
		for (const row of rows) {
			const list = byRemote.get(row.remoteId) ?? [];
			list.push(row);
			byRemote.set(row.remoteId, list);
		}
		const packed: ExportPacked = { files: [], omitted: [] };
		const used = new Set<string>();
		for (const post of remote.posts) {
			packGroup(
				packed,
				used,
				services.dataDir,
				byRemote.get(post.id) ?? [],
				post.fileUrl || post.id
			);
		}
		return packed;
	}
	if (command.source === 'album') {
		if (!command.sourceAlbumId || !getAlbum(services.db, command.sourceAlbumId)) {
			return jsonError('NOT_FOUND', 'Album was not found', 404);
		}
		return packScope(
			services,
			albumRows(services.db, command.sourceAlbumId),
			command.applied,
			command.excluded
		);
	}
	return packScope(services, favoriteRows(services.db), command.applied, command.excluded);
}

function zipFileResponse(destination: string, included: number, omitted: number) {
	const stream = createReadStream(destination);
	stream.once('close', () => {
		try {
			unlinkSync(destination);
		} catch {
			// The archive was already removed.
		}
	});
	const headers = new Headers();
	headers.set('content-type', 'application/zip');
	headers.set('content-length', String(statSync(destination).size));
	headers.set('content-disposition', 'attachment; filename="panbooru.zip"');
	headers.set('cache-control', 'private, no-store');
	headers.set('x-panbooru-export-included', String(included));
	headers.set('x-panbooru-export-omitted', String(omitted));
	return new Response(Readable.toWeb(stream) as ReadableStream, { status: 200, headers });
}

function originalDownloadName(services: AppServices, itemId: string) {
	const row = services.db.$client
		.prepare(
			`select post_snapshots.snapshot as snapshot
			 from saved_items
			 join post_snapshots on post_snapshots.id = saved_items.snapshot_id
			 where saved_items.id = ?`
		)
		.get(itemId) as { snapshot: string } | undefined;
	const fileUrl = row ? parsedSnapshot(row.snapshot)?.fileUrl : '';
	return fileUrl ? exportFileName(fileUrl) : 'original';
}

async function exportOriginals(services: AppServices, body: unknown) {
	const parsed = parseExport(body);
	if (parsed instanceof Response) return parsed;
	try {
		const packed = await collectPacked(services, parsed);
		if (packed instanceof Response) return packed;
		const destination = join(services.dataDir, 'exports', `${randomUUID()}.zip`);
		const result = await writeExportZip({
			files: packed.files,
			omitted: packed.omitted,
			destination
		});
		return zipFileResponse(destination, result.includedCount, result.omittedCount);
	} catch (error) {
		if (error instanceof ZipExportTooLargeError) {
			return jsonError(error.code, error.message, error.status);
		}
		services.log(error instanceof Error ? error.message : 'export failed');
		return jsonError('EXPORT_FAILED', 'The download could not be prepared', 500);
	}
}
