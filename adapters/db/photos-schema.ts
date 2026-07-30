import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const photoFolders = sqliteTable('photo_folders', {
  folderId: text('folder_id').primaryKey(),
  currentPath: text('current_path').notNull(),
  displayName: text('display_name').notNull(),
  firstSeenAt: text('first_seen_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
  defaultConfigId: text('default_config_id'),
});

export const photos = sqliteTable('photos', {
  fingerprint: text('fingerprint').primaryKey(),
  folderId: text('folder_id').notNull(),
  fileName: text('file_name').notNull(),
  currentPath: text('current_path').notNull(),
  ext: text('ext').notNull(),
  size: integer('size').notNull(),
  width: integer('width'),
  height: integer('height'),
  orientation: integer('orientation'),
  cameraMake: text('camera_make'),
  cameraModel: text('camera_model'),
  lens: text('lens'),
  iso: integer('iso'),
  fNumber: real('f_number'),
  exposureTime: real('exposure_time'),
  exifRating: integer('exif_rating'),
  capturedAt: text('captured_at'),
  capturedAtSource: text('captured_at_source'),
  gpsLat: real('gps_lat'),
  gpsLon: real('gps_lon'),
  gpsSource: text('gps_source'),
  gpsAccuracyM: real('gps_accuracy_m'),
  gpsIntervalKind: text('gps_interval_kind'),
  gpsResolvedAt: text('gps_resolved_at'),
  placeName: text('place_name'),
  placeRegion: text('place_region'),
  placeCountry: text('place_country'),
  placeCountryCode: text('place_country_code'),
  placeDistanceM: real('place_distance_m'),
  placeDataset: text('place_dataset'),
  discoveredAt: text('discovered_at').notNull(),
  exifReadAt: text('exif_read_at'),
  proxyState: text('proxy_state').notNull().default('pending'),
  proxyWidth: integer('proxy_width'),
  proxyHeight: integer('proxy_height'),
  thumbState: text('thumb_state').notNull().default('pending'),
  missingAt: integer('missing_at'),
  selectedConfigId: text('selected_config_id'),
});

export const photoPaths = sqliteTable('photo_paths', {
  fingerprint: text('fingerprint').notNull(),
  currentPath: text('current_path').notNull(),
  folderId: text('folder_id').notNull(),
  size: integer('size').notNull(),
  mtimeMs: real('mtime_ms').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.fingerprint, table.currentPath] }),
]);

export const photoRuns = sqliteTable('photo_runs', {
  runId: text('run_id').primaryKey(),
  root: text('root').notNull(),
  stage: text('stage').notNull(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  filesTotal: integer('files_total').notNull(),
  filesDone: integer('files_done').notNull(),
  filesSkipped: integer('files_skipped').notNull(),
  filesFailed: integer('files_failed').notNull(),
  lastActivityAt: text('last_activity_at').notNull(),
  batchJson: text('batch_json'),
});

export const photosSchemaMeta = sqliteTable('schema_meta', {
  version: integer('version').primaryKey(),
});

export const photoAnalysisConfigs = sqliteTable('photo_analysis_configs', {
  configId: text('config_id').primaryKey(),
  descriptorJson: text('descriptor_json'),
  label: text('label').notNull(),
  firstSeenAt: text('first_seen_at').notNull(),
  lastUsedAt: text('last_used_at').notNull(),
});

export const photoAnalyses = sqliteTable('photo_analyses', {
  fingerprint: text('fingerprint').notNull(),
  configId: text('config_id').notNull(),
  description: text('description'),
  scene: text('scene'),
  quality: text('quality'),
  language: text('language'),
  analyzer: text('analyzer'),
  model: text('model'),
  batchSize: integer('batch_size'),
  createdAt: text('created_at').notNull(),
  usageJson: text('usage_json'),
}, (table) => [
  primaryKey({ columns: [table.fingerprint, table.configId] }),
]);

export const photoTags = sqliteTable('photo_tags', {
  tagId: integer('tag_id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
});

export const photoTagAliases = sqliteTable('photo_tag_aliases', {
  alias: text('alias').primaryKey(),
  tagId: integer('tag_id').notNull(),
});

export const photoFileTags = sqliteTable('photo_file_tags', {
  fingerprint: text('fingerprint').notNull(),
  configId: text('config_id').notNull(),
  tagId: integer('tag_id').notNull(),
}, (table) => [
  primaryKey({ columns: [table.fingerprint, table.configId, table.tagId] }),
]);

export const photoSearchDocuments = sqliteTable('photo_search_documents', {
  docid: integer('docid').primaryKey({ autoIncrement: true }),
  fingerprint: text('fingerprint').notNull().unique(),
  fileName: text('file_name').notNull(),
  description: text('description').notNull(),
  tagsText: text('tags_text').notNull(),
  place: text('place').notNull().default(''),
});

export const photoFaceIndexState = sqliteTable('photo_face_index_state', {
  fingerprint: text('fingerprint').primaryKey(),
  completedAt: text('completed_at').notNull(),
  engineVersion: integer('engine_version').notNull(),
});

export const photosSchema = {
  photoFolders,
  photos,
  photoPaths,
  photoRuns,
  photoAnalysisConfigs,
  photoAnalyses,
  photoTags,
  photoTagAliases,
  photoFileTags,
  photoSearchDocuments,
  photoFaceIndexState,
  photosSchemaMeta,
};

export const PHOTOS_SCHEMA_VERSION = 2;

export const createPhotosSchemaSqlV1 = [
  'CREATE TABLE schema_meta (version INTEGER PRIMARY KEY)',
  `CREATE TABLE photo_folders (
      folder_id     TEXT PRIMARY KEY,
      current_path  TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at  TEXT NOT NULL,
      default_config_id TEXT
    )`,
  `CREATE TABLE photos (
      fingerprint   TEXT PRIMARY KEY,
      folder_id     TEXT NOT NULL,
      file_name     TEXT NOT NULL,
      current_path  TEXT NOT NULL,
      ext           TEXT NOT NULL,
      size          INTEGER NOT NULL,
      width         INTEGER, height INTEGER, orientation INTEGER,
      camera_make   TEXT, camera_model TEXT, lens TEXT,
      iso           INTEGER, f_number REAL, exposure_time REAL,
      exif_rating   INTEGER,
      captured_at   TEXT,
      captured_at_source TEXT,
      gps_lat REAL, gps_lon REAL,
      gps_source TEXT, gps_accuracy_m REAL, gps_interval_kind TEXT, gps_resolved_at TEXT,
      place_name TEXT, place_region TEXT, place_country TEXT,
      place_country_code TEXT, place_distance_m REAL, place_dataset TEXT,
      discovered_at TEXT NOT NULL,
      exif_read_at  TEXT,
      proxy_state   TEXT NOT NULL DEFAULT 'pending',
      proxy_width   INTEGER, proxy_height INTEGER,
      thumb_state   TEXT NOT NULL DEFAULT 'pending',
      missing_at    INTEGER,
      selected_config_id TEXT
    )`,
  'CREATE INDEX idx_photos_folder      ON photos(folder_id)',
  'CREATE INDEX idx_photos_captured_at ON photos(captured_at)',
  'CREATE INDEX idx_photos_proxy_state ON photos(proxy_state)',
  `CREATE TABLE photo_paths (
      fingerprint  TEXT NOT NULL,
      current_path TEXT NOT NULL,
      folder_id    TEXT NOT NULL,
      size         INTEGER NOT NULL,
      mtime_ms     REAL NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (fingerprint, current_path)
    )`,
  'CREATE INDEX idx_photo_paths_folder ON photo_paths(folder_id)',
  'CREATE INDEX idx_photo_paths_path   ON photo_paths(current_path)',
  `CREATE TABLE photo_analysis_configs (
      config_id TEXT PRIMARY KEY, descriptor_json TEXT, label TEXT NOT NULL,
      first_seen_at TEXT NOT NULL, last_used_at TEXT NOT NULL
    )`,
  `CREATE TABLE photo_analyses (
      fingerprint TEXT NOT NULL, config_id TEXT NOT NULL,
      description TEXT, scene TEXT, quality TEXT,
      language TEXT, analyzer TEXT, model TEXT,
      batch_size INTEGER,
      created_at TEXT NOT NULL, usage_json TEXT,
      PRIMARY KEY (fingerprint, config_id)
    )`,
  'CREATE INDEX idx_photo_analyses_config ON photo_analyses(config_id)',
  'CREATE TABLE photo_tags (tag_id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE)',
  'CREATE TABLE photo_tag_aliases (alias TEXT PRIMARY KEY, tag_id INTEGER NOT NULL)',
  `CREATE TABLE photo_file_tags (
      fingerprint TEXT NOT NULL, config_id TEXT NOT NULL, tag_id INTEGER NOT NULL,
      PRIMARY KEY (fingerprint, config_id, tag_id)
    )`,
  `CREATE TABLE photo_search_documents (
      docid INTEGER PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE,
      file_name TEXT NOT NULL, description TEXT NOT NULL,
      tags_text TEXT NOT NULL, place TEXT NOT NULL DEFAULT ''
    )`,
  `CREATE VIRTUAL TABLE photo_search_documents_fts USING fts4(
      content="photo_search_documents",
      file_name, description, tags_text, place, tokenize=unicode61)`,
  `CREATE TABLE photo_runs (
      run_id TEXT PRIMARY KEY, root TEXT NOT NULL, stage TEXT NOT NULL,
      started_at TEXT NOT NULL, finished_at TEXT,
      files_total INTEGER NOT NULL, files_done INTEGER NOT NULL,
      files_skipped INTEGER NOT NULL, files_failed INTEGER NOT NULL,
      last_activity_at TEXT NOT NULL, batch_json TEXT
    )`,
  `CREATE TABLE photo_face_index_state (
      fingerprint TEXT PRIMARY KEY,
      completed_at TEXT NOT NULL, engine_version INTEGER NOT NULL
    )`,
  'CREATE INDEX idx_photo_face_index_engine ON photo_face_index_state(engine_version)',
] as const;

export const createPhotosSchemaSqlV2 = [
  'CREATE INDEX idx_photos_current_path ON photos(current_path)',
  'CREATE INDEX idx_photos_proxy_state_path ON photos(proxy_state, current_path)',
  'DROP INDEX IF EXISTS idx_photos_proxy_state',
] as const;
