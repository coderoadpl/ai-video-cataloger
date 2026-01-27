/**
 * Database service for AI Video Cataloger
 * Uses sql.js for SQLite database operations
 */

import initSqlJs, { Database } from 'sql.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VideoRecord, VideoStatus } from '../types/index.js';

const DB_DIR_NAME = '.ai-video-cataloger';
const DB_FILE_NAME = 'catalog.db';

let db: Database | null = null;
let dbPath: string | null = null;

/**
 * Initialize the database in the specified working directory
 * Creates the .ai-video-cataloger/ directory if it doesn't exist
 */
export async function initDatabase(workingDir: string = process.cwd()): Promise<void> {
  const dbDir = join(workingDir, DB_DIR_NAME);
  dbPath = join(dbDir, DB_FILE_NAME);

  // Create .ai-video-cataloger/ directory if it doesn't exist
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  // Initialize sql.js
  const SQL = await initSqlJs();

  // Load existing database or create new one
  if (existsSync(dbPath)) {
    const fileBuffer = readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables if they don't exist
  createTables();

  // Save database to ensure file exists
  saveDatabase();
}

/**
 * Create the required database tables
 */
function createTables(): void {
  if (!db) {
    throw new Error('Database not initialized');
  }

  // Create videos table
  db.run(`
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_path TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL,
      new_name TEXT,
      file_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      error_message TEXT
    )
  `);

  // Create config table
  db.run(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}

/**
 * Save the database to disk
 */
export function saveDatabase(): void {
  if (!db || !dbPath) {
    throw new Error('Database not initialized');
  }

  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(dbPath, buffer);
}

/**
 * Close the database connection and save
 */
export function closeDatabase(): void {
  if (db) {
    saveDatabase();
    db.close();
    db = null;
    dbPath = null;
  }
}

/**
 * Get a video record by its original path
 */
export function getVideoByPath(originalPath: string): VideoRecord | null {
  if (!db) {
    throw new Error('Database not initialized');
  }

  const result = db.exec(
    'SELECT * FROM videos WHERE original_path = ?',
    [originalPath]
  );

  if (result.length === 0 || result[0].values.length === 0) {
    return null;
  }

  const columns = result[0].columns;
  const values = result[0].values[0];
  return rowToVideoRecord(columns, values);
}

/**
 * Get all video records
 */
export function getAllVideos(): VideoRecord[] {
  if (!db) {
    throw new Error('Database not initialized');
  }

  const result = db.exec('SELECT * FROM videos');

  if (result.length === 0) {
    return [];
  }

  const columns = result[0].columns;
  return result[0].values.map(values => rowToVideoRecord(columns, values));
}

/**
 * Get videos by status
 */
export function getVideosByStatus(status: VideoStatus): VideoRecord[] {
  if (!db) {
    throw new Error('Database not initialized');
  }

  const result = db.exec(
    'SELECT * FROM videos WHERE status = ?',
    [status]
  );

  if (result.length === 0) {
    return [];
  }

  const columns = result[0].columns;
  return result[0].values.map(values => rowToVideoRecord(columns, values));
}

/**
 * Get videos that are not in completed or error status
 */
export function getIncompleteVideos(): VideoRecord[] {
  if (!db) {
    throw new Error('Database not initialized');
  }

  const result = db.exec(
    "SELECT * FROM videos WHERE status NOT IN ('completed', 'error')"
  );

  if (result.length === 0) {
    return [];
  }

  const columns = result[0].columns;
  return result[0].values.map(values => rowToVideoRecord(columns, values));
}

/**
 * Insert a new video record
 */
export function insertVideo(
  originalPath: string,
  originalName: string,
  fileHash: string
): VideoRecord {
  if (!db) {
    throw new Error('Database not initialized');
  }

  db.run(
    `INSERT INTO videos (original_path, original_name, file_hash, status)
     VALUES (?, ?, ?, 'pending')`,
    [originalPath, originalName, fileHash]
  );

  saveDatabase();

  const record = getVideoByPath(originalPath);
  if (!record) {
    throw new Error('Failed to insert video record');
  }
  return record;
}

/**
 * Update video status
 */
export function updateVideoStatus(
  id: number,
  status: VideoStatus,
  errorMessage?: string
): void {
  if (!db) {
    throw new Error('Database not initialized');
  }

  if (errorMessage !== undefined) {
    db.run(
      `UPDATE videos SET status = ?, error_message = ?, updated_at = datetime('now') WHERE id = ?`,
      [status, errorMessage, id]
    );
  } else {
    db.run(
      `UPDATE videos SET status = ?, updated_at = datetime('now') WHERE id = ?`,
      [status, id]
    );
  }

  saveDatabase();
}

/**
 * Update video new name
 */
export function updateVideoNewName(id: number, newName: string): void {
  if (!db) {
    throw new Error('Database not initialized');
  }

  db.run(
    `UPDATE videos SET new_name = ?, updated_at = datetime('now') WHERE id = ?`,
    [newName, id]
  );

  saveDatabase();
}

/**
 * Get a config value
 */
export function getConfig(key: string): string | null {
  if (!db) {
    throw new Error('Database not initialized');
  }

  const result = db.exec(
    'SELECT value FROM config WHERE key = ?',
    [key]
  );

  if (result.length === 0 || result[0].values.length === 0) {
    return null;
  }

  return result[0].values[0][0] as string;
}

/**
 * Set a config value
 */
export function setConfig(key: string, value: string): void {
  if (!db) {
    throw new Error('Database not initialized');
  }

  db.run(
    `INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)`,
    [key, value]
  );

  saveDatabase();
}

/**
 * Convert a database row to a VideoRecord
 */
function rowToVideoRecord(
  columns: string[],
  values: (string | number | Uint8Array | null)[]
): VideoRecord {
  const record: Record<string, unknown> = {};
  columns.forEach((col, index) => {
    record[col] = values[index];
  });
  return record as unknown as VideoRecord;
}

/**
 * Get the database directory path
 */
export function getDatabaseDir(workingDir: string = process.cwd()): string {
  return join(workingDir, DB_DIR_NAME);
}
