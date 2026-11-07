import { afterEach, describe, expect, it, vi } from 'vitest';
import { INTERFACE_SOUNDS_KEY, interfaceSoundsEnabled, playAdd, playRemove } from '#lib/sounds.ts';

class FakeAudio {
	static plays: string[] = [];
	src: string;

	constructor(src?: string) {
		this.src = src ?? '';
	}

	pause() {}

	play() {
		FakeAudio.plays.push(this.src);
		return Promise.resolve();
	}
}

function installStorage(values: Record<string, string> = {}) {
	const stored = new Map(Object.entries(values));
	FakeAudio.plays = [];
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => (stored.has(key) ? stored.get(key)! : null),
		setItem: (key: string, value: string) => {
			stored.set(key, value);
		},
		removeItem: (key: string) => {
			stored.delete(key);
		},
		clear: () => {
			stored.clear();
		},
		key: (index: number) => [...stored.keys()][index] ?? null,
		get length() {
			return stored.size;
		}
	});
	vi.stubGlobal('Audio', FakeAudio);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('interface sounds', () => {
	it('stays on when the preference has not been stored', () => {
		installStorage();
		expect(INTERFACE_SOUNDS_KEY).toBe('panbooru-interface-sounds');
		expect(localStorage.getItem(INTERFACE_SOUNDS_KEY)).toBeNull();
		expect(interfaceSoundsEnabled()).toBe(true);
		playAdd();
		expect(FakeAudio.plays).toEqual(['/sounds/add.wav']);
	});

	it('stays silent when the preference is off', () => {
		installStorage({ [INTERFACE_SOUNDS_KEY]: '0' });
		expect(interfaceSoundsEnabled()).toBe(false);
		playAdd();
		playRemove();
		expect(FakeAudio.plays).toEqual([]);
	});
});
