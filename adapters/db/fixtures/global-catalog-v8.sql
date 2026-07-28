CREATE TABLE folders (
  folder_id TEXT PRIMARY KEY,
  current_path TEXT NOT NULL,
  display_name TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE TABLE files (
  fingerprint TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  duration_s REAL,
  processed_at TEXT NOT NULL,
  analyzer TEXT,
  model TEXT,
  gps_lat REAL,
  gps_lon REAL,
  missing_at INTEGER
);
CREATE TABLE analyses (
  fingerprint TEXT PRIMARY KEY,
  final_name TEXT,
  description TEXT,
  transcript TEXT,
  language TEXT
);
CREATE TABLE schema_meta (version INTEGER PRIMARY KEY);
CREATE TABLE tags (
  tag_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE file_tags (
  fingerprint TEXT NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (fingerprint, tag_id),
  FOREIGN KEY (fingerprint) REFERENCES files(fingerprint) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(tag_id) ON DELETE CASCADE
);
CREATE TABLE tag_aliases (
  alias TEXT PRIMARY KEY,
  tag_id INTEGER NOT NULL,
  FOREIGN KEY (tag_id) REFERENCES tags(tag_id) ON DELETE CASCADE
);
CREATE TABLE drive_runs (
  run_id TEXT PRIMARY KEY,
  root TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  folders_total INTEGER NOT NULL,
  folders_done INTEGER NOT NULL,
  files_done INTEGER NOT NULL,
  files_skipped INTEGER NOT NULL,
  files_failed INTEGER NOT NULL,
  last_activity_at TEXT NOT NULL,
  batch_json TEXT
);
CREATE TABLE search_documents (
  docid INTEGER PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  final_name TEXT NOT NULL,
  description TEXT NOT NULL,
  transcript TEXT NOT NULL,
  tags_text TEXT NOT NULL
);
CREATE VIRTUAL TABLE search_documents_fts USING fts4(
  content="search_documents",
  file_name,
  final_name,
  description,
  transcript,
  tags_text,
  tokenize=unicode61
);
CREATE TABLE people (
  person_id TEXT PRIMARY KEY,
  display_name TEXT,
  kind TEXT NOT NULL DEFAULT 'face',
  created_at TEXT NOT NULL,
  centroid BLOB,
  exemplar_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE face_observations (
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
);
CREATE TABLE face_index_state (
  fingerprint TEXT PRIMARY KEY,
  completed_at TEXT NOT NULL,
  engine_version INTEGER NOT NULL,
  FOREIGN KEY (fingerprint) REFERENCES files(fingerprint) ON DELETE CASCADE
);
INSERT INTO schema_meta(version) VALUES (8);
INSERT INTO folders VALUES (
  '88888888-8888-4888-8888-888888888888',
  '/fixture/v8',
  'v8 fixture',
  '2025-12-01T00:00:00.000Z',
  '2026-01-02T03:04:05.000Z'
);
INSERT INTO files VALUES (
  'fixture-v8-analysis',
  '88888888-8888-4888-8888-888888888888',
  'source clip.mp4',
  424242,
  61.25,
  '2026-01-02T03:04:05.678Z',
  'harness:claude-code',
  'claude-sonnet-4',
  52.2297,
  21.0122,
  NULL
);
INSERT INTO files VALUES (
  'fixture-v8-unprocessed',
  '88888888-8888-4888-8888-888888888888',
  'unprocessed.mov',
  7,
  NULL,
  '2026-01-01T00:00:00.000Z',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL
);
INSERT INTO analyses VALUES (
  'fixture-v8-analysis',
  '2026-01-02-night-sky.mp4',
  'A blue-hour skyline — preserved byte for byte.',
  'First line.\nSecond line with “quotes”.',
  'en'
);
INSERT INTO tags(name) VALUES ('night-sky');
INSERT INTO tags(name) VALUES ('warsaw');
INSERT INTO file_tags VALUES ('fixture-v8-analysis', 1);
INSERT INTO file_tags VALUES ('fixture-v8-analysis', 2);
INSERT INTO search_documents (
  docid, fingerprint, file_name, final_name, description, transcript, tags_text
) VALUES (
  1,
  'fixture-v8-analysis',
  'source clip.mp4',
  '2026-01-02-night-sky.mp4',
  'A blue-hour skyline — preserved byte for byte.',
  'First line.\nSecond line with “quotes”.',
  'night-sky\nwarsaw'
);
INSERT INTO search_documents_fts (
  docid, file_name, final_name, description, transcript, tags_text
) VALUES (
  1,
  'source clip.mp4',
  '2026-01-02-night-sky.mp4',
  'A blue-hour skyline — preserved byte for byte.',
  'First line.\nSecond line with “quotes”.',
  'night-sky\nwarsaw'
);
