import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type initSqlJs from 'sql.js';

import type { CatalogFolder } from '@core/domain/index.js';

const counter = vi.hoisted(() => ({ prepared: 0 }));

vi.mock('sql.js', async () => {
  const actual = await vi.importActual<{ default: typeof initSqlJs }>('sql.js');
  return {
    default: async (config: Parameters<typeof actual.default>[0]) => {
      const SQL = await actual.default(config);
      const prepare = SQL.Database.prototype.prepare;
      SQL.Database.prototype.prepare = function patched(this: InstanceType<typeof SQL.Database>, ...args: [string]) {
        counter.prepared += 1;
        return prepare.apply(this, args);
      };
      return SQL;
    },
  };
});

const { SqlJsGlobalCatalogStore } = await import('./global-catalog.js');

const tempRoots: string[] = [];

const tempHome = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'avc-global-count-'));
  tempRoots.push(root);
  return root;
};

const folderOf = (suffix: string, name: string): CatalogFolder => ({
  folderId: `33333333-3333-4333-8333-3333333333${suffix}`,
  currentPath: `/media/${name}`,
  displayName: name,
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-02T00:00:00.000Z',
});

const small = folderOf('01', 'drive-small');
const large = folderOf('02', 'drive-large');

const fill = async (
  store: InstanceType<typeof SqlJsGlobalCatalogStore>,
  folder: CatalogFolder,
  fileCount: number,
): Promise<void> => {
  expect((await store.upsertFolder(folder)).ok).toBe(true);
  for (let index = 0; index < fileCount; index += 1) {
    const fingerprint = `${folder.displayName}-fp-${String(index).padStart(4, '0')}`;
    expect((await store.upsertFile({
      fingerprint,
      folderId: folder.folderId,
      fileName: `clip-${String(index)}.mp4`,
      size: 1024,
      durationS: 30,
      gpsLat: null,
      gpsLon: null,
      processedAt: '2026-01-03T00:00:00.000Z',
      analyzer: 'openai',
      model: 'gpt-4.1-mini',
      missingAt: null,
    })).ok).toBe(true);
    expect((await store.upsertAnalysis({
      fingerprint,
      finalName: `${folder.displayName}-named-${String(index)}.mp4`,
      description: 'A clip',
      transcript: 'words',
      language: 'en',
      tags: ['beach', `clip-${String(index % 7)}`],
    })).ok).toBe(true);
  }
};

describe('listFolderRecords query count', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('costs the same number of queries for a 10-file folder and a 500-file one', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await fill(store, small, 10);
    await fill(store, large, 500);

    counter.prepared = 0;
    const smallRecords = await store.listFolderRecords(small.folderId);
    const smallQueries = counter.prepared;
    counter.prepared = 0;
    const largeRecords = await store.listFolderRecords(large.folderId);
    const largeQueries = counter.prepared;

    expect(largeQueries).toBe(smallQueries);
    expect(largeQueries).toBeLessThanOrEqual(10);
    expect(smallRecords.ok && smallRecords.value.length).toBe(10);
    expect(largeRecords.ok && largeRecords.value.length).toBe(500);
    expect(largeRecords.ok && largeRecords.value[0]?.analysis?.finalName).toBe('drive-large-named-0.mp4');
    expect(largeRecords.ok && largeRecords.value[0]?.analysis?.tags).toEqual(['beach', 'clip-0']);
    expect(largeRecords.ok && largeRecords.value[13]?.analysis?.tags).toEqual(['beach', 'clip-6']);
    expect(largeRecords.ok && largeRecords.value.every((record) => record.file.fingerprint.startsWith('drive-large-'))).toBe(true);
    // Filling 510 rows under full-suite load overran the default 5s; the assertion is query counts, not speed.
  }, 30_000);
});
