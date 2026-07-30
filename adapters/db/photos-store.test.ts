import * as fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PhotoFolderRecord, PhotoRecord, PhotoRunRecord, PhotoSightingRecord } from '@core/server/index.js';

import { SqlJsPhotosStore } from './photos-store.js';

const tempRoots: string[] = [];

const tempHome = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'avc-photos-'));
  tempRoots.push(root);
  return root;
};

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

const folder: PhotoFolderRecord = {
  folderId: 'path-aaaaaaaa',
  currentPath: '/media/photos',
  displayName: 'photos',
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
  defaultConfigId: null,
};

const photo = (overrides: Partial<PhotoRecord> = {}): PhotoRecord => ({
  fingerprint: 'ph_0000000000000001',
  folderId: folder.folderId,
  fileName: 'a.jpg',
  currentPath: '/media/photos/a.jpg',
  ext: 'jpg',
  size: 1024,
  width: 100,
  height: 100,
  orientation: 1,
  cameraMake: null,
  cameraModel: null,
  lens: null,
  iso: null,
  fNumber: null,
  exposureTime: null,
  exifRating: null,
  capturedAt: '2026-01-01T00:00:00.000Z',
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
  proxyState: 'pending',
  proxyWidth: null,
  proxyHeight: null,
  thumbState: 'pending',
  missingAt: null,
  selectedConfigId: null,
  ...overrides,
});

const sighting = (overrides: Partial<PhotoSightingRecord> = {}): PhotoSightingRecord => ({
  fingerprint: 'ph_0000000000000001',
  currentPath: '/media/photos/a.jpg',
  folderId: folder.folderId,
  size: 1024,
  mtimeMs: 1000,
  lastSeenAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const run = (overrides: Partial<PhotoRunRecord> = {}): PhotoRunRecord => ({
  runId: 'photo-run-1',
  root: '/media/photos',
  stage: 'scan',
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: null,
  filesTotal: 1,
  filesDone: 0,
  filesSkipped: 0,
  filesFailed: 0,
  lastActivityAt: '2026-01-01T00:00:00.000Z',
  batchJson: null,
  ...overrides,
});

describe('SqlJsPhotosStore', () => {
  it('declares every index required for query planning at 50k rows', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    expect((await store.upsertFolder(folder)).ok).toBe(true);
    expect((await store.flush()).ok).toBe(true);

    const SQL = await initSqlJs();
    const client = new SQL.Database(fs.readFileSync(store.databasePath()));
    const rows = client.exec("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_photo%' ORDER BY name")[0]?.values ?? [];
    client.close();

    expect(rows.map((row) => row[0])).toEqual([
      'idx_photo_analyses_config',
      'idx_photo_face_index_engine',
      'idx_photo_paths_folder',
      'idx_photo_paths_path',
      'idx_photos_captured_at',
      'idx_photos_folder',
      'idx_photos_proxy_state',
    ]);
  });

  it('round-trips folders, photos and sightings', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });

    expect((await store.upsertFolder(folder)).ok).toBe(true);
    expect((await store.upsertPhoto(photo())).ok).toBe(true);
    expect((await store.upsertSighting(sighting())).ok).toBe(true);
    expect((await store.flush()).ok).toBe(true);

    const reopened = new SqlJsPhotosStore({ homeDirectory: home });
    const gotFolder = await reopened.getFolder(folder.folderId);
    const gotPhoto = await reopened.getPhoto(photo().fingerprint);
    const gotSighting = await reopened.getSightingByPath('/media/photos/a.jpg');
    const sightings = await reopened.listSightings(photo().fingerprint);
    const underRoot = await reopened.listSightingsUnderRoot('/media/photos');

    expect(gotFolder.ok && gotFolder.value).toEqual(folder);
    expect(gotPhoto.ok && gotPhoto.value).toEqual(photo());
    expect(gotSighting.ok && gotSighting.value).toEqual(sighting());
    expect(sightings.ok && sightings.value).toEqual([sighting()]);
    expect(underRoot.ok && underRoot.value).toEqual([sighting()]);

    expect((await reopened.deleteSighting(photo().fingerprint, '/media/photos/a.jpg')).ok).toBe(true);
    const afterDelete = await reopened.listSightings(photo().fingerprint);
    expect(afterDelete.ok && afterDelete.value).toEqual([]);
  });

  it('persists exactly once per withBatch regardless of the number of writes inside it', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.flush();
    const mtimesBeforeBatch: number[] = [];

    const result = await store.withBatch(async () => {
      const first = await store.upsertFolder(folder);
      mtimesBeforeBatch.push(fs.statSync(store.databasePath()).mtimeMs);
      if (!first.ok) return first;
      const second = await store.upsertPhoto(photo());
      mtimesBeforeBatch.push(fs.statSync(store.databasePath()).mtimeMs);
      if (!second.ok) return second;
      const third = await store.upsertSighting(sighting());
      mtimesBeforeBatch.push(fs.statSync(store.databasePath()).mtimeMs);
      return third;
    });

    const mtimeAfterBatch = fs.statSync(store.databasePath()).mtimeMs;
    expect(result.ok).toBe(true);
    expect(new Set(mtimesBeforeBatch).size).toBe(1);
    expect(mtimeAfterBatch).not.toBe(mtimesBeforeBatch[0]);
  });

  it('applies the per-write auto-flush outside a batch', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.flush();
    const mtimeBefore = fs.statSync(store.databasePath()).mtimeMs;

    for (let index = 0; index < 26; index += 1) {
      const result = await store.upsertSighting(sighting({ currentPath: `/media/photos/${String(index)}.jpg` }));
      expect(result.ok).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const mtimeAfter = fs.statSync(store.databasePath()).mtimeMs;
    expect(mtimeAfter).not.toBe(mtimeBefore);
  });

  it('deletes a photo and every dependent row in order', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertPhoto(photo());
    await store.upsertSighting(sighting());
    await store.flush();

    const deleted = await store.deletePhoto(photo().fingerprint);
    expect(deleted.ok).toBe(true);

    const gotPhoto = await store.getPhoto(photo().fingerprint);
    const sightings = await store.listSightings(photo().fingerprint);
    expect(gotPhoto.ok && gotPhoto.value).toBeNull();
    expect(sightings.ok && sightings.value).toEqual([]);
  });

  it('counts photos, paths and duplicates, scoped to a root with a sibling-prefix guard', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertPhoto(photo());
    await store.upsertSighting(sighting());
    await store.upsertSighting(sighting({ currentPath: '/media/photos/copy-of-a.jpg' }));
    await store.upsertPhoto(photo({ fingerprint: 'ph_0000000000000002', currentPath: '/media/photoscope/b.jpg' }));
    await store.upsertSighting(sighting({ fingerprint: 'ph_0000000000000002', currentPath: '/media/photoscope/b.jpg' }));

    const overall = await store.counts(null);
    const scoped = await store.counts('/media/photos');

    expect(overall.ok && overall.value).toEqual({
      photos: 2,
      paths: 3,
      exifRead: 0,
      exifFailed: 2,
      missing: 0,
      duplicates: 1,
    });
    expect(scoped.ok && scoped.value).toEqual({
      photos: 1,
      paths: 2,
      exifRead: 0,
      exifFailed: 1,
      missing: 0,
      duplicates: 1,
    });
  });

  it('keeps a missing photo visible in its owner root scope after its last sighting is gone', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await store.upsertPhoto(photo({ currentPath: '/media/photos/a.jpg', missingAt: 1234 }));

    const scoped = await store.counts('/media/photos');

    expect(scoped.ok && scoped.value).toMatchObject({ photos: 1, paths: 0, missing: 1 });
  });

  it('starts and updates a photo run', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    expect((await store.startPhotoRun(run())).ok).toBe(true);
    expect((await store.updatePhotoRun(run({ filesDone: 1, finishedAt: '2026-01-01T00:01:00.000Z' }))).ok).toBe(true);
    expect((await store.flush()).ok).toBe(true);
  });

  it('refuses a photos database from a newer schema version', async () => {
    const home = await tempHome();
    const SQL = await initSqlJs();
    const client = new SQL.Database();
    client.run('CREATE TABLE schema_meta (version INTEGER PRIMARY KEY)');
    client.run('INSERT INTO schema_meta (version) VALUES (999)');
    const databasePath = path.join(home, '.ai-video-cataloger', 'photos.db');
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    fs.writeFileSync(databasePath, Buffer.from(client.export()));
    client.close();

    const store = new SqlJsPhotosStore({ homeDirectory: home });
    const result = await store.getFolder(folder.folderId);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('snapshot_incompatible');
  });
});
