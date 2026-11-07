export const INTERFACE_SOUNDS_KEY = 'panbooru-interface-sounds';

const addSound = '/sounds/add.wav';
const removeSound = '/sounds/remove.wav';

type Tone = {
	pause: () => void;
	play: () => Promise<void> | void;
};

let current: Tone | null = null;

function preferenceValue() {
	try {
		return localStorage.getItem(INTERFACE_SOUNDS_KEY);
	} catch {
		return null;
	}
}

/** A missing key means on. Only the stored value "0" turns interface sounds off. */
export function interfaceSoundsEnabled() {
	return preferenceValue() !== '0';
}

function start(src: string) {
	if (!interfaceSoundsEnabled()) return;
	try {
		if (typeof Audio !== 'function') return;
		try {
			current?.pause();
		} catch {
			// A finished tone can reject pause. The new one still plays alone.
		}
		const tone = new Audio(src);
		current = tone;
		const pending = tone.play();
		if (pending && typeof pending.catch === 'function') {
			void pending.catch(() => {
				if (current === tone) current = null;
			});
		}
	} catch {
		current = null;
	}
}

export function playAdd() {
	start(addSound);
}

export function playRemove() {
	start(removeSound);
}
