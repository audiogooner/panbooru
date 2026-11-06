import { randomUUID } from 'node:crypto';

export function jsonData(data: unknown, status = 200) {
	return Response.json(
		{ data, requestId: randomUUID() },
		{ status, headers: { 'cache-control': 'private, no-store' } }
	);
}

export function jsonError(code: string, message: string, status: number, retryable = false) {
	return Response.json(
		{ code, message, retryable, requestId: randomUUID() },
		{ status, headers: { 'cache-control': 'private, no-store' } }
	);
}
