import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
  gpsLat: real('gps_lat'),
  gpsLon: real('gps_lon'),
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

export const tags = sqliteTable('tags', {
  tagId: integer('tag_id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
});

export const fileTags = sqliteTable('file_tags', {
  fingerprint: text('fingerprint').notNull(),
  tagId: integer('tag_id').notNull(),
}, (table) => [
  primaryKey({ columns: [table.fingerprint, table.tagId] }),
]);

export const tagAliases = sqliteTable('tag_aliases', {
  alias: text('alias').primaryKey(),
  tagId: integer('tag_id').notNull(),
});

export const driveRuns = sqliteTable('drive_runs', {
  runId: text('run_id').primaryKey(),
  root: text('root').notNull(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  foldersTotal: integer('folders_total').notNull(),
  foldersDone: integer('folders_done').notNull(),
  filesDone: integer('files_done').notNull(),
  filesSkipped: integer('files_skipped').notNull(),
  filesFailed: integer('files_failed').notNull(),
  lastActivityAt: text('last_activity_at').notNull(),
});

export const globalCatalogSchema = { folders, files, analyses, schemaMeta, tags, fileTags, tagAliases, driveRuns };

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

export const migrateGlobalCatalogSchemaSqlV2 = [
  'ALTER TABLE files ADD COLUMN gps_lat REAL',
  'ALTER TABLE files ADD COLUMN gps_lon REAL',
  `CREATE TABLE IF NOT EXISTS tags (
      tag_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    )`,
  `CREATE TABLE IF NOT EXISTS file_tags (
      fingerprint TEXT NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (fingerprint, tag_id),
      FOREIGN KEY (fingerprint) REFERENCES files(fingerprint) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(tag_id) ON DELETE CASCADE
    )`,
  `CREATE TABLE IF NOT EXISTS tag_aliases (
      alias TEXT PRIMARY KEY,
      tag_id INTEGER NOT NULL,
      FOREIGN KEY (tag_id) REFERENCES tags(tag_id) ON DELETE CASCADE
    )`,
] as const;

export const migrateGlobalCatalogSchemaSqlV3 = [
  `CREATE TABLE IF NOT EXISTS drive_runs (
      run_id TEXT PRIMARY KEY,
      root TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      folders_total INTEGER NOT NULL,
      folders_done INTEGER NOT NULL,
      files_done INTEGER NOT NULL,
      files_skipped INTEGER NOT NULL,
      files_failed INTEGER NOT NULL,
      last_activity_at TEXT NOT NULL
    )`,
] as const;
