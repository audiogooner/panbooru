const playableTypes = new Set(['video/mp4']);
const animatedImageTypes = new Set(['image/gif', 'image/apng', 'image/webp']);

export function playable(type: string) {
	const base = type.split(';')[0]?.trim().toLowerCase() ?? '';
	return playableTypes.has(base);
}

export function isAnimatedMedia(type: string) {
	const base = type.split(';')[0]?.trim().toLowerCase() ?? '';
	return animatedImageTypes.has(base);
}

export function mediaTypeForPath(pathname: string) {
	const path = pathname.toLowerCase();
	if (path.endsWith('.mp4') || path.endsWith('.m4v')) return 'video/mp4';
	if (path.endsWith('.webm')) return 'video/webm';
	if (path.endsWith('.ogv') || path.endsWith('.ogg')) return 'video/ogg';
	if (path.endsWith('.mov')) return 'video/quicktime';
	if (path.endsWith('.mkv')) return 'video/x-matroska';
	if (path.endsWith('.gif')) return 'image/gif';
	if (path.endsWith('.apng')) return 'image/apng';
	if (path.endsWith('.webp')) return 'image/webp';
	return '';
}
