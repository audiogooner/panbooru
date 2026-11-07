import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { AppDatabase } from '#lib/server/db/index.ts';

export const removalHoldMs = 60_000;

export type HeldMembership = {
	itemId: string;
	kind: 'favorite' | 'album';
	albumId: string | null;
	addedAt: number;
};

export function expireRemovals(db: AppDatabase, dataDir: string, now: number) {
	const expired = db.$client
		.prepare(
			`select removal_memberships.item_id as itemId
			 from removal_memberships
			 join removal_actions on removal_actions.id = removal_memberships.action_id
			 where removal_actions.expires_at <= ?`
		)
		.all(now) as { itemId: string }[];
	const paths = db.$client.transaction(() => {
		db.$client.prepare('delete from removal_actions where expires_at <= ?').run(now);
		return purgeUnretained(
			db,
			expired.map((row) => row.itemId)
		);
	})();
	releaseFiles(dataDir, paths);
}

export function recordHold(db: AppDatabase, entries: HeldMembership[], now: number) {
	const previous = db.$client
		.prepare('select item_id as itemId from removal_memberships')
		.all() as { itemId: string }[];
	db.$client.prepare('delete from removal_actions').run();
	if (entries.length) {
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
	}
	const held = new Set(entries.map((entry) => entry.itemId));
	return purgeUnretained(
		db,
		previous.map((row) => row.itemId).filter((itemId) => !held.has(itemId))
	);
}

export function undoRemoval(db: AppDatabase, dataDir: string, actionId: string, now: number) {
	expireRemovals(db, dataDir, now);
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

function purgeUnretained(db: AppDatabase, itemIds: string[]) {
	const paths: string[] = [];
	for (const itemId of new Set(itemIds)) {
		const favorite = db.$client.prepare('select 1 from favorites where item_id = ?').get(itemId);
		const album = db.$client.prepare('select 1 from album_items where item_id = ?').get(itemId);
		if (favorite || album) continue;
		const item = db.$client
			.prepare('select media_id as mediaId from saved_items where id = ?')
			.get(itemId) as { mediaId: string | null } | undefined;
		if (!item) continue;
		db.$client.prepare('delete from jobs where item_id = ?').run(itemId);
		db.$client.prepare('delete from album_items where item_id = ?').run(itemId);
		db.$client.prepare('delete from favorites where item_id = ?').run(itemId);
		db.$client.prepare('delete from post_snapshots where item_id = ?').run(itemId);
		db.$client.prepare('update saved_items set media_id = null where id = ?').run(itemId);
		db.$client.prepare('delete from saved_items where id = ?').run(itemId);
		const path = unreferencedPath(db, item.mediaId);
		if (path) paths.push(path);
	}
	return paths;
}

function unreferencedPath(db: AppDatabase, mediaId: string | null) {
	if (!mediaId) return null;
	const used = db.$client.prepare('select id from saved_items where media_id = ?').get(mediaId);
	if (used) return null;
	const media = db.$client
		.prepare('select relative_path as relativePath from media_objects where id = ?')
		.get(mediaId) as { relativePath: string | null } | undefined;
	db.$client.prepare('delete from media_objects where id = ?').run(mediaId);
	const path = media?.relativePath ?? '';
	if (!path || path.startsWith('/') || path.includes('..')) return null;
	return path;
}

function releaseFiles(dataDir: string, paths: string[]) {
	for (const relativePath of paths) {
		try {
			unlinkSync(join(dataDir, relativePath));
		} catch {
			/* the file is already gone */
		}
	}
}

export function releaseHeldFiles(dataDir: string, paths: string[]) {
	releaseFiles(dataDir, paths);
}
