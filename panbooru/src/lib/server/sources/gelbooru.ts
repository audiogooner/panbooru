import { redactSecrets } from '#lib/server/http/redact.ts';

export async function probeGelbooruCredentials(
	base: string,
	userId: string,
	apiKey: string,
	log: (line: string) => void
) {
	const url = new URL('/index.php', base.endsWith('/') ? base : `${base}/`);
	url.searchParams.set('page', 'dapi');
	url.searchParams.set('s', 'post');
	url.searchParams.set('q', 'index');
	url.searchParams.set('json', '1');
	url.searchParams.set('limit', '1');
	url.searchParams.set('user_id', userId);
	url.searchParams.set('api_key', apiKey);
	log(redactSecrets(url.toString()));
	const response = await fetch(url, { redirect: 'manual' });
	if (response.status !== 200) return false;
	const text = await response.text();
	try {
		JSON.parse(text);
		return true;
	} catch {
		return false;
	}
}
