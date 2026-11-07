import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '#lib/server/db/index.ts';

export const removalHoldMs = 60_000;

export type HeldMembership = {
	itemId: string;
	kind: 'favorite' | 'album';
	albumId: string | null;
	addedAt: number;
};

export function recordHold(db: AppDatabase, entries: HeldMembership[], now: number) {
	db.$client.prepare('delete from removal_actions').run();
	if (!entries.length) return null;
	const id = randomUUID();
	db.$client
		.prepare('insert into removal_actions (id, removed_at, expires_at) values (?, ?, ?)')
		.run(id, now, now + removalHoldMs);
	const insert = db.$client.prepare(
		`insert into removal_memberships (action_id, item_id, kind, album_id, added_at)
		 values (?, ?, ?, ?, ?)`
	);
	for (const entry of entries) {
		insert.run(id, entry.itemId, entry.kind, entry.albumId, entry.addedAt);
	}
	return id;
}

export function undoRemoval(db: AppDatabase, dataDir: string, actionId: string, now: number) {
	void dataDir;
	const action = db.$client
		.prepare('select expires_at as expiresAt from removal_actions where id = ?')
		.get(actionId) as { expiresAt: number } | undefined;
	if (!action || now >= action.expiresAt) return false;
	const rows = db.$client
		.prepare(
			`select item_id as itemId, kind, album_id as albumId, added_at as addedAt
			 from removal_memberships where action_id = ?`
		)
		.all(actionId) as HeldMembership[];
	db.$client.transaction(() => {
		for (const row of rows) {
			if (row.kind === 'favorite') {
				db.$client
					.prepare(
						'insert into favorites (item_id, favorited_at) values (?, ?) on conflict (item_id) do nothing'
					)
					.run(row.itemId, row.addedAt);
			} else if (row.albumId) {
				db.$client
					.prepare(
						`insert into album_items (album_id, item_id, added_at)
						 values (?, ?, ?) on conflict (album_id, item_id) do nothing`
					)
					.run(row.albumId, row.itemId, row.addedAt);
			}
		}
		db.$client.prepare('delete from removal_actions where id = ?').run(actionId);
	})();
	return true;
}
