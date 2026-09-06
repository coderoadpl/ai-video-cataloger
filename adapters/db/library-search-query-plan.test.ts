import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type initSqlJs from 'sql.js';
import type { SqlValue } from 'sql.js';

import type { CatalogFile, CatalogFolder } from '@core/domain/index.js';
import type { CatalogSearchFilters } from '@core/server/ports.js';

interface CapturedStatement {
  sql: string;
  params: Record<string, SqlValue> | undefined;
}

const captured = vi.hoisted((): { statements: CapturedStatement[] } => ({ statements: [] }));

vi.mock('sql.js', async () => {
  const actual = await vi.importActual<{ default: typeof initSqlJs }>('sql.js');
  return {
    default: async (config: Parameters<typeof actual.default>[0]) => {
      const SQL = await actual.default(config);
      const exec = SQL.Database.prototype.exec;
      SQL.Database.prototype.exec = function patched(
        this: InstanceType<typeof SQL.Database>,
        ...args: [string, Record<string, SqlValue> | undefined]
      ) {
        captured.statements.push({ sql: args[0], params: args[1] });
        return exec.apply(this, args);
      };
      return SQL;
    },
  };
});

const { SqlJsGlobalCatalogStore } = await import('./global-catalog.js');
const { SqlJsPhotosStore } = await import('./photos-store.js');

const tempRoots: string[] = [];

const tempHome = async (): Promise<string> => {
  const home = await mkdtemp(path.join(tmpdir(), 'avc-library-plan-'));
  tempRoots.push(home);
  return home;
};

afterEach(async () => {
  captured.statements.length = 0;
  while (tempRoots.length > 0) {
    const home = tempRoots.pop();
    if (home !== undefined) await rm(home, { recursive: true, force: true });
  }
});

const folder: CatalogFolder = {
  folderId: '55555555-5555-4555-8555-555555555555',
  currentPath: '/media/plan',
  displayName: 'plan',
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
};

const fileOf = (index: number): CatalogFile => ({
  fingerprint: `fp-${String(index)}`,
  folderId: folder.folderId,
  fileName: `wakacje-${String(index)}.mp4`,
  size: 1024,
  durationS: 10,
  width: null,
  height: null,
  gpsLat: null,
  gpsLon: null,
  processedAt: '2026-01-02T00:00:00.000Z',
  analyzer: 'harness',
  model: 'harness-1',
  missingAt: null,
  capturedAt: '2026-01-02T00:00:00.000Z',
  capturedAtSource: null,
  gpsSource: null,
  gpsAccuracyM: null,
  gpsIntervalKind: null,
  gpsResolvedAt: null,
  place: null,
});

const EMPTY_FILTERS: CatalogSearchFilters = {
  tagTermSets: [],
  personIds: [],
  place: null,
  capturedFrom: null,
  capturedTo: null,
  hasGps: null,
  folderId: null,
  excludeFolderIds: [],
  excludeMissing: false,
  hidden: 'exclude',
};

const capturedMatching = (needles: readonly string[]): CapturedStatement => {
  const match = [...captured.statements].reverse().find((statement) =>
    needles.every((needle) => statement.sql.includes(needle)));
  if (match === undefined) throw new Error(`no captured statement containing ${needles.join(' + ')}`);
  return match;
};

const planLines = async (databasePath: string, statement: CapturedStatement): Promise<string[]> => {
  const SQL = await vi.importActual<{ default: typeof initSqlJs }>('sql.js').then((actual) => actual.default());
  const client = new SQL.Database(readFileSync(databasePath));
  try {
    const result = client.exec(`EXPLAIN QUERY PLAN ${statement.sql}`, statement.params);
    return (result[0]?.values ?? []).map((row) => String(row[3]));
  } finally {
    client.close();
  }
};

describe('full-text collection queries', () => {
  it('drives the catalog match from the full-text index, never once per catalogued file', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.withBatch(async () => {
      for (let index = 0; index < 30; index += 1) {
        const file = await store.upsertFile(fileOf(index));
        if (!file.ok) return file;
        const analysis = await store.upsertAnalysis({
          fingerprint: `fp-${String(index)}`,
          finalName: null,
          description: 'wakacje nad jeziorem',
          transcript: 'wakacje',
          language: 'pl',
          tags: ['wakacje'],
        });
        if (!analysis.ok) return analysis;
      }
      return { ok: true as const, value: undefined };
    });
    expect((await store.flush()).ok).toBe(true);

    captured.statements.length = 0;
    const searched = await store.search({
      match: 'wakacj*',
      rankingTerms: ['wakacj'],
      filters: EMPTY_FILTERS,
      sort: 'captured_desc',
      limit: 10,
      offset: 0,
      after: null,
    });
    expect(searched.ok && searched.value.total).toBe(30);

    for (const needles of [['COUNT(*)', 'search_documents_fts MATCH'], ['ORDER BY', 'search_documents_fts MATCH']]) {
      const plan = await planLines(store.databasePath(), capturedMatching(needles));
      expect(plan[0]?.startsWith('SCAN search_documents_fts')).toBe(true);
    }
  });

  it('drives the photo match from the full-text index, never once per catalogued photo', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    expect((await store.upsertFolder({
      folderId: 'path-plan0001',
      currentPath: '/media/plan',
      displayName: 'plan',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
      defaultConfigId: null,
    })).ok).toBe(true);
    expect((await store.upsertAnalysisConfig({
      configId: 'cfg_000000000001',
      descriptorJson: '{"analyzer":"harness"}',
      label: 'harness',
      now: '2026-01-01T00:00:00.000Z',
    })).ok).toBe(true);
    await store.withBatch(async () => {
      for (let index = 0; index < 30; index += 1) {
        const fingerprint = `ph_${index.toString(16).padStart(16, '0')}`;
        const photo = await store.upsertPhoto({
          fingerprint,
          folderId: 'path-plan0001',
          fileName: `wakacje-${String(index)}.jpg`,
          currentPath: `/media/plan/wakacje-${String(index)}.jpg`,
          ext: 'jpg',
          size: 2048,
          width: 4000,
          height: 3000,
          orientation: 1,
          cameraMake: null,
          cameraModel: null,
          lens: null,
          iso: null,
          fNumber: null,
          exposureTime: null,
          exifRating: null,
          capturedAt: '2026-01-02T00:00:00.000Z',
          capturedAtSource: 'file_mtime',
          gpsLat: null,
          gpsLon: null,
          gpsSource: null,
          gpsAccuracyM: null,
          gpsIntervalKind: null,
          gpsResolvedAt: null,
          placeName: null,
          placeRegion: null,
          placeCountry: null,
          placeCountryCode: null,
          placeDistanceM: null,
          placeDataset: null,
          discoveredAt: '2026-01-01T00:00:00.000Z',
          exifReadAt: null,
          proxyState: 'done',
          proxyWidth: null,
          proxyHeight: null,
          thumbState: 'done',
          missingAt: null,
          selectedConfigId: null,
        });
        if (!photo.ok) return photo;
        const analysis = await store.recordPhotoAnalysis({
          fingerprint,
          configId: 'cfg_000000000001',
          description: 'wakacje nad jeziorem',
          scene: 'outdoor',
          quality: 'good',
          language: 'pl',
          analyzer: 'harness',
          model: 'harness-1',
          batchSize: 1,
          usageJson: null,
          tags: ['wakacje'],
          createdAt: '2026-01-02T00:00:00.000Z',
        });
        if (!analysis.ok) return analysis;
      }
      return { ok: true as const, value: undefined };
    });
    expect((await store.flush()).ok).toBe(true);

    captured.statements.length = 0;
    const page = await store.collectionPage({
      match: 'wakacj*',
      rankingTerms: ['wakacj'],
      from: null,
      to: null,
      folderId: null,
      fingerprints: null,
      tagTermSets: [],
      excludeMissing: false,
      hidden: 'exclude',
      sort: 'captured_desc',
      limit: 10,
      offset: 0,
      after: null,
    });
    expect(page.ok && page.value.total).toBe(30);

    for (const needles of [
      ['COUNT(*)', 'photo_search_documents_fts MATCH'],
      ['ORDER BY', 'photo_search_documents_fts MATCH'],
    ]) {
      const plan = await planLines(store.databasePath(), capturedMatching(needles));
      expect(plan[0]?.startsWith('SCAN photo_search_documents_fts')).toBe(true);
    }
  });
});
