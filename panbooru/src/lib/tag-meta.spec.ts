import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	ensureTagMeta,
	missingTagNames,
	readTagMeta,
	warmTagMeta,
	writeTagMeta
} from '#lib/tag-meta.ts';

function tagsResponse(names: string[]) {
	const tags = names.map((name, index) => ({ name, category: 'character', count: index + 1 }));
	return new Response(JSON.stringify({ data: { tags } }), { status: 200 });
}

function requestedNames(call: unknown[]): string[] {
	const init = call[1] as RequestInit;
	return (JSON.parse(init.body as string) as { names: string[] }).names;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('tag meta cache', () => {
	it('reports hits and misses', () => {
		writeTagMeta([{ name: 'cache_hit', category: 'artist', count: 7 }]);
		expect(readTagMeta(['cache_hit', 'cache_miss'])).toEqual({
			cache_hit: { category: 'artist', count: 7 }
		});
		expect(missingTagNames(['cache_hit', 'cache_miss', ''])).toEqual(['cache_miss']);
	});

	it('fetches only uncached names', async () => {
		writeTagMeta([{ name: 'only_known', category: 'copyright', count: 3 }]);
		const fetchMock = vi.fn(async () => tagsResponse(['only_new']));
		vi.stubGlobal('fetch', fetchMock);

		const result = await ensureTagMeta(['only_known', 'only_new']);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(requestedNames(fetchMock.mock.calls[0])).toEqual(['only_new']);
		expect(result.only_known).toEqual({ category: 'copyright', count: 3 });
		expect(result.only_new).toEqual({ category: 'character', count: 1 });
	});

	it('skips the network when everything is cached', async () => {
		writeTagMeta([{ name: 'all_cached', category: 'general', count: 1 }]);
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await ensureTagMeta(['all_cached']);

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('shares one fetch between overlapping concurrent calls', async () => {
		const fetchMock = vi.fn(async () => tagsResponse(['dup_a', 'dup_b']));
		vi.stubGlobal('fetch', fetchMock);

		const [first, second] = await Promise.all([
			ensureTagMeta(['dup_a', 'dup_b']),
			ensureTagMeta(['dup_b', 'dup_a'])
		]);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(Object.keys(first).sort()).toEqual(['dup_a', 'dup_b']);
		expect(Object.keys(second).sort()).toEqual(['dup_a', 'dup_b']);
	});

	it('only fetches the non-overlapping remainder for a partial overlap', async () => {
		let release: (response: Response) => void = () => {};
		const fetchMock = vi
			.fn()
			.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)))
			.mockImplementationOnce(async () => tagsResponse(['part_b']));
		vi.stubGlobal('fetch', fetchMock);

		const first = ensureTagMeta(['part_a']);
		const second = ensureTagMeta(['part_a', 'part_b']);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(requestedNames(fetchMock.mock.calls[1])).toEqual(['part_b']);

		release(tagsResponse(['part_a']));
		await Promise.all([first, second]);
		expect(Object.keys(readTagMeta(['part_a', 'part_b'])).sort()).toEqual(['part_a', 'part_b']);
	});

	it('stops waiting on abort without cancelling the shared fetch', async () => {
		let release: (response: Response) => void = () => {};
		const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
		vi.stubGlobal('fetch', fetchMock);

		const controller = new AbortController();
		const aborted = ensureTagMeta(['abort_a'], controller.signal);
		const other = ensureTagMeta(['abort_a']);
		controller.abort();
		expect(await aborted).toEqual({});

		release(tagsResponse(['abort_a']));
		expect(await other).toEqual({ abort_a: { category: 'character', count: 1 } });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('leaves tags uncached after a failed fetch so a later call retries', async () => {
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new Error('offline'))
			.mockImplementationOnce(async () => tagsResponse(['retry_a']));
		vi.stubGlobal('fetch', fetchMock);

		expect(await ensureTagMeta(['retry_a'])).toEqual({});
		expect(await ensureTagMeta(['retry_a'])).toEqual({
			retry_a: { category: 'character', count: 1 }
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('warmTagMeta fills the cache without being awaited', async () => {
		const fetchMock = vi.fn(async () => tagsResponse(['warm_a']));
		vi.stubGlobal('fetch', fetchMock);

		warmTagMeta(['warm_a']);
		await vi.waitFor(() => expect(readTagMeta(['warm_a']).warm_a).toBeDefined());
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
