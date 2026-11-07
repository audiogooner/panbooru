import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function maintenancePath(dataDir: string) {
	return join(dataDir, 'maintenance');
}

export function inMaintenance(dataDir: string) {
	return existsSync(maintenancePath(dataDir));
}

export function enterMaintenance(dataDir: string) {
	writeFileSync(maintenancePath(dataDir), 'backup\n', { flag: 'wx', mode: 0o600 });
}

export function leaveMaintenance(dataDir: string) {
	try {
		unlinkSync(maintenancePath(dataDir));
	} catch {
		/* maintenance was already released */
	}
}
