import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '#lib/server/db/schema.ts';

const migration = `
create table if not exists schema_migrations (
	version integer primary key,
	applied_at integer not null,
	checksum text not null
);
create table if not exists owner (
	singleton integer primary key check (singleton = 1),
	password_hash text not null,
	auth_version integer not null,
	created_at integer not null,
	updated_at integer not null
);
create table if not exists sessions (
	token_hash text primary key,
	absolute_expires_at integer not null,
	idle_expires_at integer not null,
	revoked integer not null
);
`;

export function openDatabase(dataDir: string) {
	const directory = join(dataDir, 'db');
	mkdirSync(directory, { recursive: true });
	const sqlite = new Database(join(directory, 'panbooru.sqlite'));
	sqlite.pragma('foreign_keys = ON');
	sqlite.exec(migration);
	sqlite
		.prepare(
			'insert into schema_migrations (version, applied_at, checksum) values (1, ?, ?) on conflict (version) do nothing'
		)
		.run(Date.now(), 'owner-sessions-v1');
	return drizzle(sqlite, { schema });
}

export type AppDatabase = ReturnType<typeof openDatabase>;
