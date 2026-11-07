import { checkDestination, checkRedirect } from '#lib/server/media/policy.ts';
import { passThroughMedia, singleRangeHeader } from '#lib/server/media/range.ts';
import type { AppServices } from '#lib/server/auth/dispatch.ts';
import { jsonData, jsonError } from '#lib/server/http/json.ts';
import { compileRatingTags } from '#lib/server/library/rating-tags.ts';
import { gelbooruJson, normalizePosts, normalizeTags } from '#lib/server/sources/gelbooru.ts';

function upstreamError(result: { reason: 'auth' | 'invalid' }) {
	if (result.reason === 'auth')
		return jsonError('SOURCE_AUTH_REQUIRED', 'Gelbooru rejected the request', 502);
	return jsonError('UPSTREAM_INVALID', 'Gelbooru returned an unreadable response', 502);
}

export async function handleSource(
	request: Request,
	url: URL,
	services: AppServices,
	hasSession: boolean
) {
	const base = services.fixtureOrigin ?? 'https://gelbooru.com';
	const session = () => hasSession;

	if (request.method === 'POST' && url.pathname === '/api/source/gelbooru/search') {
		if (!session()) return jsonError('UNAUTHORIZED', 'Session required', 401);
		const body = (await request.json().catch(() => null)) as {
			query?: unknown;
			ratings?: unknown;
		} | null;
		const query = typeof body?.query === 'string' ? body.query : '';
		const ratings = Array.isArray(body?.ratings)
			? body.ratings.filter((rating): rating is string => typeof rating === 'string')
			: [];
		const ratingText = compileRatingTags(ratings);
		const tags = ratingText ? `${query} ${ratingText}`.trim() : query;
		const result = await gelbooruJson(
			base,
			{ s: 'post', q: 'index', tags, limit: '20' },
			services.fetchUpstream,
			services.log
		);
		if (!result.ok) return upstreamError(result);
		return jsonData({ posts: normalizePosts(result.json, services.media) });
	}

	if (request.method === 'GET' && url.pathname.startsWith('/api/source/gelbooru/posts/')) {
		if (!session()) return jsonError('UNAUTHORIZED', 'Session required', 401);
		const id = url.pathname.split('/').at(-1) ?? '';
		if (!/^\d+$/.test(id)) return jsonError('BAD_REQUEST', 'Post id is invalid', 400);
		const result = await gelbooruJson(
			base,
			{ s: 'post', q: 'index', id },
			services.fetchUpstream,
			services.log
		);
		if (!result.ok) return upstreamError(result);
		const post = normalizePosts(result.json, services.media)[0];
		if (!post) return jsonError('NOT_FOUND', 'Post was not found', 404);
		return jsonData({ post });
	}

	if (request.method === 'POST' && url.pathname === '/api/source/gelbooru/tags') {
		if (!session()) return jsonError('UNAUTHORIZED', 'Session required', 401);
		const body = (await request.json().catch(() => null)) as { names?: unknown } | null;
		const names = Array.isArray(body?.names)
			? body.names.filter((name) => typeof name === 'string')
			: [];
		const result = await gelbooruJson(
			base,
			{ s: 'tag', names: names.join(' ') },
			services.fetchUpstream,
			services.log
		);
		if (!result.ok) return upstreamError(result);
		return jsonData({ tags: normalizeTags(result.json) });
	}

	if (request.method === 'POST' && url.pathname === '/api/source/gelbooru/autocomplete') {
		if (!session()) return jsonError('UNAUTHORIZED', 'Session required', 401);
		const body = (await request.json().catch(() => null)) as { pattern?: unknown } | null;
		const pattern = typeof body?.pattern === 'string' ? body.pattern : '';
		const result = await gelbooruJson(
			base,
			{ s: 'tag', name_pattern: pattern, limit: '10' },
			services.fetchUpstream,
			services.log
		);
		if (!result.ok) return upstreamError(result);
		return jsonData({ suggestions: normalizeTags(result.json) });
	}

	if (
		(request.method === 'GET' || request.method === 'HEAD') &&
		url.pathname.startsWith('/api/media/')
	) {
		if (!session()) return jsonError('UNAUTHORIZED', 'Session required', 401);
		const ref = decodeURIComponent(url.pathname.slice('/api/media/'.length));
		const target = services.media.get(ref);
		if (!target) return jsonError('NOT_FOUND', 'Media was not found', 404);
		const answers = await services.lookup(new URL(target).hostname);
		const decision = checkDestination(target, {
			allowHosts: services.allowHosts,
			lookup: () => answers
		});
		if (!decision.ok) return jsonError('MEDIA_BLOCKED', 'Media host is not approved', 502);
		const headers = new Headers();
		const range = request.method === 'GET' ? singleRangeHeader(request.headers.get('range')) : null;
		if (range) headers.set('range', range);
		const upstream = await services.fetchUpstream(new URL(target), {
			method: request.method,
			headers,
			redirect: 'manual'
		});
		if (!checkRedirect(upstream.status).ok) {
			await upstream.body?.cancel();
			return jsonError('UPSTREAM_INVALID', 'Media could not be fetched', 502);
		}
		const media = passThroughMedia(request.method, upstream);
		if (!media) {
			await upstream.body?.cancel();
			return jsonError('UPSTREAM_INVALID', 'Media could not be fetched', 502);
		}
		return media;
	}

	return null;
}
