import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import initSqlJs, { type SqlValue } from 'sql.js';

import type { PhotoFolderRecord, PhotoRecord, PhotoSightingRecord } from '@core/server/index.js';
import { scaledTimeout } from '../../test/helpers/gate-timeout.js';

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

const { SqlJsPhotosStore } = await import('./photos-store.js');

const tempRoots: string[] = [];

const tempHome = async (): Promise<string> => {
  const home = await mkdtemp(path.join(tmpdir(), 'avc-photos-scale-'));
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

const folderOf = (suffix: string, root: string): PhotoFolderRecord => ({
  folderId: `path-scale${suffix}`,
  currentPath: root,
  displayName: root,
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
  defaultConfigId: null,
});

const photoOf = (index: number, folder: PhotoFolderRecord): PhotoRecord => ({
  fingerprint: `ph_${folder.folderId}_${String(index).padStart(6, '0')}`,
  folderId: folder.folderId,
  fileName: `f${String(index)}.jpg`,
  currentPath: `${folder.currentPath}/f${String(index)}.jpg`,
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
  capturedAt: `2026-01-01T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
  capturedAtSource: 'exif_offset',
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
  exifReadAt: '2026-01-01T00:00:00.000Z',
  proxyState: 'done',
  proxyWidth: 1600,
  proxyHeight: 1200,
  thumbState: 'done',
  missingAt: null,
  selectedConfigId: null,
});

const sightingOf = (photo: PhotoRecord): PhotoSightingRecord => ({
  fingerprint: photo.fingerprint,
  currentPath: photo.currentPath,
  folderId: photo.folderId,
  size: photo.size,
  mtimeMs: 1000,
  lastSeenAt: '2026-01-01T00:00:00.000Z',
});

const seed = async (
  store: InstanceType<typeof SqlJsPhotosStore>,
  folder: PhotoFolderRecord,
  count: number,
): Promise<void> => {
  expect((await store.upsertFolder(folder)).ok).toBe(true);
  const written = await store.withBatch(async () => {
    for (let index = 0; index < count; index += 1) {
      const photo = photoOf(index, folder);
      const insertedPhoto = await store.upsertPhoto(photo);
      if (!insertedPhoto.ok) return insertedPhoto;
      const insertedSighting = await store.upsertSighting(sightingOf(photo));
      if (!insertedSighting.ok) return insertedSighting;
    }
    return { ok: true, value: undefined } as const;
  });
  expect(written.ok).toBe(true);
};

const lastSelect = (needle: string): CapturedStatement => {
  const match = [...captured.statements].reverse().find((statement) =>
    statement.sql.includes(needle) && statement.sql.trimStart().toUpperCase().startsWith('SELECT'));
  if (match === undefined) throw new Error(`no captured SELECT containing ${needle}`);
  return match;
};

const planLines = async (databasePath: string, statement: CapturedStatement): Promise<string[]> => {
  const SQL = await initSqlJs();
  const client = new SQL.Database(readFileSync(databasePath));
  try {
    const result = client.exec(`EXPLAIN QUERY PLAN ${statement.sql}`, statement.params);
    return (result[0]?.values ?? []).map((row) => String(row[3]));
  } finally {
    client.close();
  }
};

const millisecondsOf = async (operation: () => Promise<unknown>): Promise<number> => {
  const startedAt = Date.now();
  await operation();
  return Date.now() - startedAt;
};

describe('photos store at scale', () => {
  it('reads sightings under a root through an index, never a table scan', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    const folder = folderOf('a', '/media/a');
    await seed(store, folder, 40);
    expect((await store.flush()).ok).toBe(true);

    captured.statements.length = 0;
    const listed = await store.listSightingsUnderRoot('/media/a');
    expect(listed.ok && listed.value).toHaveLength(40);

    const plan = await planLines(store.databasePath(), lastSelect('photo_paths'));
    expect(plan.some((line) => line.startsWith('SCAN photo_paths'))).toBe(false);
    expect(plan.some((line) => line.includes('idx_photo_paths_path'))).toBe(true);
  });

  it('keeps a sibling root whose name is a prefix out of scope', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await seed(store, folderOf('a', '/media/a'), 3);
    await seed(store, folderOf('b', '/media/ab'), 4);
    expect((await store.flush()).ok).toBe(true);

    const listed = await store.listSightingsUnderRoot('/media/a');
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value).toHaveLength(3);
    expect(listed.value.every((entry) => entry.currentPath.startsWith('/media/a/'))).toBe(true);

    const empty = await store.listSightingsUnderRoot('/media/nothing');
    expect(empty.ok && empty.value).toEqual([]);
  });

  it('orders analysis candidates from the current_path index instead of a temp b-tree', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await seed(store, folderOf('a', '/media/a'), 20);
    expect((await store.flush()).ok).toBe(true);

    captured.statements.length = 0;
    const candidates = await store.listAnalysisCandidates('/media/a', 'cfg_000000000001', false);
    expect(candidates.ok && candidates.value.candidates).toHaveLength(20);

    const plan = await planLines(store.databasePath(), lastSelect('ORDER BY current_path'));
    expect(plan.some((line) => line.includes('TEMP B-TREE FOR ORDER BY'))).toBe(false);
    expect(plan.some((line) => line.includes('idx_photos_proxy_state_path'))).toBe(true);
  });

  it('orders proxy candidates from the current_path index instead of a temp b-tree', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await seed(store, folderOf('a', '/media/a'), 20);
    expect((await store.flush()).ok).toBe(true);

    captured.statements.length = 0;
    const candidates = await store.listProxyCandidates('/media/a');
    expect(candidates.ok).toBe(true);

    const plan = await planLines(store.databasePath(), lastSelect('ORDER BY current_path'));
    expect(plan.some((line) => line.includes('TEMP B-TREE FOR ORDER BY'))).toBe(false);
    expect(plan.some((line) => line.includes('idx_photos_current_path'))).toBe(true);
  });

  it('answers scoped reads over a multi-root library within an order of magnitude of the target', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    const scoped = folderOf('a', '/media/a');
    await seed(store, scoped, 1_000);
    await seed(store, folderOf('b', '/media/b'), 1_000);
    expect((await store.flush()).ok).toBe(true);

    const countsMs = await millisecondsOf(async () => {
      const counts = await store.counts('/media/a');
      expect(counts.ok && counts.value.photos).toBe(1_000);
    });
    const pageMs = await millisecondsOf(async () => {
      const page = await store.listPhotosPage({ root: '/media/a', offset: 0, limit: 200 });
      expect(page.ok && page.value.total).toBe(1_000);
      expect(page.ok && page.value.items).toHaveLength(200);
    });
    const sightingsMs = await millisecondsOf(async () => {
      const sightings = await store.listSightingsUnderRoot('/media/a');
      expect(sightings.ok && sightings.value).toHaveLength(1_000);
    });

    console.log(`photos scale: counts ${String(countsMs)}ms, page ${String(pageMs)}ms, sightings ${String(sightingsMs)}ms`);
    expect(Math.max(countsMs, pageMs, sightingsMs)).toBeLessThan(2_000);
  }, scaledTimeout(120_000));
});
