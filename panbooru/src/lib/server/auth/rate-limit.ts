export const AUTH_RATE_LIMIT = 5;

export class RateLimiter {
	private readonly counts = new Map<string, number>();

	allow(key: string) {
		const next = (this.counts.get(key) ?? 0) + 1;
		this.counts.set(key, next);
		return next <= AUTH_RATE_LIMIT;
	}
}
