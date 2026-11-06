import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { hashPassword, verifyPassword } from '#lib/server/auth/password.ts';
import { RateLimiter } from '#lib/server/auth/rate-limit.ts';
import { SESSION_ABSOLUTE_MS, SESSION_COOKIE, SESSION_IDLE_MS } from '#lib/server/auth/session.ts';
import { owner, sessions, sourceCredentials } from '#lib/server/db/schema.ts';
import type { AppDatabase } from '#lib/server/db/index.ts';
import { jsonData, jsonError } from '#lib/server/http/json.ts';
import { decryptCredential, encryptCredential } from '#lib/server/secrets/cipher.ts';
import { probeGelbooruCredentials } from '#lib/server/sources/gelbooru.ts';
import { handleLibrary } from '#lib/server/library/routes.ts';
import { handleSource } from '#lib/server/sources/routes.ts';

export type AppServices = {
	db: AppDatabase;
	dataDir: string;
	secretPath?: string;
	fixtureOrigin?: string;
	now: () => number;
	log: (line: string) => void;
	limiter: RateLimiter;
	secureCookie: boolean;
	allowHosts: readonly string[];
	lookup: (hostname: string) => readonly string[] | Promise<readonly string[]>;
	fetchUpstream: (input: URL) => Promise<Response>;
	media: Map<string, string>;
};

const minimumPassword = 12;

export async function saveGelbooruCredentials(
	services: AppServices,
	userId: string,
	apiKey: string
) {
	const existing = services.db
		.select()
		.from(sourceCredentials)
		.where(eq(sourceCredentials.source, 'gelbooru'))
		.get();
	if (!services.secretPath) return 'unavailable' as const;
	if (existing) {
		try {
			decryptCredential(
				{
					ciphertext: existing.ciphertext,
					nonce: existing.nonce,
					tag: existing.authTag,
					keyVersion: existing.keyVersion
				},
				{ keyPath: services.secretPath, associatedData: 'gelbooru:1' }
			);
		} catch {
			return 'unavailable' as const;
		}
	}
	const base = services.fixtureOrigin ?? 'https://gelbooru.com';
	let accepted = false;
	try {
		accepted = await probeGelbooruCredentials(base, userId, apiKey, services.log);
	} catch (error) {
		services.log(error instanceof Error ? error.message : 'upstream request failed');
		return 'rejected' as const;
	}
	if (!accepted) return 'rejected' as const;
	let record;
	try {
		record = encryptCredential(new TextEncoder().encode(apiKey), {
			keyPath: services.secretPath,
			associatedData: 'gelbooru:1'
		});
	} catch {
		return 'unavailable' as const;
	}
	services.db
		.insert(sourceCredentials)
		.values({
			source: 'gelbooru',
			ciphertext: Buffer.from(record.ciphertext),
			nonce: Buffer.from(record.nonce),
			authTag: Buffer.from(record.tag),
			keyVersion: record.keyVersion,
			userId,
			validated: 1
		})
		.onConflictDoUpdate({
			target: sourceCredentials.source,
			set: {
				ciphertext: Buffer.from(record.ciphertext),
				nonce: Buffer.from(record.nonce),
				authTag: Buffer.from(record.tag),
				keyVersion: record.keyVersion,
				userId,
				validated: 1
			}
		})
		.run();
	return 'saved' as const;
}

export async function applyEnvCredentials(services: AppServices) {
	const userId = process.env.PANBOORU_GELBOORU_USER_ID?.trim() ?? '';
	const apiKey = process.env.PANBOORU_GELBOORU_API_KEY?.trim() ?? '';
	if (!userId || !apiKey) return;
	const saved = await saveGelbooruCredentials(services, userId, apiKey);
	services.log(
		saved === 'saved' ? 'gelbooru credentials validated' : 'gelbooru credentials were not validated'
	);
}

export function ensureBootstrap(services: AppServices) {
	const existing = services.db.select().from(owner).get();
	if (existing) return;
	const token = randomBytes(32).toString('hex');
	const path = join(services.dataDir, 'bootstrap.token');
	writeFileSync(path, token, { mode: 0o600 });
	services.log(`bootstrap token written to ${path}`);
}

function cookie(token: string, secure: boolean) {
	const parts = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
	if (secure) parts.push('Secure');
	return parts.join('; ');
}

function readCookie(header: string | null) {
	if (!header) return null;
	for (const part of header.split(';')) {
		const [name, ...rest] = part.trim().split('=');
		if (name === SESSION_COOKIE) return rest.join('=');
	}
	return null;
}

function tokenHash(token: string) {
	return createHash('sha256').update(token).digest('hex');
}

function issueSession(services: AppServices) {
	const token = randomBytes(32).toString('base64url');
	const now = services.now();
	services.db
		.insert(sessions)
		.values({
			tokenHash: tokenHash(token),
			absoluteExpiresAt: now + SESSION_ABSOLUTE_MS,
			idleExpiresAt: now + SESSION_IDLE_MS,
			revoked: 0
		})
		.run();
	return token;
}

export function readSession(request: Request, services: AppServices) {
	const token = readCookie(request.headers.get('cookie'));
	if (!token) return null;
	const row = services.db
		.select()
		.from(sessions)
		.where(eq(sessions.tokenHash, tokenHash(token)))
		.get();
	if (!row || row.revoked) return null;
	const now = services.now();
	if (now > row.absoluteExpiresAt || now > row.idleExpiresAt) return null;
	services.db
		.update(sessions)
		.set({ idleExpiresAt: now + SESSION_IDLE_MS })
		.where(eq(sessions.tokenHash, row.tokenHash))
		.run();
	return row;
}

function sameOrigin(request: Request) {
	const origin = request.headers.get('origin');
	if (!origin) return false;
	return origin === new URL(request.url).origin;
}

function limited(services: AppServices, key: string) {
	if (services.limiter.allow(key)) return null;
	return jsonError('RATE_LIMITED', 'Too many attempts', 429, true);
}

async function readBody(request: Request) {
	const text = await request.text();
	if (text.length > 4096) return undefined;
	try {
		return JSON.parse(text) as {
			token?: unknown;
			password?: unknown;
			userId?: unknown;
			apiKey?: unknown;
		};
	} catch {
		return undefined;
	}
}

function tokensMatch(left: string, right: string) {
	const a = Buffer.from(left);
	const b = Buffer.from(right);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

export async function dispatch(request: Request, services: AppServices): Promise<Response | null> {
	const url = new URL(request.url);
	if (request.method === 'GET' && url.pathname === '/health') return null;

	if ((request.method === 'POST' || request.method === 'DELETE') && !sameOrigin(request)) {
		return jsonError('FORBIDDEN', 'Cross-origin request rejected', 403);
	}

	if (request.method === 'POST' && url.pathname === '/api/setup/owner') {
		const blocked = limited(services, 'setup');
		if (blocked) return blocked;
		const existing = services.db.select().from(owner).get();
		if (existing) return jsonError('FORBIDDEN', 'Owner already exists', 403);
		const body = await readBody(request);
		const token = typeof body?.token === 'string' ? body.token : '';
		const password = typeof body?.password === 'string' ? body.password : '';
		let stored = '';
		try {
			stored = readFileSync(join(services.dataDir, 'bootstrap.token'), 'utf8').trim();
		} catch {
			return jsonError('FORBIDDEN', 'Setup is closed', 403);
		}
		if (!tokensMatch(stored, token) || password.length < minimumPassword) {
			return jsonError('FORBIDDEN', 'Setup is closed', 403);
		}
		const now = services.now();
		services.db
			.insert(owner)
			.values({
				singleton: 1,
				passwordHash: await hashPassword(password),
				authVersion: 1,
				createdAt: now,
				updatedAt: now
			})
			.run();
		rmSync(join(services.dataDir, 'bootstrap.token'));
		const response = jsonData({ authenticated: true });
		response.headers.set('set-cookie', cookie(issueSession(services), services.secureCookie));
		return response;
	}

	if (request.method === 'POST' && url.pathname === '/api/auth/login') {
		const blocked = limited(services, 'login');
		if (blocked) return blocked;
		const body = await readBody(request);
		const password = typeof body?.password === 'string' ? body.password : '';
		const existing = services.db.select().from(owner).get();
		if (!existing || !(await verifyPassword(existing.passwordHash, password))) {
			return jsonError('UNAUTHORIZED', 'Login failed', 401);
		}
		const response = jsonData({ authenticated: true });
		response.headers.set('set-cookie', cookie(issueSession(services), services.secureCookie));
		return response;
	}

	if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
		const session = readSession(request, services);
		if (!session) return jsonError('UNAUTHORIZED', 'Session required', 401);
		services.db
			.update(sessions)
			.set({ revoked: 1 })
			.where(eq(sessions.tokenHash, session.tokenHash))
			.run();
		return jsonData({ authenticated: false });
	}

	if (request.method === 'GET' && url.pathname === '/api/auth/session') {
		if (!readSession(request, services)) return jsonError('UNAUTHORIZED', 'Session required', 401);
		return jsonData({ authenticated: true });
	}

	if (request.method === 'GET' && url.pathname === '/api/settings/gelbooru') {
		if (!readSession(request, services)) return jsonError('UNAUTHORIZED', 'Session required', 401);
		const row = services.db
			.select()
			.from(sourceCredentials)
			.where(eq(sourceCredentials.source, 'gelbooru'))
			.get();
		if (!row) return jsonData({ configured: false, validated: false });
		return jsonData({ configured: true, validated: row.validated === 1, userId: row.userId });
	}

	if (request.method === 'POST' && url.pathname === '/api/settings/gelbooru/validate') {
		const blocked = limited(services, 'validate');
		if (blocked) return blocked;
		if (!readSession(request, services)) return jsonError('UNAUTHORIZED', 'Session required', 401);
		const body = await readBody(request);
		const userId = typeof body?.userId === 'string' ? body.userId : '';
		const apiKey = typeof body?.apiKey === 'string' ? body.apiKey : '';
		if (!userId || !apiKey || userId.length > 64 || apiKey.length > 256) {
			return jsonError('BAD_REQUEST', 'Credentials are invalid', 400);
		}
		const saved = await saveGelbooruCredentials(services, userId, apiKey);
		if (saved === 'unavailable')
			return jsonError('SECRET_UNAVAILABLE', 'Master key is unavailable', 500);
		if (saved === 'rejected')
			return jsonError('SOURCE_AUTH_REQUIRED', 'Gelbooru rejected the credentials', 502);
		return jsonData({ configured: true, validated: true, userId });
	}

	const session = Boolean(readSession(request, services));
	const source = await handleSource(request, url, services, session);
	if (source) return source;
	const library = await handleLibrary(request, url, services, session);
	if (library) return library;

	if (url.pathname.startsWith('/api/')) {
		return jsonError('NOT_FOUND', 'Not found', 404);
	}
	return null;
}
