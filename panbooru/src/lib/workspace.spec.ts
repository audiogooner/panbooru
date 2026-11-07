import * as devalue from 'devalue';
import { describe, expect, it } from 'vitest';
import { readHistoryCursor, rehydrateHistory } from '#lib/workspace.ts';

describe('history cursor', () => {
	it('rehydrates the current history entry without pushing another one', () => {
		const replaces: { cursor: number }[] = [];
		expect(rehydrateHistory({ cursor: 4 }, (state) => replaces.push(state))).toBe(4);
		expect(rehydrateHistory(null, (state) => replaces.push(state))).toBe(0);
		expect(replaces).toEqual([{ cursor: 4 }, { cursor: 0 }]);
	});

	it('reads a cursor from the current entry or from SvelteKit shallow history state', () => {
		expect(readHistoryCursor({ cursor: 4 })).toBe(4);
		expect(readHistoryCursor(null)).toBe(0);
		const metadata = 'sveltekit:metadata';
		expect(readHistoryCursor({ [metadata]: { state: devalue.stringify({ cursor: 6 }) } })).toBe(6);
		expect(
			readHistoryCursor({
				cursor: 2,
				[metadata]: { state: devalue.stringify({}) }
			})
		).toBe(2);
		expect(readHistoryCursor({ [metadata]: { state: 'not-history-state' } })).toBe(0);
	});
});
