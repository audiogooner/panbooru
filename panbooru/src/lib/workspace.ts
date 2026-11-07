import * as devalue from 'devalue';

/** SvelteKit stores shallow `page.state` here, serialized with devalue. */
const HISTORY_METADATA_KEY = 'sveltekit:metadata';

export type HistoryCursor = { cursor: number };

export function readHistoryCursor(state: unknown): number {
	const direct = cursorOf(state);
	if (direct !== null) return direct;
	if (!isRecord(state)) return 0;
	const metadata = state[HISTORY_METADATA_KEY];
	if (!isRecord(metadata) || typeof metadata.state !== 'string') return 0;
	try {
		return cursorOf(devalue.parse(metadata.state)) ?? 0;
	} catch {
		return 0;
	}
}

/**
 * Mark the current history entry with its cursor.
 * Replace, never push: a reload must not add a second copy of this entry.
 * The entry only carries a cursor, which is not enough to rebuild earlier result snapshots.
 */
export function rehydrateHistory(state: unknown, replace: (state: HistoryCursor) => void): number {
	const cursor = readHistoryCursor(state);
	replace({ cursor });
	return cursor;
}

function cursorOf(state: unknown): number | null {
	if (!isRecord(state)) return null;
	const cursor = state.cursor;
	return typeof cursor === 'number' && Number.isFinite(cursor) ? cursor : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}
