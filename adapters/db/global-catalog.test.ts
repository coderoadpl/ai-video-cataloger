import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { afterEach, describe, expect, it } from 'vitest';

import type { CatalogFile, CatalogFolder } from '@core/domain/index.js';

import { SqlJsGlobalCatalogStore } from './global-catalog.js';
import {
  createGlobalCatalogSchemaSqlV1,
  migrateGlobalCatalogSchemaSqlV2,
  migrateGlobalCatalogSchemaSqlV3,
} from './global-catalog-schema.js';

const tempRoots: string[] = [];

const tempHome = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'avc-global-'));
  tempRoots.push(root);
  return root;
};

const folder: CatalogFolder = {
  folderId: '22222222-2222-4222-8222-222222222222',
  currentPath: '/media/drive-a',
  displayName: 'drive-a',
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-02T00:00:00.000Z',
};

const file: CatalogFile = {
  fingerprint: 'fp-abc',
  folderId: folder.folderId,
  fileName: 'clip.mp4',
  size: 1024,
  durationS: 30.5,
  gpsLat: null,
  gpsLon: null,
  processedAt: '2026-01-03T00:00:00.000Z',
  analyzer: 'openai',
  model: 'gpt-4.1-mini',
};

describe('SqlJsGlobalCatalogStore', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('migrates a fresh database and persists upserts across reopen', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    expect(store.databasePath()).toBe(path.join(home, '.ai-video-cataloger', 'catalog.db'));

    expect((await store.upsertFolder(folder)).ok).toBe(true);
    expect((await store.upsertFile(file)).ok).toBe(true);
    expect((await store.upsertAnalysis({
      fingerprint: file.fingerprint,
      finalName: 'a-clip.mp4',
      description: 'A clip',
      transcript: 'words',
      language: 'en',
      tags: ['a-clip'],
    })).ok).toBe(true);

    const reopened = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const counts = await reopened.counts();
    expect(counts.ok && counts.value).toEqual({ folders: 1, files: 1, analyses: 1 });

    const records = await reopened.listFolderRecords(folder.folderId);
    expect(records.ok && records.value.length).toBe(1);
    if (records.ok) {
      expect(records.value[0]?.file.durationS).toBe(30.5);
      expect(records.value[0]?.analysis?.language).toBe('en');
    }

    const search = await reopened.search({ match: 'clip*', rankingTerms: ['clip'], limit: 10, offset: 0 });
    expect(search.ok && search.value[0]?.fingerprint).toBe(file.fingerprint);
    expect(search.ok && search.value[0]?.tags).toEqual(['a-clip']);
  });

  it('overwrites a row on conflicting fingerprint upsert', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile(file);
    await store.upsertFile({ ...file, fileName: 'renamed.mp4', processedAt: '2026-05-01T00:00:00.000Z' });

    const stored = await store.getFile(file.fingerprint);
    expect(stored.ok && stored.value?.fileName).toBe('renamed.mp4');
    const counts = await store.counts();
    expect(counts.ok && counts.value.files).toBe(1);

    const search = await store.search({ match: 'renamed*', rankingTerms: ['renamed'], limit: 10, offset: 0 });
    expect(search.ok && search.value.map((row) => row.fileName)).toEqual(['renamed.mp4']);
  });

  it('migrates an existing v1 database to v4 and persists the migrated schema immediately', async () => {
    const home = await tempHome();
    await writeV1Catalog(home);

    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const counts = await store.counts();
    expect(counts.ok && counts.value).toEqual({ folders: 0, files: 0, analyses: 0 });

    const SQL = await initSqlJs();
    const reopened = new SQL.Database(await readFile(store.databasePath()));
    const versionResult = reopened.exec('SELECT version FROM schema_meta ORDER BY version DESC LIMIT 1');
    const columnResult = reopened.exec('PRAGMA table_info(files)');
    reopened.close();

    expect(versionResult[0]?.values[0]?.[0]).toBe(4);
    const columnNames = columnResult[0]?.values.map((row) => row[1]).filter((value) => typeof value === 'string') ?? [];
    expect(columnNames).toContain('gps_lat');
    expect(columnNames).toContain('gps_lon');
  });

  it('migrates an existing v2 database to v4 and persists drive run bookkeeping immediately', async () => {
    const home = await tempHome();
    await writeV2Catalog(home);

    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const started = await store.startDriveRun({
      runId: 'run-1',
      root: '/drive',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: null,
      foldersTotal: 2,
      foldersDone: 0,
      filesDone: 0,
      filesSkipped: 0,
      filesFailed: 0,
      lastActivityAt: '2026-01-01T00:00:00.000Z',
    });
    expect(started.ok).toBe(true);
    const updated = await store.updateDriveRun({
      runId: 'run-1',
      root: '/drive',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:10:00.000Z',
      foldersTotal: 2,
      foldersDone: 2,
      filesDone: 3,
      filesSkipped: 1,
      filesFailed: 1,
      lastActivityAt: '2026-01-01T00:10:00.000Z',
    });
    expect(updated.ok).toBe(true);

    const reopened = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const latest = await reopened.latestDriveRun();
    expect(latest.ok && latest.value).toMatchObject({
      runId: 'run-1',
      foldersDone: 2,
      filesDone: 3,
      filesSkipped: 1,
      filesFailed: 1,
    });
  });

  it('migrates an existing v3 database to v4 with a persisted FTS backfill', async () => {
    const home = await tempHome();
    await writeV3Catalog(home);

    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const search = await store.search({ match: 'coast*', rankingTerms: ['coast'], limit: 10, offset: 0 });
    expect(search.ok && search.value[0]?.fingerprint).toBe('fp-v3');

    const reopened = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const persisted = await reopened.search({ match: 'coast*', rankingTerms: ['coast'], limit: 10, offset: 0 });
    expect(persisted.ok && persisted.value[0]?.fileName).toBe('coast.mp4');
  });

  it('keeps FTS current across alias remap and explicit rebuild', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile(file);
    await store.upsertAnalysis({
      fingerprint: file.fingerprint,
      finalName: 'traffic.mp4',
      description: 'Cars passing',
      transcript: '',
      language: null,
      tags: ['automobile'],
    });

    const aliased = await store.aliasTag({ from: 'automobile', to: 'car' });
    const byAlias = await store.search({ match: 'car*', rankingTerms: ['car'], limit: 10, offset: 0 });
    const rebuilt = await store.rebuildSearchIndex();
    const afterRebuild = await store.search({ match: 'car*', rankingTerms: ['car'], limit: 10, offset: 0 });

    expect(aliased.ok && aliased.value.remappedFiles).toBe(1);
    expect(byAlias.ok && byAlias.value[0]?.tags).toEqual(['car']);
    expect(rebuilt.ok && rebuilt.value.indexed).toBe(1);
    expect(afterRebuild.ok && afterRebuild.value[0]?.fingerprint).toBe(file.fingerprint);
  });
});

const writeV1Catalog = async (home: string): Promise<void> => {
  const SQL = await initSqlJs();
  const client = new SQL.Database();
  for (const statement of createGlobalCatalogSchemaSqlV1) client.run(statement);
  client.run('INSERT INTO schema_meta(version) VALUES (1)');
  const databasePath = path.join(home, '.ai-video-cataloger', 'catalog.db');
  await mkdir(path.dirname(databasePath), { recursive: true });
  await writeFile(databasePath, Buffer.from(client.export()));
  client.close();
};

const writeV2Catalog = async (home: string): Promise<void> => {
  const SQL = await initSqlJs();
  const client = new SQL.Database();
  for (const statement of createGlobalCatalogSchemaSqlV1) client.run(statement);
  client.run('ALTER TABLE files ADD COLUMN gps_lat REAL');
  client.run('ALTER TABLE files ADD COLUMN gps_lon REAL');
  client.run(`CREATE TABLE tags (
      tag_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    )`);
  client.run(`CREATE TABLE file_tags (
      fingerprint TEXT NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (fingerprint, tag_id)
    )`);
  client.run(`CREATE TABLE tag_aliases (
      alias TEXT PRIMARY KEY,
      tag_id INTEGER NOT NULL
    )`);
  client.run('INSERT INTO schema_meta(version) VALUES (2)');
  const databasePath = path.join(home, '.ai-video-cataloger', 'catalog.db');
  await mkdir(path.dirname(databasePath), { recursive: true });
  await writeFile(databasePath, Buffer.from(client.export()));
  client.close();
};

const writeV3Catalog = async (home: string): Promise<void> => {
  const SQL = await initSqlJs();
  const client = new SQL.Database();
  for (const statement of createGlobalCatalogSchemaSqlV1) client.run(statement);
  for (const statement of migrateGlobalCatalogSchemaSqlV2) client.run(statement);
  for (const statement of migrateGlobalCatalogSchemaSqlV3) client.run(statement);
  client.run('INSERT INTO folders(folder_id, current_path, display_name, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)', [
    folder.folderId,
    folder.currentPath,
    folder.displayName,
    folder.firstSeenAt,
    folder.lastSeenAt,
  ]);
  client.run('INSERT INTO files(fingerprint, folder_id, file_name, size, duration_s, processed_at, analyzer, model, gps_lat, gps_lon) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    'fp-v3',
    folder.folderId,
    'coast.mp4',
    2048,
    null,
    '2026-02-01T00:00:00.000Z',
    null,
    null,
    null,
    null,
  ]);
  client.run('INSERT INTO analyses(fingerprint, final_name, description, transcript, language) VALUES (?, ?, ?, ?, ?)', [
    'fp-v3',
    'coast-final.mp4',
    'A coastal cliff',
    'ocean words',
    null,
  ]);
  client.run('INSERT INTO tags(name) VALUES (?)', ['coast']);
  client.run('INSERT INTO file_tags(fingerprint, tag_id) VALUES (?, ?)', ['fp-v3', 1]);
  client.run('INSERT INTO schema_meta(version) VALUES (3)');
  const databasePath = path.join(home, '.ai-video-cataloger', 'catalog.db');
  await mkdir(path.dirname(databasePath), { recursive: true });
  await writeFile(databasePath, Buffer.from(client.export()));
  client.close();
};
