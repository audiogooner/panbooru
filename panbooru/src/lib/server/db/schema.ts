import { blob, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
