import { blob, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
  missingAt: integer('missing_at'),
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
  batchJson: text('batch_json'),
});

export const people = sqliteTable('people', {
  personId: text('person_id').primaryKey(),
  displayName: text('display_name'),
  kind: text('kind').notNull().default('face'),
  createdAt: text('created_at').notNull(),
  centroid: blob('centroid'),
  exemplarCount: integer('exemplar_count').notNull().default(0),
});

export const faceObservations = sqliteTable('face_observations', {
  obsId: text('obs_id').primaryKey(),
  fingerprint: text('fingerprint').notNull(),
  kind: text('kind').notNull().default('face'),
  frameTsS: real('frame_ts_s'),
  bboxJson: text('bbox_json'),
  embedding: blob('embedding'),
  quality: real('quality'),
  personId: text('person_id'),
  cropPath: text('crop_path'),
});

export const faceIndexState = sqliteTable('face_index_state', {
  fingerprint: text('fingerprint').primaryKey(),
  completedAt: text('completed_at').notNull(),
  engineVersion: integer('engine_version').notNull(),
});

export const globalCatalogSchema = {
  folders,
  files,
  analyses,
  schemaMeta,
  tags,
  fileTags,
  tagAliases,
  driveRuns,
  people,
  faceObservations,
  faceIndexState,
};

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

export const migrateGlobalCatalogSchemaSqlV4 = [
  `CREATE TABLE IF NOT EXISTS search_documents (
      docid INTEGER PRIMARY KEY,
      fingerprint TEXT NOT NULL UNIQUE,
      file_name TEXT NOT NULL,
      final_name TEXT NOT NULL,
      description TEXT NOT NULL,
      transcript TEXT NOT NULL,
      tags_text TEXT NOT NULL
    )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS search_documents_fts USING fts4(
      content="search_documents",
      file_name,
      final_name,
      description,
      transcript,
      tags_text,
      tokenize=unicode61
    )`,
] as const;

export const migrateGlobalCatalogSchemaSqlV5 = [
  `CREATE TABLE IF NOT EXISTS people (
      person_id TEXT PRIMARY KEY,
      display_name TEXT,
      kind TEXT NOT NULL DEFAULT 'face',
      created_at TEXT NOT NULL,
      centroid BLOB,
      exemplar_count INTEGER NOT NULL DEFAULT 0
    )`,
  `CREATE TABLE IF NOT EXISTS face_observations (
      obs_id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'face',
      frame_ts_s REAL,
      bbox_json TEXT,
      embedding BLOB,
      quality REAL,
      person_id TEXT,
      crop_path TEXT,
      FOREIGN KEY (fingerprint) REFERENCES files(fingerprint) ON DELETE CASCADE,
      FOREIGN KEY (person_id) REFERENCES people(person_id) ON DELETE SET NULL
    )`,
] as const;

export const migrateGlobalCatalogSchemaSqlV6 = [
  `CREATE TABLE IF NOT EXISTS face_index_state (
      fingerprint TEXT PRIMARY KEY,
      completed_at TEXT NOT NULL,
      engine_version INTEGER NOT NULL,
      FOREIGN KEY (fingerprint) REFERENCES files(fingerprint) ON DELETE CASCADE
    )`,
  `INSERT OR IGNORE INTO face_index_state (fingerprint, completed_at, engine_version)
      SELECT DISTINCT fingerprint, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1 FROM face_observations`,
] as const;

export const migrateGlobalCatalogSchemaSqlV7 = [
  'ALTER TABLE files ADD COLUMN missing_at INTEGER',
] as const;

export const migrateGlobalCatalogSchemaSqlV8 = [
  'ALTER TABLE drive_runs ADD COLUMN batch_json TEXT',
] as const;
