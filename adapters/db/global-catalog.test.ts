import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { afterEach, describe, expect, it } from 'vitest';

import type { CatalogFile, CatalogFolder } from '@core/domain/index.js';

import { SqlJsGlobalCatalogStore } from './global-catalog.js';
import { createGlobalCatalogSchemaSqlV1 } from './global-catalog-schema.js';

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
  });

  it('overwrites a row on conflicting fingerprint upsert', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFile(file);
    await store.upsertFile({ ...file, fileName: 'renamed.mp4', processedAt: '2026-05-01T00:00:00.000Z' });

    const stored = await store.getFile(file.fingerprint);
    expect(stored.ok && stored.value?.fileName).toBe('renamed.mp4');
    const counts = await store.counts();
    expect(counts.ok && counts.value.files).toBe(1);
  });

  it('migrates an existing v1 database to v2 and persists the migrated schema immediately', async () => {
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

    expect(versionResult[0]?.values[0]?.[0]).toBe(2);
    const columnNames = columnResult[0]?.values.map((row) => row[1]).filter((value) => typeof value === 'string') ?? [];
    expect(columnNames).toContain('gps_lat');
    expect(columnNames).toContain('gps_lon');
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
