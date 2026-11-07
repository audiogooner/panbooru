export type Chord = { key: string; mod: boolean; shift: boolean; alt: boolean };

const SHORTCUTS_KEY = 'panbooru-shortcuts';

const defaults: Record<string, Chord[]> = {
	'select-all': [{ key: 'a', mod: true, shift: false, alt: false }],
	deselect: [{ key: 'a', mod: true, shift: true, alt: false }],
	remove: [{ key: 'Backspace', mod: true, shift: false, alt: false }],
	undo: [{ key: 'z', mod: true, shift: false, alt: false }],
	dismiss: [{ key: 'Escape', mod: false, shift: false, alt: false }],
	favorite: [{ key: 'w', mod: false, shift: false, alt: false }],
	album: [{ key: 's', mod: false, shift: false, alt: false }]
};

function isChord(value: unknown): value is Chord {
	if (!value || typeof value !== 'object') return false;
	const chord = value as Chord;
	return (
		typeof chord.key === 'string' &&
		typeof chord.mod === 'boolean' &&
		typeof chord.shift === 'boolean' &&
		typeof chord.alt === 'boolean'
	);
}

function chordsFor(id: string) {
	const fallback = defaults[id] ?? [];
	try {
		const raw = localStorage.getItem(SHORTCUTS_KEY);
		if (!raw) return fallback;
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
		const stored = (parsed as Record<string, unknown>)[id];
		if (!Array.isArray(stored) || !stored.every(isChord)) return fallback;
		return stored;
	} catch {
		return fallback;
	}
}

export function editingText(target: EventTarget | null) {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		(target instanceof HTMLElement && target.isContentEditable)
	);
}

export function matchesShortcut(event: KeyboardEvent, id: string) {
	const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
	return chordsFor(id).some((chord) => {
		const chordKey = chord.key.length === 1 ? chord.key.toLowerCase() : chord.key;
		return (
			key === chordKey &&
			(event.metaKey || event.ctrlKey) === chord.mod &&
			event.shiftKey === chord.shift &&
			event.altKey === chord.alt
		);
	});
}
