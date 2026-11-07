export type TagMeta = { category: string; count: number };

const cache = new Map<string, TagMeta>();

export function readTagMeta(names: readonly string[]): Record<string, TagMeta> {
	const next: Record<string, TagMeta> = {};
	for (const name of names) {
		const meta = cache.get(name);
		if (meta) next[name] = meta;
	}
	return next;
}

export function missingTagNames(names: readonly string[]): string[] {
	return names.filter((name) => name.length > 0 && !cache.has(name));
}

export function writeTagMeta(tags: readonly { name: string; category: string; count: number }[]) {
	for (const tag of tags) {
		if (!tag?.name) continue;
		cache.set(tag.name, { category: tag.category, count: tag.count });
	}
}
