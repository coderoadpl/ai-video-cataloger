import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { VIDEO_STATUSES } from '@core/domain/index.js';

export const videos = sqliteTable('videos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  originalPath: text('original_path').notNull().unique(),
  originalName: text('original_name').notNull(),
  newName: text('new_name'),
  fileHash: text('file_hash').notNull(),
  status: text('status', { enum: VIDEO_STATUSES }).notNull().default('pending'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  errorMessage: text('error_message'),
});

export const config = sqliteTable('config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const schema = { videos, config };

export const createCatalogSchemaSql = `
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
  `;

export const createConfigSchemaSql = `
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `;
