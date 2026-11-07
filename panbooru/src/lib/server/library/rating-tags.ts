export const ratingOrder = ['general', 'sensitive', 'questionable', 'explicit'] as const;

export function compileRatingTags(selected: readonly string[]): string {
	const chosen = ratingOrder.filter((rating) => selected.includes(rating));
	if (chosen.length === 0 || chosen.length === ratingOrder.length) return '';
	if (chosen.length === 1) return `rating:${chosen[0]}`;
	return [...ratingOrder]
		.reverse()
		.filter((rating) => !chosen.includes(rating))
		.map((rating) => `-rating:${rating}`)
		.join(' ');
}
