/**
 * Multi-select stays with the view that created it.
 * A revision counter lets galleries read the plain sets without proxying them.
 */

let revision = $state(0);

export type SelectionSource = 'gelbooru' | 'favorites' | 'album';

/** Applied query captured with a whole-query selection. */
export type SelectionQuery = {
	source: SelectionSource;
	sourceAlbumId: string | null;
	query: string;
	rating: string[];
	media: string[];
	sort: string;
	seed: number;
};

type SelectionRecord = {
	active: boolean;
	allQuery: boolean;
	anchor: string | null;
	ids: Set<string>;
	excluded: Set<string>;
	query: SelectionQuery | null;
};

const records = new Map<string, SelectionRecord>();

function touch() {
	revision += 1;
}

function recordFor(key: string) {
	let record = records.get(key);
	if (!record) {
		record = {
			active: false,
			allQuery: false,
			anchor: null,
			ids: new Set(),
			excluded: new Set(),
			query: null
		};
		records.set(key, record);
	}
	return record;
}

export function selectionSnapshot(key: string) {
	void revision;
	const record = records.get(key);
	return {
		active: record?.active ?? false,
		allQuery: Boolean(record?.allQuery),
		excluded: record?.excluded.size ?? 0,
		count: record?.ids.size ?? 0
	};
}

/** Sidebar check badge: "All" for a whole query, otherwise the selected count. */
export function selectionLabel(key: string): string | null {
	const snap = selectionSnapshot(key);
	if (!snap.active) return null;
	if (snap.allQuery && snap.excluded === 0) return 'All';
	return String(snap.count);
}

export function isSelected(key: string, id: string) {
	void revision;
	const record = records.get(key);
	if (!record?.active) return false;
	if (record.allQuery) return !record.excluded.has(id);
	return record.ids.has(id);
}

export function selectedIds(key: string, ordered: readonly string[]) {
	return ordered.filter((id) => isSelected(key, id));
}

export function exitSelection(key: string) {
	const record = recordFor(key);
	record.active = false;
	record.allQuery = false;
	record.anchor = null;
	record.ids.clear();
	record.excluded.clear();
	record.query = null;
	touch();
}

export function deselectAll(key: string) {
	const record = recordFor(key);
	record.active = true;
	record.allQuery = false;
	record.anchor = null;
	record.ids.clear();
	record.excluded.clear();
	record.query = null;
	touch();
}

function copyQuery(query: SelectionQuery): SelectionQuery {
	return {
		source: query.source,
		sourceAlbumId: query.sourceAlbumId,
		query: query.query,
		rating: [...query.rating],
		media: [...query.media],
		sort: query.sort,
		seed: query.seed
	};
}

export function selectLoaded(
	key: string,
	ordered: readonly string[],
	query?: SelectionQuery | null
) {
	const record = recordFor(key);
	record.active = true;
	record.allQuery = true;
	record.excluded.clear();
	record.ids.clear();
	for (const id of ordered) record.ids.add(id);
	record.anchor = ordered.at(-1) ?? null;
	record.query = query ? copyQuery(query) : null;
	touch();
}

export function selectionQuery(key: string): SelectionQuery | null {
	void revision;
	const record = records.get(key);
	if (!record?.active || !record.allQuery || !record.query) return null;
	return copyQuery(record.query);
}

export function excludedIds(key: string): string[] {
	void revision;
	const record = records.get(key);
	if (!record?.active || !record.allQuery) return [];
	return [...record.excluded];
}

/** Newly loaded rows join a whole-query selection unless they were excluded. */
export function adoptLoaded(key: string, ordered: readonly string[]) {
	const record = records.get(key);
	if (!record?.active || !record.allQuery) return;
	let changed = false;
	for (const id of ordered) {
		if (record.excluded.has(id) || record.ids.has(id)) continue;
		record.ids.add(id);
		changed = true;
	}
	if (changed) touch();
}

export function forgetIds(key: string, ids: readonly string[]) {
	const record = records.get(key);
	if (!record) return;
	for (const id of ids) {
		record.ids.delete(id);
		record.excluded.delete(id);
	}
	if (record.anchor && ids.includes(record.anchor)) record.anchor = null;
	if (record.ids.size === 0 && !(record.allQuery && record.query)) {
		exitSelection(key);
		return;
	}
	touch();
}

function selectOne(record: SelectionRecord, id: string) {
	record.excluded.delete(id);
	record.ids.add(id);
}

function deselectOne(record: SelectionRecord, id: string) {
	record.ids.delete(id);
	if (record.allQuery) record.excluded.add(id);
}

export function galleryClick(
	key: string,
	id: string,
	ordered: readonly string[],
	event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }
): 'open' | 'select' {
	const record = recordFor(key);
	const modified = event.metaKey || event.ctrlKey;
	if (!record.active) {
		if (!event.shiftKey && !modified) return 'open';
		record.active = true;
	}
	if (event.shiftKey) {
		const anchor = record.anchor && ordered.includes(record.anchor) ? record.anchor : id;
		const start = ordered.indexOf(anchor);
		const end = ordered.indexOf(id);
		if (start >= 0 && end >= 0) {
			const [from, to] = start <= end ? [start, end] : [end, start];
			const range = ordered.slice(from, to + 1);
			if (!isSelected(key, id)) {
				for (const item of range) selectOne(record, item);
			} else {
				for (const item of range) {
					if (item !== id) deselectOne(record, item);
				}
				selectOne(record, id);
			}
		} else {
			selectOne(record, id);
		}
		record.anchor = id;
		touch();
		return 'select';
	}
	if (isSelected(key, id)) deselectOne(record, id);
	else selectOne(record, id);
	record.anchor = id;
	touch();
	return 'select';
}

export function carryDrag<T extends { id: string }>(
	key: string,
	id: string,
	items: readonly T[]
): T[] {
	if (isSelected(key, id)) {
		const chosen = items.filter((item) => isSelected(key, item.id));
		if (chosen.length) return chosen;
	}
	const one = items.find((item) => item.id === id);
	return one ? [one] : [];
}

export const GALLERY_DRAG = 'application/x-panbooru-posts';

export type DragPost = {
	remoteId: string;
	tags: string[];
	width: number;
	height: number;
	mediaRef?: string;
	rating?: string;
	itemId?: string;
};

export type AlbumChoice = { id: string; name: string };
export type AlbumMembership = { albumId: string; itemId: string };
export type AlbumChange = 'add' | 'remove' | 'failed' | 'noop';

function queryBody(query: SelectionQuery, excluded: string[]) {
	return {
		source: query.source,
		...(query.sourceAlbumId ? { sourceAlbumId: query.sourceAlbumId } : {}),
		query: query.query,
		rating: [...query.rating],
		media: [...query.media],
		sort: query.sort,
		...(query.sort === 'Random' ? { seed: query.seed } : {}),
		excludedIds: excluded
	};
}

/** One collection-import body when the selection is a whole query. */
export function importRequest(
	key: string,
	action: {
		operation: 'add' | 'remove';
		destination: 'favorite' | 'album';
		albumId?: string;
	}
) {
	const query = selectionQuery(key);
	if (!query) return null;
	if (action.destination === 'album' && !action.albumId) return null;
	return {
		operation: action.operation,
		destination: action.destination,
		...(action.destination === 'album' ? { albumId: action.albumId } : {}),
		...queryBody(query, excludedIds(key))
	};
}

/** Whole-query exports send the descriptor. An explicit selection sends its ids. */
export function exportRequest(key: string, explicitIds: readonly string[]) {
	const query = selectionQuery(key);
	if (query) return queryBody(query, excludedIds(key));
	if (!explicitIds.length) return null;
	return { itemIds: [...explicitIds] };
}

export async function submitImport(body: Record<string, unknown>) {
	try {
		const response = await fetch('/api/library/imports', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		return response.ok;
	} catch {
		return false;
	}
}

function membershipPayload(post: DragPost) {
	if (post.itemId && !post.mediaRef) return { itemId: post.itemId };
	return {
		remoteId: post.remoteId,
		tags: post.tags,
		width: post.width,
		height: post.height,
		...(post.mediaRef ? { mediaRef: post.mediaRef } : {}),
		...(post.rating ? { rating: post.rating } : {})
	};
}

export async function loadAlbumChoices(posts: readonly DragPost[], signal?: AbortSignal) {
	try {
		const list = await fetch('/api/library/albums', { signal });
		if (!list.ok) return null;
		const body = (await list.json()) as { data?: { albums?: AlbumChoice[] } };
		const albums = body.data?.albums ?? [];
		const memberships: AlbumMembership[] = [];
		await Promise.all(
			posts.map(async (post) => {
				const params = new URLSearchParams();
				if (post.itemId && !post.mediaRef) params.set('itemId', post.itemId);
				else if (post.remoteId) params.set('remoteId', post.remoteId);
				else return;
				const response = await fetch(`/api/library/albums/membership?${params}`, { signal });
				if (!response.ok) return;
				const payload = (await response.json()) as { data?: { memberships?: AlbumMembership[] } };
				memberships.push(...(payload.data?.memberships ?? []));
			})
		);
		return { albums, memberships };
	} catch {
		return null;
	}
}

/** Per-item album add or removal. A whole query does not use this. */
export async function applyAlbumChoice(
	albumId: string,
	posts: readonly DragPost[],
	memberships: readonly AlbumMembership[]
): Promise<AlbumChange> {
	if (!posts.length) return 'noop';
	const rows = memberships.filter((item) => item.albumId === albumId);
	const seen: string[] = [];
	for (const row of rows) {
		if (!seen.includes(row.itemId)) seen.push(row.itemId);
	}
	const present = seen.length;
	if (present === posts.length) {
		if (!rows.length) return 'noop';
		const results = await Promise.all(
			rows.map((row) =>
				fetch(
					`/api/library/albums/${encodeURIComponent(albumId)}/items/${encodeURIComponent(row.itemId)}`,
					{ method: 'DELETE' }
				)
			)
		);
		return results.every((response) => response.ok) ? 'remove' : 'failed';
	}
	const results = await Promise.all(
		posts.map((post) =>
			fetch(`/api/library/albums/${encodeURIComponent(albumId)}/items`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(membershipPayload(post))
			})
		)
	);
	return results.every((response) => response.ok) ? 'add' : 'failed';
}

export async function createAlbumRequest(name: string) {
	const trimmed = name.trim();
	if (!trimmed) return { message: 'Enter a title.' };
	try {
		const response = await fetch('/api/library/albums', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: trimmed })
		});
		const body = (await response.json().catch(() => null)) as {
			data?: { id?: string };
			message?: string;
		} | null;
		if (!response.ok || !body?.data?.id) {
			return { message: body?.message ?? 'Album could not be created' };
		}
		return { id: body.data.id };
	} catch {
		return { message: 'Album could not be created' };
	}
}

export async function saveDownload(response: Response, fallbackName: string) {
	const blob = await response.blob();
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	const match = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '');
	link.href = url;
	link.download = match?.[1] || fallbackName;
	document.body.append(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}
