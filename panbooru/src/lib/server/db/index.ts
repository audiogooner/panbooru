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

export const SCHEMA_VERSION = 9;

const collectionMigration = `
alter table albums add column updated_at integer not null default 0;
alter table albums add column pinned integer not null default 0;
alter table albums add column pin_order integer;
alter table albums add column temporary_open integer not null default 0;
alter table albums add column temporary_opened_at integer;
alter table albums add column cover_saved integer not null default 0;
alter table albums add column cover_primary text;
alter table albums add column cover_support_1 text;
alter table albums add column cover_support_2 text;
alter table albums add column cover_support_3 text;
update albums set updated_at = created_at;
create table saved_searches (
	id text primary key,
	name text not null,
	type text not null check (type in ('search', 'artist', 'character')),
	query text not null,
	rating text not null,
	media text not null,
	sort text not null check (sort in ('Newest', 'Oldest', 'Highest score', 'Random')),
	cover_saved integer not null default 0,
	cover_primary text,
	cover_support_1 text,
	cover_support_2 text,
	cover_support_3 text,
	created_at integer not null,
	updated_at integer not null
);
create unique index saved_searches_applied on saved_searches (query, rating, media, sort);
`;

const collectionImportMigration = `
create table collection_imports (
	id text primary key,
	operation text not null check (operation in ('add', 'remove')),
	destination_kind text not null check (destination_kind in ('favorite', 'album')),
	destination_album_id text,
	source_kind text not null check (source_kind in ('gelbooru', 'favorites', 'album', 'saved-search')),
	source_album_id text,
	query text not null,
	rating text not null,
	media text not null,
	sort text not null,
	random_seed integer not null,
	excluded_ids text not null,
	page_cursor integer not null,
	added_count integer not null,
	total integer,
	state text not null check (state in ('queued', 'leased', 'paused', 'cancelled', 'succeeded', 'failed')),
	error text,
	lease_until integer,
	created_at integer not null,
	updated_at integer not null,
	check (
		(destination_kind = 'favorite' and destination_album_id is null)
		or (destination_kind = 'album' and destination_album_id is not null)
	),
	check (
		(source_kind = 'album' and source_album_id is not null)
		or (source_kind != 'album' and source_album_id is null)
	)
);
create index collection_imports_state on collection_imports (state, created_at, id);
`;

const coverAutoMigration = `
alter table albums add column cover_auto_stopped integer not null default 0;
alter table saved_searches add column cover_auto_stopped integer not null default 0;
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

const tagCountMigration = `
alter table source_tags add column count integer not null default 0;
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
	const collections = sqlite
		.prepare('select version from schema_migrations where version = 6')
		.get();
	if (!collections) {
		sqlite.transaction(() => {
			sqlite.exec(collectionMigration);
			sqlite
				.prepare('insert into schema_migrations (version, applied_at, checksum) values (6, ?, ?)')
				.run(Date.now(), 'collections-v6');
		})();
	}
	const collectionImports = sqlite
		.prepare('select version from schema_migrations where version = 7')
		.get();
	if (!collectionImports) {
		sqlite.transaction(() => {
			sqlite.exec(collectionImportMigration);
			sqlite
				.prepare('insert into schema_migrations (version, applied_at, checksum) values (7, ?, ?)')
				.run(Date.now(), 'collection-imports-v7');
		})();
	}
	const coverAuto = sqlite.prepare('select version from schema_migrations where version = 8').get();
	if (!coverAuto) {
		sqlite.transaction(() => {
			sqlite.exec(coverAutoMigration);
			sqlite
				.prepare('insert into schema_migrations (version, applied_at, checksum) values (8, ?, ?)')
				.run(Date.now(), 'cover-auto-v8');
		})();
	}
	const tagCount = sqlite.prepare('select version from schema_migrations where version = 9').get();
	if (!tagCount) {
		sqlite.transaction(() => {
			sqlite.exec(tagCountMigration);
			sqlite
				.prepare('insert into schema_migrations (version, applied_at, checksum) values (9, ?, ?)')
				.run(Date.now(), 'source-tags-count-v9');
		})();
	}
	const newest = sqlite.prepare('select max(version) as version from schema_migrations').get() as {
		version: number | null;
	};
	if ((newest.version ?? 0) > SCHEMA_VERSION) {
		const version = newest.version;
		sqlite.close();
		throw new Error(`schema version ${version} is newer than this build`);
	}
	return drizzle(sqlite, { schema });
}

export type AppDatabase = ReturnType<typeof openDatabase>;
