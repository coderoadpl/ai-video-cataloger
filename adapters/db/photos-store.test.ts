import * as fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FACE_ENGINE_VERSION } from '@core/domain/index.js';
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
      proxied: 0,
      proxyFailed: 0,
      analysed: 0,
      facesIndexed: 0,
    });
    expect(scoped.ok && scoped.value).toEqual({
      photos: 1,
      paths: 2,
      exifRead: 0,
      exifFailed: 1,
      missing: 0,
      duplicates: 1,
      proxied: 0,
      proxyFailed: 0,
      analysed: 0,
      facesIndexed: 0,
    });
  });

  it('counts proxied and proxy-failed photos', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await store.upsertPhoto(photo({ proxyState: 'done' }));
    await store.upsertPhoto(photo({ fingerprint: 'ph_0000000000000002', currentPath: '/media/photos/b.jpg', proxyState: 'failed' }));
    await store.upsertPhoto(photo({ fingerprint: 'ph_0000000000000003', currentPath: '/media/photos/c.jpg', proxyState: 'pending' }));

    const counts = await store.counts(null);
    expect(counts.ok && counts.value).toMatchObject({ proxied: 1, proxyFailed: 1 });
  });

  describe('photo face index state', () => {
    const seedProxied = async (store: SqlJsPhotosStore): Promise<void> => {
      await store.upsertFolder(folder);
      await store.upsertPhoto(photo({ proxyState: 'done' }));
      await store.upsertSighting(sighting());
      await store.upsertPhoto(photo({
        fingerprint: 'ph_0000000000000002',
        currentPath: '/media/photos/b.jpg',
        proxyState: 'done',
      }));
      await store.upsertSighting(sighting({ fingerprint: 'ph_0000000000000002', currentPath: '/media/photos/b.jpg' }));
    };

    it('lists every proxied photo under the root as a candidate and counts it in scope', async () => {
      const store = new SqlJsPhotosStore({ homeDirectory: await tempHome() });
      await seedProxied(store);
      await store.upsertPhoto(photo({
        fingerprint: 'ph_0000000000000003',
        currentPath: '/media/photos/c.jpg',
        proxyState: 'pending',
      }));
      await store.upsertSighting(sighting({ fingerprint: 'ph_0000000000000003', currentPath: '/media/photos/c.jpg' }));
      await store.upsertPhoto(photo({
        fingerprint: 'ph_0000000000000004',
        currentPath: '/media/photos/d.jpg',
        proxyState: 'done',
        missingAt: 1767225600000,
      }));
      await store.upsertSighting(sighting({ fingerprint: 'ph_0000000000000004', currentPath: '/media/photos/d.jpg' }));

      const listed = await store.listPhotoFaceIndexCandidates('/media/photos');
      expect(listed.ok && listed.value).toEqual({
        inScope: 2,
        candidates: [
          { fingerprint: 'ph_0000000000000001', currentPath: '/media/photos/a.jpg', previousEngineVersion: null },
          { fingerprint: 'ph_0000000000000002', currentPath: '/media/photos/b.jpg', previousEngineVersion: null },
        ],
      });
    });

    it('scopes candidates to the root without matching a sibling prefix', async () => {
      const store = new SqlJsPhotosStore({ homeDirectory: await tempHome() });
      await seedProxied(store);
      await store.upsertPhoto(photo({
        fingerprint: 'ph_0000000000000009',
        currentPath: '/media/photoscope/e.jpg',
        proxyState: 'done',
      }));
      await store.upsertSighting(sighting({ fingerprint: 'ph_0000000000000009', currentPath: '/media/photoscope/e.jpg' }));

      const listed = await store.listPhotoFaceIndexCandidates('/media/photos');
      expect(listed.ok && listed.value.candidates.map((candidate) => candidate.fingerprint))
        .toEqual(['ph_0000000000000001', 'ph_0000000000000002']);
    });

    it('drops a photo completed at the current engine version and keeps a stale one', async () => {
      const store = new SqlJsPhotosStore({ homeDirectory: await tempHome() });
      await seedProxied(store);
      expect((await store.completePhotoFaceIndex('ph_0000000000000001', FACE_ENGINE_VERSION)).ok).toBe(true);
      expect((await store.completePhotoFaceIndex('ph_0000000000000002', FACE_ENGINE_VERSION - 1)).ok).toBe(true);

      const listed = await store.listPhotoFaceIndexCandidates('/media/photos');
      expect(listed.ok && listed.value).toEqual({
        inScope: 2,
        candidates: [
          {
            fingerprint: 'ph_0000000000000002',
            currentPath: '/media/photos/b.jpg',
            previousEngineVersion: FACE_ENGINE_VERSION - 1,
          },
        ],
      });

      const counts = await store.counts('/media/photos');
      expect(counts.ok && counts.value).toMatchObject({ facesIndexed: 1 });
    });

    it('re-completing a photo overwrites its engine version instead of inserting a second row', async () => {
      const store = new SqlJsPhotosStore({ homeDirectory: await tempHome() });
      await seedProxied(store);
      await store.completePhotoFaceIndex('ph_0000000000000001', FACE_ENGINE_VERSION - 1);
      await store.completePhotoFaceIndex('ph_0000000000000001', FACE_ENGINE_VERSION);
      expect((await store.flush()).ok).toBe(true);

      const SQL = await initSqlJs();
      const client = new SQL.Database(fs.readFileSync(store.databasePath()));
      const rows = client.exec('SELECT fingerprint, engine_version FROM photo_face_index_state')[0]?.values ?? [];
      client.close();
      expect(rows).toEqual([['ph_0000000000000001', FACE_ENGINE_VERSION]]);
    });

    it('forgets the face index state when the photo row is deleted', async () => {
      const store = new SqlJsPhotosStore({ homeDirectory: await tempHome() });
      await seedProxied(store);
      await store.completePhotoFaceIndex('ph_0000000000000001', FACE_ENGINE_VERSION);
      expect((await store.deletePhoto('ph_0000000000000001')).ok).toBe(true);

      const counts = await store.counts(null);
      expect(counts.ok && counts.value).toMatchObject({ facesIndexed: 0 });
    });
  });

  it('listProxyCandidates reports every present photo with its artifact state, and excludes missing photos', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await store.upsertPhoto(photo({ proxyState: 'done', thumbState: 'done' }));
    await store.upsertPhoto(photo({ fingerprint: 'ph_0000000000000002', currentPath: '/media/photos/b.jpg', proxyState: 'pending' }));
    await store.upsertPhoto(photo({ fingerprint: 'ph_0000000000000003', currentPath: '/media/photos/c.jpg', proxyState: 'pending', missingAt: 999 }));

    const candidates = await store.listProxyCandidates('/media/photos');

    expect(candidates.ok && candidates.value.map((candidate) => ({
      fingerprint: candidate.fingerprint,
      proxyState: candidate.proxyState,
      thumbState: candidate.thumbState,
    }))).toEqual([
      { fingerprint: 'ph_0000000000000001', proxyState: 'done', thumbState: 'done' },
      { fingerprint: 'ph_0000000000000002', proxyState: 'pending', thumbState: 'pending' },
    ]);
  });

  it('listProxyCandidates picks the newest sighting under the root when the owner path lies elsewhere', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await store.upsertPhoto(photo({ currentPath: '/elsewhere/a.jpg' }));
    await store.upsertSighting(sighting({ currentPath: '/media/photos/a.jpg', lastSeenAt: '2026-01-02T00:00:00.000Z' }));

    const candidates = await store.listProxyCandidates('/media/photos');
    expect(candidates.ok && candidates.value).toEqual([
      {
        fingerprint: 'ph_0000000000000001',
        sourcePath: '/media/photos/a.jpg',
        ext: 'jpg',
        proxyState: 'pending',
        thumbState: 'pending',
      },
    ]);
  });

  it('setProxyOutcome round-trips proxy and thumb state', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await store.upsertPhoto(photo());

    const updated = await store.setProxyOutcome({
      fingerprint: photo().fingerprint,
      proxyState: 'done',
      proxyWidth: 1280,
      proxyHeight: 720,
      thumbState: 'done',
    });
    expect(updated.ok).toBe(true);

    const got = await store.getPhoto(photo().fingerprint);
    expect(got.ok && got.value).toMatchObject({ proxyState: 'done', proxyWidth: 1280, proxyHeight: 720, thumbState: 'done' });
  });

  it('listRoots reports the most recent run per root with scoped counts', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await store.upsertPhoto(photo({ currentPath: '/media/photos/a.jpg' }));
    await store.startPhotoRun(run({ root: '/media/photos', startedAt: '2026-01-01T00:00:00.000Z' }));
    await store.startPhotoRun(run({ runId: 'photo-run-2', root: '/media/photos', startedAt: '2026-01-02T00:00:00.000Z' }));

    const roots = await store.listRoots();
    expect(roots.ok && roots.value).toEqual([
      { root: '/media/photos', photos: 1, missing: 0, lastScanAt: '2026-01-02T00:00:00.000Z' },
    ]);
  });

  it('listPhotosPage orders by captured_at DESC with a fingerprint tiebreak and applies stable offsets', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await store.upsertPhoto(photo({ fingerprint: 'ph_0000000000000001', currentPath: '/media/photos/a.jpg', capturedAt: '2026-01-01T00:00:00.000Z' }));
    await store.upsertPhoto(photo({ fingerprint: 'ph_0000000000000002', currentPath: '/media/photos/b.jpg', capturedAt: '2026-01-02T00:00:00.000Z' }));
    await store.upsertPhoto(photo({ fingerprint: 'ph_0000000000000003', currentPath: '/media/photos/c.jpg', capturedAt: '2026-01-02T00:00:00.000Z' }));

    const page1 = await store.listPhotosPage({ root: null, offset: 0, limit: 2 });
    expect(page1.ok && page1.value.total).toBe(3);
    expect(page1.ok && page1.value.items.map((item) => item.fingerprint)).toEqual(['ph_0000000000000002', 'ph_0000000000000003']);

    const page2 = await store.listPhotosPage({ root: null, offset: 2, limit: 2 });
    expect(page2.ok && page2.value.items.map((item) => item.fingerprint)).toEqual(['ph_0000000000000001']);
  });

  it('listPhotosPage root scoping admits /a/b/x.jpg and excludes the sibling-prefix folder /a/bc/x.jpg', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await store.upsertPhoto(photo({ fingerprint: 'ph_0000000000000001', currentPath: '/a/b/x.jpg' }));
    await store.upsertPhoto(photo({ fingerprint: 'ph_0000000000000002', currentPath: '/a/bc/x.jpg' }));

    const page = await store.listPhotosPage({ root: '/a/b', offset: 0, limit: 10 });
    expect(page.ok && page.value.items.map((item) => item.fingerprint)).toEqual(['ph_0000000000000001']);
  });

  it('listPhotosPage includes a duplicate sighted under the root but owned elsewhere, with the sightings count', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await store.upsertPhoto(photo({ currentPath: '/elsewhere/a.jpg' }));
    await store.upsertSighting(sighting({ currentPath: '/elsewhere/a.jpg' }));
    await store.upsertSighting(sighting({ currentPath: '/media/photos/a.jpg' }));

    const page = await store.listPhotosPage({ root: '/media/photos', offset: 0, limit: 10 });
    expect(page.ok && page.value.items).toEqual([
      expect.objectContaining({ fingerprint: 'ph_0000000000000001', sightings: 2 }),
    ]);
  });

  it('getPhotoDetail returns the photo and its sightings ordered by last-seen then path', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await store.upsertPhoto(photo());
    await store.upsertSighting(sighting({ currentPath: '/media/photos/a.jpg', lastSeenAt: '2026-01-01T00:00:00.000Z' }));
    await store.upsertSighting(sighting({ currentPath: '/media/photos/newer.jpg', lastSeenAt: '2026-01-02T00:00:00.000Z' }));

    const detail = await store.getPhotoDetail(photo().fingerprint);
    expect(detail.ok && detail.value?.sightings.map((item) => item.currentPath)).toEqual([
      '/media/photos/newer.jpg',
      '/media/photos/a.jpg',
    ]);

    const missing = await store.getPhotoDetail('ph_ffffffffffffffff');
    expect(missing.ok && missing.value).toBeNull();
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

  it('listAnalysisCandidates excludes proxy-pending and missing photos, includes a sighting owned elsewhere, and honours force (P7)', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertPhoto(photo({ proxyState: 'done' }));
    await store.upsertSighting(sighting());
    await store.upsertPhoto(photo({ fingerprint: 'ph_0000000000000002', currentPath: '/media/photos/b.jpg', proxyState: 'pending' }));
    await store.upsertSighting(sighting({ fingerprint: 'ph_0000000000000002', currentPath: '/media/photos/b.jpg' }));
    await store.upsertPhoto(photo({ fingerprint: 'ph_0000000000000003', currentPath: '/media/photoscope/c.jpg', proxyState: 'done' }));
    await store.upsertSighting(sighting({ fingerprint: 'ph_0000000000000003', currentPath: '/media/photos/copy-of-c.jpg' }));
    await store.upsertPhoto(photo({ fingerprint: 'ph_0000000000000004', currentPath: '/media/photos/d.jpg', proxyState: 'done', missingAt: 1 }));

    const initial = await store.listAnalysisCandidates('/media/photos', 'cfg_test', false);
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    expect(initial.value.candidates.map((candidate) => candidate.fingerprint).sort()).toEqual([
      'ph_0000000000000001',
      'ph_0000000000000003',
    ]);
    expect(initial.value.alreadyAnalysed).toBe(0);

    const recorded = await store.recordPhotoAnalysis({
      fingerprint: 'ph_0000000000000001',
      configId: 'cfg_test',
      description: 'a red bicycle leaning against a brick wall',
      scene: 'urban',
      quality: 'good',
      language: 'en',
      analyzer: 'harness',
      model: 'claude-code',
      batchSize: 1,
      usageJson: null,
      tags: ['bicycle', 'brick-wall'],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(recorded.ok).toBe(true);

    const afterAnalysis = await store.listAnalysisCandidates('/media/photos', 'cfg_test', false);
    expect(afterAnalysis.ok).toBe(true);
    if (!afterAnalysis.ok) return;
    expect(afterAnalysis.value.candidates.map((candidate) => candidate.fingerprint)).toEqual(['ph_0000000000000003']);
    expect(afterAnalysis.value.alreadyAnalysed).toBe(1);

    const forced = await store.listAnalysisCandidates('/media/photos', 'cfg_test', true);
    expect(forced.ok).toBe(true);
    if (!forced.ok) return;
    expect(forced.value.candidates.map((candidate) => candidate.fingerprint).sort()).toEqual([
      'ph_0000000000000001',
      'ph_0000000000000003',
    ]);
    expect(forced.value.alreadyAnalysed).toBe(0);
  });

  it('recordPhotoAnalysis writes the row, resolves tags, syncs the fts search document, and counts.analysed reflects it (P7)', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertPhoto(photo({ proxyState: 'done' }));
    await store.upsertSighting(sighting());

    const upsertedConfig = await store.upsertAnalysisConfig({
      configId: 'cfg_test',
      descriptorJson: '{"kind":"photo"}',
      label: 'harness · claude-code · en',
      now: '2026-01-01T00:00:00.000Z',
    });
    expect(upsertedConfig.ok).toBe(true);

    const recorded = await store.recordPhotoAnalysis({
      fingerprint: photo().fingerprint,
      configId: 'cfg_test',
      description: 'a red bicycle leaning against a brick wall',
      scene: 'urban',
      quality: 'good',
      language: 'en',
      analyzer: 'harness',
      model: 'claude-code',
      batchSize: 1,
      usageJson: null,
      tags: ['bicycle', 'brick-wall'],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(recorded.ok).toBe(true);
    await store.flush();

    const counts = await store.counts(null);
    expect(counts.ok && counts.value.analysed).toBe(1);

    const SQL = await initSqlJs();
    const client = new SQL.Database(fs.readFileSync(path.join(home, '.ai-video-cataloger', 'photos.db')));
    const analysisRow = client.exec('SELECT description, scene, quality, batch_size FROM photo_analyses WHERE fingerprint = ? AND config_id = ?', [photo().fingerprint, 'cfg_test']);
    expect(analysisRow[0]?.values[0]).toEqual(['a red bicycle leaning against a brick wall', 'urban', 'good', 1]);
    const tagRows = client.exec(
      `SELECT t.name FROM photo_file_tags ft JOIN photo_tags t ON t.tag_id = ft.tag_id
       WHERE ft.fingerprint = ? AND ft.config_id = ? ORDER BY t.name`,
      [photo().fingerprint, 'cfg_test'],
    );
    expect((tagRows[0]?.values ?? []).map((row) => row[0])).toEqual(['bicycle', 'brick-wall']);
    const ftsRows = client.exec(
      "SELECT file_name FROM photo_search_documents_fts WHERE photo_search_documents_fts MATCH 'bicycle'",
    );
    expect(ftsRows[0]?.values.length).toBeGreaterThan(0);
    client.close();
  });

  const analysisInput = (overrides: Partial<Parameters<SqlJsPhotosStore['recordPhotoAnalysis']>[0]> = {}) => ({
    fingerprint: photo().fingerprint,
    configId: 'cfg_aaaaaaaaaaaa',
    description: 'a red bicycle leaning against a brick wall',
    scene: 'urban',
    quality: 'good',
    language: 'en',
    analyzer: 'harness',
    model: 'claude-code',
    batchSize: 1,
    usageJson: null,
    tags: ['bicycle', 'brick-wall'],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  it('searchPhotos finds an un-analysed photo by file name only, and matches an analysed photo by description and tag terms, with a mark-carrying snippet and place matches (P1)', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertPhoto(photo({ fingerprint: 'ph_0000000000000002', currentPath: '/media/photos/vacation-shot.jpg', fileName: 'vacation-shot.jpg' }));
    await store.upsertPhoto(photo({ placeName: 'Krakow', placeRegion: 'Malopolska', placeCountry: 'Poland' }));
    await store.upsertAnalysisConfig({ configId: 'cfg_aaaaaaaaaaaa', descriptorJson: '{}', label: 'harness · claude-code · en', now: '2026-01-01T00:00:00.000Z' });
    await store.recordPhotoAnalysis(analysisInput());

    const byFileName = await store.searchPhotos({ match: 'vacation*', rankingTerms: ['vacation'], limit: 50, offset: 0 });
    expect(byFileName.ok).toBe(true);
    if (byFileName.ok) expect(byFileName.value.map((row) => row.fingerprint)).toEqual(['ph_0000000000000002']);

    const byDescription = await store.searchPhotos({ match: 'bicycle*', rankingTerms: ['bicycle'], limit: 50, offset: 0 });
    expect(byDescription.ok).toBe(true);
    if (byDescription.ok) {
      expect(byDescription.value.map((row) => row.fingerprint)).toEqual([photo().fingerprint]);
      expect(byDescription.value[0]?.snippet).toContain('<mark>');
      expect(byDescription.value[0]?.tags).toEqual(['bicycle', 'brick-wall']);
    }

    const byPlace = await store.searchPhotos({ match: 'krakow*', rankingTerms: ['krakow'], limit: 50, offset: 0 });
    expect(byPlace.ok).toBe(true);
    if (byPlace.ok) expect(byPlace.value.map((row) => row.fingerprint)).toEqual([photo().fingerprint]);
  });

  it('expandPhotoTagTerms resolves a tag term through photo_tag_aliases (P1)', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertPhoto(photo());
    await store.upsertAnalysisConfig({ configId: 'cfg_aaaaaaaaaaaa', descriptorJson: '{}', label: 'harness · claude-code · en', now: '2026-01-01T00:00:00.000Z' });
    await store.recordPhotoAnalysis(analysisInput());
    await store.flush();

    const SQL = await initSqlJs();
    const dbPath = path.join(home, '.ai-video-cataloger', 'photos.db');
    const client = new SQL.Database(fs.readFileSync(dbPath));
    const tagId = client.exec('SELECT tag_id FROM photo_tags WHERE name = ?', ['bicycle'])[0]?.values[0]?.[0] ?? null;
    client.run('INSERT INTO photo_tag_aliases (alias, tag_id) VALUES (?, ?)', ['bike', tagId]);
    fs.writeFileSync(dbPath, Buffer.from(client.export()));
    client.close();

    const reopened = new SqlJsPhotosStore({ homeDirectory: home });
    const expanded = await reopened.expandPhotoTagTerms(['bike']);
    expect(expanded.ok).toBe(true);
    if (expanded.ok) expect(expanded.value).toEqual([{ term: 'bike', equivalents: ['bicycle'] }]);
  });

  it('offset/limit apply after ordering with a fingerprint tiebreak (P1)', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    for (const suffix of ['1', '2', '3']) {
      await store.upsertPhoto(photo({
        fingerprint: `ph_000000000000000${suffix}`,
        currentPath: `/media/photos/tag-${suffix}.jpg`,
        fileName: `tag-${suffix}.jpg`,
      }));
    }
    const page1 = await store.searchPhotos({ match: 'tag*', rankingTerms: ['tag'], limit: 2, offset: 0 });
    const page2 = await store.searchPhotos({ match: 'tag*', rankingTerms: ['tag'], limit: 2, offset: 2 });
    expect(page1.ok && page1.value.map((row) => row.fingerprint)).toEqual(['ph_0000000000000001', 'ph_0000000000000002']);
    expect(page2.ok && page2.value.map((row) => row.fingerprint)).toEqual(['ph_0000000000000003']);
  });

  it('ranks a file-name hit above a description-only hit before the limit is applied (P1)', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertPhoto(photo({ fingerprint: 'ph_0000000000000001', currentPath: '/media/photos/notes.jpg', fileName: 'notes.jpg' }));
    await store.upsertPhoto(photo({ fingerprint: 'ph_0000000000000002', currentPath: '/media/photos/harbour.jpg', fileName: 'harbour.jpg' }));
    await store.upsertAnalysisConfig({ configId: 'cfg_aaaaaaaaaaaa', descriptorJson: '{}', label: 'A', now: '2026-01-01T00:00:00.000Z' });
    await store.recordPhotoAnalysis(analysisInput({ fingerprint: 'ph_0000000000000001', description: 'a harbour at dusk', tags: [] }));

    const ranked = await store.searchPhotos({ match: 'harbour*', rankingTerms: ['harbour'], limit: 50, offset: 0 });
    expect(ranked.ok && ranked.value.map((row) => row.fingerprint)).toEqual(['ph_0000000000000002', 'ph_0000000000000001']);

    const firstPage = await store.searchPhotos({ match: 'harbour*', rankingTerms: ['harbour'], limit: 1, offset: 0 });
    expect(firstPage.ok && firstPage.value.map((row) => row.fingerprint)).toEqual(['ph_0000000000000002']);
  });

  it('search re-materializes on selection changes: resolved variant wins, select/delete/folder-default keep the index following the resolved analysis (P2)', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertPhoto(photo());
    await store.upsertAnalysisConfig({ configId: 'cfg_aaaaaaaaaaaa', descriptorJson: '{}', label: 'A', now: '2026-01-01T00:00:00.000Z' });
    await store.recordPhotoAnalysis(analysisInput({ configId: 'cfg_aaaaaaaaaaaa', description: 'alpha description', tags: ['alpha-tag'], createdAt: '2026-01-01T00:00:00.000Z' }));
    await store.upsertAnalysisConfig({ configId: 'cfg_bbbbbbbbbbbb', descriptorJson: '{}', label: 'B', now: '2026-01-02T00:00:00.000Z' });
    await store.recordPhotoAnalysis(analysisInput({ configId: 'cfg_bbbbbbbbbbbb', description: 'beta description', tags: ['beta-tag'], createdAt: '2026-01-02T00:00:00.000Z' }));

    const initiallySelectsB = await store.searchPhotos({ match: 'beta*', rankingTerms: ['beta'], limit: 50, offset: 0 });
    expect(initiallySelectsB.ok && initiallySelectsB.value.length).toBe(1);
    const initiallyExcludesA = await store.searchPhotos({ match: 'alpha*', rankingTerms: ['alpha'], limit: 50, offset: 0 });
    expect(initiallyExcludesA.ok && initiallyExcludesA.value.length).toBe(0);

    const selected = await store.setSelectedPhotoVariant(photo().fingerprint, 'cfg_aaaaaaaaaaaa');
    expect(selected.ok).toBe(true);
    const afterSelectA = await store.searchPhotos({ match: 'alpha*', rankingTerms: ['alpha'], limit: 50, offset: 0 });
    expect(afterSelectA.ok && afterSelectA.value.length).toBe(1);
    const afterSelectExcludesB = await store.searchPhotos({ match: 'beta*', rankingTerms: ['beta'], limit: 50, offset: 0 });
    expect(afterSelectExcludesB.ok && afterSelectExcludesB.value.length).toBe(0);

    const deleted = await store.deletePhotoVariant(photo().fingerprint, 'cfg_aaaaaaaaaaaa');
    expect(deleted.ok).toBe(true);
    const afterDeleteFallsBackToB = await store.searchPhotos({ match: 'beta*', rankingTerms: ['beta'], limit: 50, offset: 0 });
    expect(afterDeleteFallsBackToB.ok && afterDeleteFallsBackToB.value.length).toBe(1);
  });

  it('setPhotoFolderDefaultVariant re-materializes only the non-explicit owned photos (P2)', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertPhoto(photo({ fingerprint: 'ph_0000000000000001' }));
    await store.upsertPhoto(photo({ fingerprint: 'ph_0000000000000002', currentPath: '/media/photos/explicit.jpg', fileName: 'explicit.jpg' }));
    await store.upsertAnalysisConfig({ configId: 'cfg_aaaaaaaaaaaa', descriptorJson: '{}', label: 'A', now: '2026-01-01T00:00:00.000Z' });
    await store.recordPhotoAnalysis(analysisInput({ fingerprint: 'ph_0000000000000001', configId: 'cfg_aaaaaaaaaaaa', description: 'alpha description', tags: [] }));
    await store.recordPhotoAnalysis(analysisInput({ fingerprint: 'ph_0000000000000002', configId: 'cfg_aaaaaaaaaaaa', description: 'alpha description', tags: [] }));
    await store.upsertAnalysisConfig({ configId: 'cfg_bbbbbbbbbbbb', descriptorJson: '{}', label: 'B', now: '2026-01-02T00:00:00.000Z' });
    await store.recordPhotoAnalysis(analysisInput({ fingerprint: 'ph_0000000000000001', configId: 'cfg_bbbbbbbbbbbb', description: 'beta description', tags: [] }));
    await store.recordPhotoAnalysis(analysisInput({ fingerprint: 'ph_0000000000000002', configId: 'cfg_bbbbbbbbbbbb', description: 'beta description', tags: [] }));
    const explicitSelection = await store.setSelectedPhotoVariant('ph_0000000000000002', 'cfg_aaaaaaaaaaaa');
    expect(explicitSelection.ok).toBe(true);

    const folderDefaulted = await store.setPhotoFolderDefaultVariant(folder.folderId, 'cfg_bbbbbbbbbbbb');
    expect(folderDefaulted.ok).toBe(true);

    const nonExplicitFollowsDefault = await store.searchPhotos({ match: 'beta*', rankingTerms: ['beta'], limit: 50, offset: 0 });
    expect(nonExplicitFollowsDefault.ok && nonExplicitFollowsDefault.value.map((row) => row.fingerprint)).toEqual(['ph_0000000000000001']);
    const explicitStaysOnItsSelection = await store.searchPhotos({ match: 'alpha*', rankingTerms: ['alpha'], limit: 50, offset: 0 });
    expect(explicitStaysOnItsSelection.ok && explicitStaysOnItsSelection.value.map((row) => row.fingerprint)).toEqual(['ph_0000000000000002']);
  });

  it('listPhotoVariants orders newest-first with a configId tiebreak, and flags selected/explicit (P5)', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertPhoto(photo());
    await store.upsertAnalysisConfig({ configId: 'cfg_aaaaaaaaaaaa', descriptorJson: '{}', label: 'A', now: '2026-01-01T00:00:00.000Z' });
    await store.recordPhotoAnalysis(analysisInput({ configId: 'cfg_aaaaaaaaaaaa', createdAt: '2026-01-01T00:00:00.000Z' }));
    await store.upsertAnalysisConfig({ configId: 'cfg_bbbbbbbbbbbb', descriptorJson: '{}', label: 'B', now: '2026-01-02T00:00:00.000Z' });
    await store.recordPhotoAnalysis(analysisInput({ configId: 'cfg_bbbbbbbbbbbb', createdAt: '2026-01-02T00:00:00.000Z' }));

    const variants = await store.listPhotoVariants(photo().fingerprint);
    expect(variants.ok).toBe(true);
    if (!variants.ok) return;
    expect(variants.value.map((variant) => variant.configId)).toEqual(['cfg_bbbbbbbbbbbb', 'cfg_aaaaaaaaaaaa']);
    expect(variants.value.find((variant) => variant.configId === 'cfg_bbbbbbbbbbbb')?.selected).toBe(true);
    expect(variants.value.find((variant) => variant.configId === 'cfg_bbbbbbbbbbbb')?.explicit).toBe(false);

    const resolved = await store.resolveSelectedConfigId(photo().fingerprint);
    expect(resolved.ok && resolved.value).toBe('cfg_bbbbbbbbbbbb');
  });

  it('setSelectedPhotoVariant rejects an unknown variant and null clears the explicit choice (P5)', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertPhoto(photo());
    await store.upsertAnalysisConfig({ configId: 'cfg_aaaaaaaaaaaa', descriptorJson: '{}', label: 'A', now: '2026-01-01T00:00:00.000Z' });
    await store.recordPhotoAnalysis(analysisInput());

    const unknown = await store.setSelectedPhotoVariant(photo().fingerprint, 'cfg_ffffffffffff');
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe('variant_not_found');

    const selected = await store.setSelectedPhotoVariant(photo().fingerprint, 'cfg_aaaaaaaaaaaa');
    expect(selected.ok).toBe(true);
    const explicit = await store.listPhotoVariants(photo().fingerprint);
    expect(explicit.ok && explicit.value[0]?.explicit).toBe(true);

    const cleared = await store.setSelectedPhotoVariant(photo().fingerprint, null);
    expect(cleared.ok).toBe(true);
    const afterClear = await store.listPhotoVariants(photo().fingerprint);
    expect(afterClear.ok && afterClear.value[0]?.explicit).toBe(false);
  });

  it('deletePhotoVariant of the last variant leaves the photo row with no selection (P5)', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertPhoto(photo());
    await store.upsertAnalysisConfig({ configId: 'cfg_aaaaaaaaaaaa', descriptorJson: '{}', label: 'A', now: '2026-01-01T00:00:00.000Z' });
    await store.recordPhotoAnalysis(analysisInput());
    await store.setSelectedPhotoVariant(photo().fingerprint, 'cfg_aaaaaaaaaaaa');

    const deleted = await store.deletePhotoVariant(photo().fingerprint, 'cfg_aaaaaaaaaaaa');
    expect(deleted.ok).toBe(true);

    const stillThere = await store.getPhoto(photo().fingerprint);
    expect(stillThere.ok && stillThere.value !== null).toBe(true);
    const resolved = await store.resolveSelectedConfigId(photo().fingerprint);
    expect(resolved.ok && resolved.value).toBe(null);
    const variants = await store.listPhotoVariants(photo().fingerprint);
    expect(variants.ok && variants.value).toEqual([]);
  });

  it('ensurePhotoSearchDocuments backfills missing search documents for a pre-3b database on open (P3)', async () => {
    const home = await tempHome();
    const firstOpen = new SqlJsPhotosStore({ homeDirectory: home });
    await firstOpen.upsertFolder(folder);
    await firstOpen.upsertPhoto(photo());
    await firstOpen.flush();

    const dbPath = path.join(home, '.ai-video-cataloger', 'photos.db');
    const SQL = await initSqlJs();
    const client = new SQL.Database(fs.readFileSync(dbPath));
    client.run('DELETE FROM photo_search_documents_fts');
    client.run('DELETE FROM photo_search_documents');
    fs.writeFileSync(dbPath, Buffer.from(client.export()));
    client.close();

    const reopened = new SqlJsPhotosStore({ homeDirectory: home });
    const found = await reopened.searchPhotos({ match: 'a*', rankingTerms: ['a'], limit: 50, offset: 0 });
    expect(found.ok).toBe(true);
    if (found.ok) expect(found.value.map((row) => row.fingerprint)).toEqual([photo().fingerprint]);
  });
});
