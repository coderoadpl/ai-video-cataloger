import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const folders = sqliteTable('folders', {
  folderId: text('folder_id').primaryKey(),
  currentPath: text('current_path').notNull(),
  displayName: text('display_name').notNull(),
  firstSeenAt: text('first_seen_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
});

export const files = sqliteTable('files', {
  fingerprint: text('fingerprint').primaryKey(),
  folderId: text('folder_id').notNull(),
  fileName: text('file_name').notNull(),
  size: integer('size').notNull(),
  durationS: real('duration_s'),
  processedAt: text('processed_at').notNull(),
  analyzer: text('analyzer'),
  model: text('model'),
});

export const analyses = sqliteTable('analyses', {
  fingerprint: text('fingerprint').primaryKey(),
  finalName: text('final_name'),
  description: text('description'),
  transcript: text('transcript'),
  language: text('language'),
});

export const schemaMeta = sqliteTable('schema_meta', {
  version: integer('version').primaryKey(),
});

export const globalCatalogSchema = { folders, files, analyses, schemaMeta };

export const createGlobalCatalogSchemaSqlV1 = [
  `CREATE TABLE IF NOT EXISTS folders (
      folder_id TEXT PRIMARY KEY,
      current_path TEXT NOT NULL,
      display_name TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    )`,
  `CREATE TABLE IF NOT EXISTS files (
      fingerprint TEXT PRIMARY KEY,
      folder_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      size INTEGER NOT NULL,
      duration_s REAL,
      processed_at TEXT NOT NULL,
      analyzer TEXT,
      model TEXT
    )`,
  `CREATE TABLE IF NOT EXISTS analyses (
      fingerprint TEXT PRIMARY KEY,
      final_name TEXT,
      description TEXT,
      transcript TEXT,
      language TEXT
    )`,
  `CREATE TABLE IF NOT EXISTS schema_meta (
      version INTEGER PRIMARY KEY
    )`,
] as const;
