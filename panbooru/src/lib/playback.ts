const positions = new Map<string, number>();
const volumeKey = 'panbooru.volume';
const mutedKey = 'panbooru.muted';

export function savedPosition(id: string) {
	return positions.get(id);
}

export function savePosition(id: string, time: number) {
	if (Number.isFinite(time) && time > 0) positions.set(id, time);
}

export function readPlaybackPreference() {
	const volume = Number(localStorage.getItem(volumeKey));
	return {
		volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1,
		muted: localStorage.getItem(mutedKey) === '1'
	};
}

export function writePlaybackPreference(volume: number, muted: boolean) {
	localStorage.setItem(volumeKey, String(volume));
	localStorage.setItem(mutedKey, muted ? '1' : '0');
}
