export function redactSecrets(text: string) {
	return text
		.replace(/api_key=[^&\s]*/gi, 'api_key=REDACTED')
		.replace(/user_id=[^&\s]*/gi, 'user_id=REDACTED');
}

export function formatUpstreamError(url: string) {
	return `upstream request failed: ${redactSecrets(url)}`;
}
