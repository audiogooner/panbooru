export type UpstreamRequest = {
	method?: string;
	headers?: Headers;
	redirect?: RequestRedirect;
};

export function singleRangeHeader(header: string | null) {
	if (!header) return null;
	const match = /^bytes=(.+)$/i.exec(header.trim());
	if (!match) return null;
	const spec = match[1]?.trim() ?? '';
	if (spec.includes(',')) return null;
	if (!/^(?:\d+-\d*|\d*-\d+)$/.test(spec) || spec === '-') return null;
	return `bytes=${spec}`;
}

export type OwnedRange =
	| { status: 200; start: number; end: number }
	| { status: 206; start: number; end: number }
	| { status: 416 };

export function resolveOwnedRange(header: string | null, size: number): OwnedRange {
	const single = singleRangeHeader(header);
	if (!single) return { status: 200, start: 0, end: Math.max(0, size - 1) };
	const spec = single.slice('bytes='.length);
	let start: number;
	let end: number;
	if (spec.startsWith('-')) {
		const suffix = Number(spec.slice(1));
		if (!Number.isFinite(suffix) || suffix <= 0 || size === 0) return { status: 416 };
		start = Math.max(0, size - suffix);
		end = size - 1;
	} else {
		const [rawStart, rawEnd] = spec.split('-');
		start = Number(rawStart);
		end = rawEnd ? Number(rawEnd) : size - 1;
	}
	if (
		size === 0 ||
		start >= size ||
		start > end ||
		!Number.isFinite(start) ||
		!Number.isFinite(end)
	) {
		return { status: 416 };
	}
	return { status: 206, start, end: Math.min(end, size - 1) };
}

export function passThroughMedia(method: string, upstream: Response) {
	const status = upstream.status;
	if (status !== 200 && status !== 206 && status !== 416) return null;
	const type = upstream.headers.get('content-type') ?? '';
	if (status !== 416 && !type.startsWith('image/') && !type.startsWith('video/')) return null;

	const headers = new Headers();
	headers.set('x-content-type-options', 'nosniff');
	headers.set('cache-control', 'private, no-store');
	headers.set('accept-ranges', 'bytes');
	if (type && status !== 416) headers.set('content-type', type);
	const length = upstream.headers.get('content-length');
	if (length && status !== 416) headers.set('content-length', length);
	const contentRange = upstream.headers.get('content-range');
	if (contentRange && status !== 200) headers.set('content-range', contentRange);
	if (method === 'HEAD' || status === 416) {
		void upstream.body?.cancel();
		return new Response(null, { status, headers });
	}
	return new Response(upstream.body, { status, headers });
}
