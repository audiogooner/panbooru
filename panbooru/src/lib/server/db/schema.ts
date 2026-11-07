import { blob, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const owner = sqliteTable('owner', {
	singleton: integer('singleton').primaryKey(),
	passwordHash: text('password_hash').notNull(),
	authVersion: integer('auth_version').notNull(),
	createdAt: integer('created_at').notNull(),
	updatedAt: integer('updated_at').notNull()
});

export const sourceCredentials = sqliteTable('source_credentials', {
	source: text('source').primaryKey(),
	ciphertext: blob('ciphertext', { mode: 'buffer' }).notNull(),
	nonce: blob('nonce', { mode: 'buffer' }).notNull(),
	authTag: blob('auth_tag', { mode: 'buffer' }).notNull(),
	keyVersion: integer('key_version').notNull(),
	userId: text('user_id').notNull(),
	validated: integer('validated').notNull()
});

export const sessions = sqliteTable('sessions', {
	tokenHash: text('token_hash').primaryKey(),
	absoluteExpiresAt: integer('absolute_expires_at').notNull(),
	idleExpiresAt: integer('idle_expires_at').notNull(),
	revoked: integer('revoked').notNull()
});

export const mediaObjects = sqliteTable('media_objects', {
	id: text('id').primaryKey(),
	contentHash: text('content_hash').unique(),
	relativePath: text('relative_path'),
	mime: text('mime'),
	byteSize: integer('byte_size'),
	verifiedAt: integer('verified_at'),
	state: text('state').notNull()
});

export const savedItems = sqliteTable('saved_items', {
	id: text('id').primaryKey(),
	metadataHash: text('metadata_hash').notNull().unique(),
	hashVersion: integer('hash_version').notNull(),
	savedAt: integer('saved_at').notNull(),
	snapshotId: text('snapshot_id').notNull(),
	source: text('source').notNull(),
	remoteId: text('remote_id').notNull(),
	mediaId: text('media_id'),
	retentionState: text('retention_state').notNull()
});

export const postSnapshots = sqliteTable('post_snapshots', {
	id: text('id').primaryKey(),
	itemId: text('item_id').notNull(),
	snapshot: text('snapshot').notNull(),
	source: text('source').notNull(),
	remoteId: text('remote_id').notNull(),
	fetchedAt: integer('fetched_at').notNull()
});

export const favorites = sqliteTable('favorites', {
	itemId: text('item_id').primaryKey(),
	favoritedAt: integer('favorited_at').notNull()
});

export const albums = sqliteTable('albums', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	createdAt: integer('created_at').notNull()
});

export const albumItems = sqliteTable('album_items', {
	albumId: text('album_id').notNull(),
	itemId: text('item_id').notNull(),
	addedAt: integer('added_at').notNull()
});

export const removalActions = sqliteTable('removal_actions', {
	id: text('id').primaryKey(),
	removedAt: integer('removed_at').notNull(),
	expiresAt: integer('expires_at').notNull()
});

export const removalMemberships = sqliteTable('removal_memberships', {
	actionId: text('action_id').notNull(),
	itemId: text('item_id').notNull(),
	kind: text('kind').notNull(),
	albumId: text('album_id'),
	addedAt: integer('added_at').notNull()
});

export const sourceTags = sqliteTable(
	'source_tags',
	{
		source: text('source').notNull(),
		name: text('name').notNull(),
		category: text('category').notNull(),
		fetchedAt: integer('fetched_at').notNull()
	},
	(table) => [primaryKey({ columns: [table.source, table.name] })]
);

export const jobs = sqliteTable('jobs', {
	id: text('id').primaryKey(),
	kind: text('kind').notNull(),
	itemId: text('item_id').notNull(),
	dedupKey: text('dedup_key').notNull().unique(),
	state: text('state').notNull(),
	attempts: integer('attempts').notNull(),
	nextAttemptAt: integer('next_attempt_at'),
	leaseUntil: integer('lease_until'),
	progress: integer('progress').notNull(),
	error: text('error'),
	fileUrl: text('file_url').notNull(),
	expectedHash: text('expected_hash')
});
