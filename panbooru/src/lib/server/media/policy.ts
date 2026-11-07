import { BlockList, isIP } from 'node:net';

const mediaPath =
	/^\/images\/[A-Za-z0-9._-]+$|^\/(?:images|thumbnails)\/[0-9a-f]{2}\/[0-9a-f]{2}\/[A-Za-z0-9._-]+$/;

const blocked = new BlockList();
blocked.addSubnet('0.0.0.0', 8);
blocked.addSubnet('10.0.0.0', 8);
blocked.addSubnet('127.0.0.0', 8);
blocked.addSubnet('169.254.0.0', 16);
blocked.addSubnet('172.16.0.0', 12);
blocked.addSubnet('192.168.0.0', 16);
blocked.addSubnet('100.64.0.0', 10);
blocked.addSubnet('192.0.2.0', 24);
blocked.addSubnet('198.51.100.0', 24);
blocked.addSubnet('203.0.113.0', 24);
blocked.addSubnet('224.0.0.0', 4);
blocked.addAddress('255.255.255.255');
blocked.addAddress('::', 'ipv6');
blocked.addAddress('::1', 'ipv6');
blocked.addSubnet('fc00::', 7, 'ipv6');
blocked.addSubnet('fe80::', 10, 'ipv6');

export type DestinationOptions = {
	allowHosts: readonly string[];
	lookup: (hostname: string) => readonly string[];
};

export function checkDestination(raw: string, options: DestinationOptions) {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return { ok: false as const, reason: 'invalid-url' };
	}
	if (url.protocol !== 'https:') return { ok: false as const, reason: 'scheme' };
	if (url.username || url.password) return { ok: false as const, reason: 'userinfo' };
	if (url.hash) return { ok: false as const, reason: 'fragment' };
	if (url.port) return { ok: false as const, reason: 'port' };
	if ([...url.searchParams.keys()].length > 0) return { ok: false as const, reason: 'query' };
	if (isIP(url.hostname)) return { ok: false as const, reason: 'ip-literal' };
	if (!options.allowHosts.includes(url.hostname)) return { ok: false as const, reason: 'host' };
	if (!mediaPath.test(url.pathname) || url.pathname.includes('..')) {
		return { ok: false as const, reason: 'path' };
	}
	const answers = options.lookup(url.hostname);
	if (answers.length === 0) return { ok: false as const, reason: 'dns' };
	for (const address of answers) {
		const family = isIP(address);
		if (family === 0 || blocked.check(address, family === 6 ? 'ipv6' : 'ipv4')) {
			return { ok: false as const, reason: 'address' };
		}
	}
	return { ok: true as const };
}

export function checkRedirect(status: number) {
	if (status >= 300 && status < 400) return { ok: false as const, reason: 'redirect' };
	return { ok: true as const };
}
