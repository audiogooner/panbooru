import type { AppServices } from '#lib/server/auth/dispatch.ts';
import type { AppDatabase } from '#lib/server/db/index.ts';
import { gelbooruJson, normalizeTags, readGelbooruAuth } from '#lib/server/sources/gelbooru.ts';

export type TagCategory = {
	name: string;
	category: string;
};

export function refreshTagCategories(
	db: AppDatabase,
	source: string,
	tags: readonly TagCategory[],
	now: number
) {
	const upsert = db.$client.prepare(
		`insert into source_tags (source, name, category, fetched_at)
		 values (?, ?, ?, ?)
		 on conflict (source, name) do update set
		 	category = excluded.category,
		 	fetched_at = excluded.fetched_at`
	);
	db.$client.transaction(() => {
		for (const tag of tags) {
			if (!tag.name) continue;
			upsert.run(source, tag.name, tag.category, now);
		}
	})();
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
	const base = services.fixtureOrigin ?? 'https://gelbooru.com';
	try {
		const result = await gelbooruJson(
			base,
			{
				s: 'tag',
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
