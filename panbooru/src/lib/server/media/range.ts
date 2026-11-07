import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';

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

export function ownedMediaResponse(options: {
	method: string;
	size: number;
	type: string;
	rangeHeader: string | null;
	filename?: string;
	label?: string | null;
	cacheControl?: string;
	open: (start: number, end: number) => BodyInit | null;
}) {
	const ranged = ownedSpan(options.method, options.rangeHeader, options.size);
	const headers = new Headers();
	headers.set('content-type', options.type);
	headers.set('x-content-type-options', 'nosniff');
	headers.set('cache-control', options.cacheControl ?? 'private, no-store');
	headers.set('accept-ranges', 'bytes');
	if (options.filename) {
		headers.set(
			'content-disposition',
			`attachment; filename="${options.filename.replace(/["\r\n]/g, '')}"`
		);
	}
	if (options.label) headers.set('x-derivative-label', options.label);
	if (ranged.status === 416) {
		headers.set('content-range', `bytes */${options.size}`);
		headers.set('content-length', '0');
		return new Response(null, { status: 416, headers });
	}
	if (ranged.status === 206) {
		headers.set('content-range', `bytes ${ranged.start}-${ranged.end}/${options.size}`);
	}
	headers.set('content-length', String(options.method === 'HEAD' ? options.size : ranged.length));
	if (options.method === 'HEAD') return new Response(null, { status: 200, headers });
	return new Response(options.open(ranged.start, ranged.end), { status: ranged.status, headers });
}

function ownedSpan(method: string, rangeHeader: string | null, size: number) {
	if (method === 'HEAD' || !singleRangeHeader(rangeHeader)) {
		return { status: 200 as const, start: 0, end: Math.max(0, size - 1), length: size };
	}
	const resolved = resolveOwnedRange(rangeHeader, size);
	if (resolved.status === 416) return { status: 416 as const, start: 0, end: -1, length: 0 };
	return {
		status: resolved.status,
		start: resolved.start,
		end: resolved.end,
		length: resolved.end - resolved.start + 1
	};
}

export function bytesMediaResponse(options: {
	method: string;
	bytes: Uint8Array;
	type: string;
	rangeHeader: string | null;
	filename?: string;
	label?: string | null;
	cacheControl?: string;
}) {
	return ownedMediaResponse({
		...options,
		size: options.bytes.length,
		open: (start, end) => options.bytes.subarray(start, Math.max(start, end + 1))
	});
}

export function fileMediaResponse(
	path: string,
	method: string,
	rangeHeader: string | null,
	type: string,
	extra?: { filename?: string; label?: string | null; cacheControl?: string }
) {
	let size = 0;
	try {
		size = statSync(path).size;
	} catch {
		return null;
	}
	return ownedMediaResponse({
		method,
		size,
		type,
		rangeHeader,
		filename: extra?.filename,
		label: extra?.label,
		cacheControl: extra?.cacheControl,
		open: (start, end) => {
			if (size === 0 || end < start) return null;
			return Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
		}
	});
}
