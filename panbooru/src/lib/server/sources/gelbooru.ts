import { randomUUID } from 'node:crypto';
import { redactSecrets } from '#lib/server/http/redact.ts';

const categories: Record<string, string> = {
	'0': 'general',
	'1': 'artist',
	'3': 'copyright',
	'4': 'character',
	'5': 'metadata'
};

export type UpstreamResult =
	{ ok: true; json: unknown } | { ok: false; reason: 'auth' | 'invalid' };

export async function gelbooruJson(
	base: string,
	params: Record<string, string>,
	fetchUpstream: (input: URL) => Promise<Response>,
	log: (line: string) => void
): Promise<UpstreamResult> {
	const url = new URL('/index.php', base.endsWith('/') ? base : `${base}/`);
	url.searchParams.set('page', 'dapi');
	url.searchParams.set('json', '1');
	for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
	log(redactSecrets(url.toString()));
	const response = await fetchUpstream(url);
	if (response.status === 401) return { ok: false, reason: 'auth' };
	const type = response.headers.get('content-type') ?? '';
	const text = await response.text();
	if (type.includes('html') || text.trim().startsWith('<')) return { ok: false, reason: 'invalid' };
	try {
		return { ok: true, json: JSON.parse(text) as unknown };
	} catch {
		return { ok: false, reason: 'invalid' };
	}
}

function records(value: unknown) {
	if (Array.isArray(value)) return value as Record<string, unknown>[];
	if (value && typeof value === 'object') return [value as Record<string, unknown>];
	return [];
}

export function normalizePosts(json: unknown, media: Map<string, string>) {
	const root = json as { post?: unknown };
	return records(root.post).map((post) => {
		const fileUrl = String(post.file_url ?? '');
		const mediaRef = randomUUID();
		if (fileUrl) media.set(mediaRef, fileUrl);
		const tags = String(post.tags ?? '')
			.split(/\s+/)
			.filter(Boolean);
		return {
			id: String(post.id ?? ''),
			tags,
			width: Number(post.width ?? 0),
			height: Number(post.height ?? 0),
			rating: String(post.rating ?? ''),
			mediaRef
		};
	});
}

export function normalizeTags(json: unknown) {
	const root = json as { tag?: unknown };
	return records(root.tag).map((tag) => {
		const type = String(tag.type ?? '');
		return {
			name: String(tag.name ?? ''),
			category: categories[type] ?? 'unknown',
			count: Number(tag.count ?? 0)
		};
	});
}

export async function probeGelbooruCredentials(
	base: string,
	userId: string,
	apiKey: string,
	log: (line: string) => void
) {
	const url = new URL('/index.php', base.endsWith('/') ? base : `${base}/`);
	url.searchParams.set('page', 'dapi');
	url.searchParams.set('s', 'post');
	url.searchParams.set('q', 'index');
	url.searchParams.set('json', '1');
	url.searchParams.set('limit', '1');
	url.searchParams.set('user_id', userId);
	url.searchParams.set('api_key', apiKey);
	log(redactSecrets(url.toString()));
	const response = await fetch(url, { redirect: 'manual' });
	if (response.status !== 200) return false;
	const text = await response.text();
	try {
		JSON.parse(text);
		return true;
	} catch {
		return false;
	}
}
