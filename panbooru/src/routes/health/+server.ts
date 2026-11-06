import { healthResponse } from '#lib/server/app.ts';

export function GET() {
	return healthResponse();
}
