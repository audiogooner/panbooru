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
create table if not exists source_credentials (
	source text primary key,
	ciphertext blob not null,
	nonce blob not null,
	auth_tag blob not null,
	key_version integer not null,
	user_id text not null,
	validated integer not null
);
`;

const libraryMigration = `
create table media_objects (
	id text primary key,
	content_hash text unique,
	relative_path text,
	mime text,
	byte_size integer,
	verified_at integer,
	state text not null
);
create table saved_items (
	id text primary key,
	metadata_hash text not null unique,
	hash_version integer not null,
	saved_at integer not null,
	snapshot_id text not null,
	source text not null,
	remote_id text not null,
	media_id text references media_objects(id),
	retention_state text not null
);
create table post_snapshots (
	id text primary key,
	item_id text not null references saved_items(id),
	snapshot text not null,
	source text not null,
	remote_id text not null,
	fetched_at integer not null
);
create table favorites (
	item_id text primary key references saved_items(id),
	favorited_at integer not null
);
create table albums (
	id text primary key,
	name text not null,
	created_at integer not null
);
create table album_items (
	album_id text not null references albums(id),
	item_id text not null references saved_items(id),
	added_at integer not null,
	primary key (album_id, item_id)
);
create table jobs (
	id text primary key,
	kind text not null,
	item_id text not null references saved_items(id),
	dedup_key text not null unique,
	state text not null,
	attempts integer not null,
	next_attempt_at integer,
	lease_until integer,
	progress integer not null,
	error text,
	file_url text not null,
	expected_hash text
);
`;

const removalMigration = `
create table removal_actions (
	id text primary key,
	removed_at integer not null,
	expires_at integer not null
);
create table removal_memberships (
	action_id text not null references removal_actions(id) on delete cascade,
	item_id text not null,
	kind text not null,
	album_id text,
	added_at integer not null
);
create unique index removal_memberships_identity
	on removal_memberships (action_id, item_id, kind, ifnull(album_id, ''));
`;

const derivativeMigration = `
create table derivatives (
	id text primary key,
	source_identity text not null,
	recipe text not null,
	width integer not null,
	height integer not null,
	format text not null,
	relative_path text not null,
	byte_size integer not null,
	label text,
	unique (source_identity, recipe)
);
`;

const tagMigration = `
create table source_tags (
	source text not null,
	name text not null,
	category text not null,
	fetched_at integer not null,
	primary key (source, name)
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
	const library = sqlite.prepare('select version from schema_migrations where version = 2').get();
	if (!library) {
		sqlite.transaction(() => {
			sqlite.exec(libraryMigration);
			sqlite
				.prepare('insert into schema_migrations (version, applied_at, checksum) values (2, ?, ?)')
				.run(Date.now(), 'library-v2');
		})();
	}
	const removal = sqlite.prepare('select version from schema_migrations where version = 3').get();
	if (!removal) {
		sqlite.transaction(() => {
			sqlite.exec(removalMigration);
			sqlite
				.prepare('insert into schema_migrations (version, applied_at, checksum) values (3, ?, ?)')
				.run(Date.now(), 'removal-v3');
		})();
	}
	const tags = sqlite.prepare('select version from schema_migrations where version = 4').get();
	if (!tags) {
		sqlite.transaction(() => {
			sqlite.exec(tagMigration);
			sqlite
				.prepare('insert into schema_migrations (version, applied_at, checksum) values (4, ?, ?)')
				.run(Date.now(), 'source-tags-v4');
		})();
	}
	const derivative = sqlite
		.prepare('select version from schema_migrations where version = 5')
		.get();
	if (!derivative) {
		sqlite.transaction(() => {
			sqlite.exec(derivativeMigration);
			sqlite
				.prepare('insert into schema_migrations (version, applied_at, checksum) values (5, ?, ?)')
				.run(Date.now(), 'derivatives-v5');
		})();
	}
	return drizzle(sqlite, { schema });
}

export type AppDatabase = ReturnType<typeof openDatabase>;
