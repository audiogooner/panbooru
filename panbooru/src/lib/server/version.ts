import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function appVersion() {
	try {
		const parsed = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
			version?: string;
		};
		if (parsed.version) return parsed.version;
	} catch {
		/* a bundled server keeps a fallback when package.json is not beside the process */
	}
	return '0.0.1';
}

export const APP_VERSION = appVersion();
