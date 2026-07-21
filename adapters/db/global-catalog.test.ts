import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { CatalogFile, CatalogFolder } from '@core/domain/index.js';

import { SqlJsGlobalCatalogStore } from './global-catalog.js';

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
});
