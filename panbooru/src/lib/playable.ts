const playableTypes = new Set(['video/mp4']);

export function playable(type: string) {
	const base = type.split(';')[0]?.trim().toLowerCase() ?? '';
	return playableTypes.has(base);
}

export function mediaTypeForPath(pathname: string) {
	const path = pathname.toLowerCase();
	if (path.endsWith('.mp4') || path.endsWith('.m4v')) return 'video/mp4';
	if (path.endsWith('.webm')) return 'video/webm';
	if (path.endsWith('.ogv') || path.endsWith('.ogg')) return 'video/ogg';
	if (path.endsWith('.mov')) return 'video/quicktime';
	if (path.endsWith('.mkv')) return 'video/x-matroska';
	return '';
}
