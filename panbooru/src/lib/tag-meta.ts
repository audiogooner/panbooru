export type TagMeta = { category: string; count: number };

type TagRow = { name: string; category: string; count: number };

const ENDPOINT = '/api/source/gelbooru/tags';
const BATCH_SIZE = 100;

const cache = new Map<string, TagMeta>();
// One request per name at a time, shared by every caller that asks for it.
const inflight = new Map<string, Promise<void>>();

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

export function writeTagMeta(tags: readonly TagRow[]) {
	for (const tag of tags) {
		if (!tag?.name) continue;
		cache.set(tag.name, { category: tag.category, count: tag.count });
	}
}

async function fetchBatch(names: string[]) {
	try {
		const response = await fetch(ENDPOINT, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ names })
		});
		if (!response.ok) return;
		const body = (await response.json()) as { data?: { tags?: TagRow[] } };
		writeTagMeta(body.data?.tags ?? []);
	} catch {
		// Tags stay uncached and fall back to General; a later call can retry.
	}
}

function startBatch(names: string[]): Promise<void> {
	const request = fetchBatch(names).finally(() => {
		for (const name of names) {
			if (inflight.get(name) === request) inflight.delete(name);
		}
	});
	for (const name of names) inflight.set(name, request);
	return request;
}

function settleOrAbort(all: Promise<unknown>, signal?: AbortSignal): Promise<void> {
	if (!signal) return all.then(() => undefined);
	if (signal.aborted) return Promise.resolve();
	return new Promise((resolve) => {
		const done = () => {
			signal.removeEventListener('abort', done);
			resolve();
		};
		signal.addEventListener('abort', done, { once: true });
		void all.then(done, done);
	});
}

/**
 * Fetches only uncached names, shares in-flight requests between callers, and
 * returns whatever the cache holds for `names`. The fetch itself is shared, so
 * aborting `signal` only stops this caller from waiting.
 */
export async function ensureTagMeta(
	names: readonly string[],
	signal?: AbortSignal
): Promise<Record<string, TagMeta>> {
	const missing = [...new Set(missingTagNames(names))];
	if (missing.length === 0 || signal?.aborted) return readTagMeta(names);

	const waits = new Set<Promise<void>>();
	const fresh: string[] = [];
	for (const name of missing) {
		const pending = inflight.get(name);
		if (pending) waits.add(pending);
		else fresh.push(name);
	}
	for (let at = 0; at < fresh.length; at += BATCH_SIZE) {
		waits.add(startBatch(fresh.slice(at, at + BATCH_SIZE)));
	}

	await settleOrAbort(Promise.all(waits), signal);
	return readTagMeta(names);
}

/** Fire-and-forget `ensureTagMeta` for prefetching. */
export function warmTagMeta(names: readonly string[]) {
	void ensureTagMeta(names);
}
