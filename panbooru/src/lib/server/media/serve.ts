import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppServices } from '#lib/server/auth/dispatch.ts';
import { jsonError } from '#lib/server/http/json.ts';
import { canonicalFileUrl } from '#lib/server/library/save.ts';
import {
	isVideoFile,
	maxSourceBytes,
	recipeFromQuery,
	renderDerivative,
	type RecipeName
} from '#lib/server/media/derivative.ts';
import { checkDestination, checkRedirect } from '#lib/server/media/policy.ts';
import {
	bytesMediaResponse,
	fileMediaResponse,
	passThroughMedia,
	singleRangeHeader
} from '#lib/server/media/range.ts';
import type { MediaTarget } from '#lib/server/sources/gelbooru.ts';

const imageLimit = maxSourceBytes;

export async function serveMedia(request: Request, url: URL, services: AppServices) {
	const ref = decodeURIComponent(url.pathname.slice('/api/media/'.length));
	const target = services.media.get(ref);
	if (!target) return jsonError('NOT_FOUND', 'Media was not found', 404);
	const download = url.searchParams.get('download') === '1';
	const recipe = download ? null : recipeFromQuery(url.searchParams.get('recipe'));
	if (recipe) {
		const derivative = await serveDerivative(request, services, target, recipe);
		if (derivative) return derivative;
	}
	return serveOriginal(request, services, target, download);
}

async function serveDerivative(
	request: Request,
	services: AppServices,
	target: MediaTarget,
	recipe: RecipeName
) {
	const identity = canonicalFileUrl(target.fileUrl);
	const cached = cachedDerivative(services, identity, recipe);
	if (cached) {
		const streamed = fileMediaResponse(
			join(services.dataDir, cached.relativePath),
			request.method,
			request.headers.get('range'),
			'image/webp',
			{ label: cached.label }
		);
		if (streamed) return streamed;
	}
	try {
		const sourceUrl =
			isVideoFile(target.fileUrl) && target.previewUrl ? target.previewUrl : target.fileUrl;
		const bytes = await readImage(services, sourceUrl);
		const rendered = await renderDerivative(bytes, recipe);
		const relativePath = await writeDerivative(services.dataDir, rendered.bytes);
		services.db.$client
			.prepare(
				`insert into derivatives (
					id, source_identity, recipe, width, height, format, relative_path, byte_size, label
				) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
				on conflict (source_identity, recipe) do update set
					width = excluded.width,
					height = excluded.height,
					format = excluded.format,
					relative_path = excluded.relative_path,
					byte_size = excluded.byte_size,
					label = excluded.label`
			)
			.run(
				randomUUID(),
				identity,
				recipe,
				rendered.width,
				rendered.height,
				rendered.format,
				relativePath,
				rendered.bytes.length,
				rendered.label
			);
		return bytesMediaResponse({
			method: request.method,
			bytes: rendered.bytes,
			type: 'image/webp',
			rangeHeader: request.headers.get('range'),
			label: rendered.label
		});
	} catch (error) {
		services.log(error instanceof Error ? error.message : 'derivative generation failed');
		return null;
	}
}

function cachedDerivative(services: AppServices, identity: string, recipe: string) {
	return services.db.$client
		.prepare(
			`select relative_path as relativePath, label
			 from derivatives
			 where source_identity = ? and recipe = ?`
		)
		.get(identity, recipe) as { relativePath: string; label: string | null } | undefined;
}

async function writeDerivative(dataDir: string, bytes: Buffer) {
	const hash = createHash('sha256').update(bytes).digest('hex');
	const relativePath = join('media', 'derivatives', `${hash}.webp`);
	const finalPath = join(dataDir, relativePath);
	await mkdir(join(dataDir, 'media', 'derivatives'), { recursive: true });
	try {
		await stat(finalPath);
		return relativePath;
	} catch {
		/* write the new derivative */
	}
	const tempPath = join(dataDir, 'tmp', `derivative-${randomUUID()}`);
	await mkdir(join(dataDir, 'tmp'), { recursive: true });
	await writeFile(tempPath, bytes);
	await rename(tempPath, finalPath);
	return relativePath;
}

async function readImage(services: AppServices, rawUrl: string) {
	const upstream = await fetchApproved(services, rawUrl, null, 'GET');
	if (!upstream) throw new Error('derivative source was not fetched');
	const type = upstream.headers.get('content-type') ?? '';
	if (upstream.status !== 200 || !type.startsWith('image/')) {
		await upstream.body?.cancel();
		throw new Error('derivative source is not an image');
	}
	const reader = upstream.body?.getReader();
	if (!reader) throw new Error('derivative source was empty');
	const chunks: Buffer[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > imageLimit) {
				await reader.cancel();
				throw new Error('derivative source is too large');
			}
			chunks.push(Buffer.from(value));
		}
	} catch (error) {
		await reader.cancel().catch(() => undefined);
		throw error;
	}
	return Buffer.concat(chunks);
}

async function serveOriginal(
	request: Request,
	services: AppServices,
	target: MediaTarget,
	download: boolean
) {
	const filename = download ? downloadName(target.fileUrl) : undefined;
	const local = readyOriginal(services, target.fileUrl);
	if (local) {
		const streamed = fileMediaResponse(
			join(services.dataDir, local.relativePath),
			request.method,
			request.headers.get('range'),
			local.mime || 'application/octet-stream',
			{ filename }
		);
		if (streamed) return streamed;
	}
	const range = request.method === 'GET' ? singleRangeHeader(request.headers.get('range')) : null;
	const upstream = await fetchApproved(services, target.fileUrl, range, request.method);
	if (!upstream) return jsonError('MEDIA_BLOCKED', 'Media host is not approved', 502);
	if (!checkRedirect(upstream.status).ok) {
		await upstream.body?.cancel();
		return jsonError('UPSTREAM_INVALID', 'Media could not be fetched', 502);
	}
	const media = passThroughMedia(request.method, upstream);
	if (!media) {
		await upstream.body?.cancel();
		return jsonError('UPSTREAM_INVALID', 'Media could not be fetched', 502);
	}
	if (filename) media.headers.set('content-disposition', `attachment; filename="${filename}"`);
	return media;
}

function readyOriginal(services: AppServices, fileUrl: string) {
	const row = services.db.$client
		.prepare(
			`select media_objects.relative_path as relativePath, media_objects.mime as mime
			 from jobs
			 join saved_items on saved_items.id = jobs.item_id
			 join media_objects on media_objects.id = saved_items.media_id
			 where jobs.file_url = ? and jobs.kind = 'original' and jobs.state = 'succeeded'
			 	and media_objects.state = 'ready' and media_objects.relative_path is not null
			 limit 1`
		)
		.get(canonicalFileUrl(fileUrl)) as { relativePath: string; mime: string | null } | undefined;
	if (!row?.relativePath || row.relativePath.includes('..')) return null;
	return row;
}

async function fetchApproved(
	services: AppServices,
	rawUrl: string,
	range: string | null,
	method: string
) {
	let target: URL;
	try {
		target = new URL(rawUrl);
	} catch {
		return null;
	}
	const answers = await services.lookup(target.hostname);
	const decision = checkDestination(rawUrl, {
		allowHosts: services.allowHosts,
		lookup: () => answers
	});
	if (!decision.ok) return null;
	const headers = new Headers();
	headers.set('referer', 'https://gelbooru.com/');
	if (range) headers.set('range', range);
	return services.fetchUpstream(target, {
		method: method === 'HEAD' ? 'HEAD' : 'GET',
		headers,
		redirect: 'manual'
	});
}

function downloadName(fileUrl: string) {
	try {
		const name = new URL(fileUrl).pathname.split('/').pop() ?? '';
		return /^[A-Za-z0-9._-]+$/.test(name) ? name : 'original';
	} catch {
		return 'original';
	}
}
