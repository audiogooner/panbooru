import { randomUUID } from 'node:crypto';
import { mediaTypeForPath } from '#lib/playable.ts';
import { isVideoFile } from '#lib/server/media/derivative.ts';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '#lib/server/db/index.ts';
import { sourceCredentials } from '#lib/server/db/schema.ts';
import { redactSecrets } from '#lib/server/http/redact.ts';
import { decryptCredential } from '#lib/server/secrets/cipher.ts';

const categories: Record<string, string> = {
	'0': 'general',
	'1': 'artist',
	'3': 'copyright',
	'4': 'character',
	'5': 'metadata'
};

export type UpstreamResult =
	{ ok: true; json: unknown } | { ok: false; reason: 'auth' | 'invalid' };

function credentialRow(db: AppDatabase) {
	return db.select().from(sourceCredentials).where(eq(sourceCredentials.source, 'gelbooru')).get();
}

export function gelbooruCredentialState(
	db: AppDatabase,
	secretPath?: string
): 'absent' | 'ready' | 'unavailable' {
	const row = credentialRow(db);
	if (!row) return 'absent';
	if (!secretPath) return 'unavailable';
	try {
		const apiKey = new TextDecoder().decode(
			decryptCredential(
				{
					ciphertext: row.ciphertext,
					nonce: row.nonce,
					tag: row.authTag,
					keyVersion: row.keyVersion
				},
				{ keyPath: secretPath, associatedData: 'gelbooru:1' }
			)
		);
		if (!apiKey || !row.userId) return 'unavailable';
		return 'ready';
	} catch {
		return 'unavailable';
	}
}

export function readGelbooruAuth(db: AppDatabase, secretPath?: string) {
	if (gelbooruCredentialState(db, secretPath) !== 'ready') return {};
	const row = credentialRow(db);
	if (!row || !secretPath) return {};
	const apiKey = new TextDecoder().decode(
		decryptCredential(
			{
				ciphertext: row.ciphertext,
				nonce: row.nonce,
				tag: row.authTag,
				keyVersion: row.keyVersion
			},
			{ keyPath: secretPath, associatedData: 'gelbooru:1' }
		)
	);
	return { user_id: row.userId, api_key: apiKey };
}

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

function mediaType(fileUrl: string) {
	try {
		return mediaTypeForPath(new URL(fileUrl).pathname);
	} catch {
		return '';
	}
}

function records(value: unknown) {
	if (Array.isArray(value)) return value as Record<string, unknown>[];
	if (value && typeof value === 'object') return [value as Record<string, unknown>];
	return [];
}

export type MediaTarget = {
	fileUrl: string;
	previewUrl: string;
};

export function normalizePosts(json: unknown, media: Map<string, MediaTarget>) {
	const root = json as { post?: unknown };
	return records(root.post).map((post) => {
		const fileUrl = String(post.file_url ?? '');
		const previewUrl = String(post.preview_url ?? fileUrl);
		const mediaRef = randomUUID();
		if (fileUrl) media.set(mediaRef, { fileUrl, previewUrl });
		const tags = String(post.tags ?? '')
			.split(/\s+/)
			.filter(Boolean);
		return {
			id: String(post.id ?? ''),
			tags,
			width: Number(post.width ?? 0),
			height: Number(post.height ?? 0),
			rating: String(post.rating ?? ''),
			mediaRef,
			kind: isVideoFile(fileUrl) ? 'video' : 'image',
			mediaType: mediaType(fileUrl)
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
