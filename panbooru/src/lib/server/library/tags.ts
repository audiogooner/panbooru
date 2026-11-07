import type { AppServices } from '#lib/server/auth/dispatch.ts';
import type { AppDatabase } from '#lib/server/db/index.ts';
import {
	gelbooruCredentialState,
	gelbooruJson,
	normalizeTags,
	readGelbooruAuth
} from '#lib/server/sources/gelbooru.ts';

/** Spec leaves TTL open; a day is enough for category stability without unbounded freshness. */
export const TAG_META_TTL_MS = 24 * 60 * 60 * 1000;

export type TagCategory = {
	name: string;
	category: string;
	count?: number;
};

export type NormalizedTag = {
	name: string;
	category: string;
	count: number;
};

type CachedTag = NormalizedTag & { fetchedAt: number };

export function refreshTagCategories(
	db: AppDatabase,
	source: string,
	tags: readonly TagCategory[],
	now: number
) {
	const upsert = db.$client.prepare(
		`insert into source_tags (source, name, category, count, fetched_at)
		 values (?, ?, ?, ?, ?)
		 on conflict (source, name) do update set
		 	category = excluded.category,
		 	count = excluded.count,
		 	fetched_at = excluded.fetched_at`
	);
	db.$client.transaction(() => {
		for (const tag of tags) {
			if (!tag.name) continue;
			upsert.run(source, tag.name, tag.category, tag.count ?? 0, now);
		}
	})();
}

export function readCachedTags(
	db: AppDatabase,
	source: string,
	names: readonly string[]
): CachedTag[] {
	if (!names.length) return [];
	const placeholders = names.map(() => '?').join(', ');
	const rows = db.$client
		.prepare(
			`select name, category, count, fetched_at as fetchedAt
			 from source_tags
			 where source = ? and name in (${placeholders})`
		)
		.all(source, ...names) as {
		name: string;
		category: string;
		count: number;
		fetchedAt: number;
	}[];
	return rows.map((row) => ({
		name: row.name,
		category: row.category,
		count: row.count,
		fetchedAt: row.fetchedAt
	}));
}

function present(tag: CachedTag | NormalizedTag): NormalizedTag {
	return { name: tag.name, category: tag.category, count: tag.count };
}

export async function lookupSourceTags(
	services: AppServices,
	source: string,
	names: readonly string[]
): Promise<
	| { ok: true; tags: NormalizedTag[] }
	| { ok: false; reason: 'auth' | 'invalid' }
> {
	const unique = [...new Set(names.filter((name) => name.length > 0))];
	if (!unique.length) return { ok: true, tags: [] };

	const now = services.now();
	const cached = readCachedTags(services.db, source, unique);
	const byName = new Map(cached.map((tag) => [tag.name, tag]));
	const refresh = unique.filter((name) => {
		const row = byName.get(name);
		return !row || now - row.fetchedAt > TAG_META_TTL_MS;
	});

	if (!refresh.length) {
		return {
			ok: true,
			tags: unique.flatMap((name) => {
				const row = byName.get(name);
				return row ? [present(row)] : [];
			})
		};
	}

	const base = services.fixtureOrigin ?? 'https://gelbooru.com';
	const result = await gelbooruJson(
		base,
		{
			s: 'tag',
			q: 'index',
			names: refresh.join(' '),
			...readGelbooruAuth(services.db, services.secretPath)
		},
		services.fetchUpstream,
		services.log
	);
	if (!result.ok) {
		const retained = unique.flatMap((name) => {
			const row = byName.get(name);
			return row ? [present(row)] : [];
		});
		if (retained.length) return { ok: true, tags: retained };
		return result;
	}

	const fresh = normalizeTags(result.json);
	refreshTagCategories(services.db, source, fresh, now);
	for (const tag of fresh) {
		byName.set(tag.name, { ...tag, fetchedAt: now });
	}
	return {
		ok: true,
		tags: unique.flatMap((name) => {
			const row = byName.get(name);
			return row ? [present(row)] : [];
		})
	};
}

function savedTagNames(db: AppDatabase, source: string) {
	const rows = db.$client
		.prepare('select snapshot from post_snapshots where source = ?')
		.all(source) as { snapshot: string }[];
	const names = new Set<string>();
	for (const row of rows) {
		const parsed = JSON.parse(row.snapshot) as { tags?: unknown };
		if (!Array.isArray(parsed.tags)) continue;
		for (const tag of parsed.tags) {
			if (typeof tag === 'string' && tag) names.add(tag);
		}
	}
	return [...names];
}

export async function refreshSavedTags(services: AppServices) {
	const source = 'gelbooru';
	const names = savedTagNames(services.db, source);
	if (!names.length) return;
	if (gelbooruCredentialState(services.db, services.secretPath) === 'unavailable') return;
	const base = services.fixtureOrigin ?? 'https://gelbooru.com';
	try {
		const result = await gelbooruJson(
			base,
			{
				s: 'tag',
				q: 'index',
				names: names.join(' '),
				...readGelbooruAuth(services.db, services.secretPath)
			},
			services.fetchUpstream,
			services.log
		);
		if (!result.ok) return;
		refreshTagCategories(services.db, source, normalizeTags(result.json), services.now());
	} catch {
		/* keep the last categories */
	}
}
