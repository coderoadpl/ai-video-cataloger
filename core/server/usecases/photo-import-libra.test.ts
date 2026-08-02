import { describe, expect, it } from 'vitest';

import { photoConfigId, buildImportedPhotoConfigDescriptor } from '@core/domain/index.js';

import type { PhotoFolderRecord, PhotoRecord } from '../ports.js';
import { runPhotoImportLibra } from './photo-import-libra.js';
import { InMemoryFileSystem, InMemoryGlobalCatalogStore, InMemoryPhotosStore } from '../../../test/server/usecases/test-fakes.js';

const folder: PhotoFolderRecord = {
  folderId: 'path-aaaaaaaa',
  currentPath: '/lib',
  displayName: 'lib',
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
  defaultConfigId: null,
};

const fingerprint = 'ph_aaaaaaaaaaaaaaaa';

const photo = (overrides: Partial<PhotoRecord> = {}): PhotoRecord => ({
  fingerprint,
  folderId: folder.folderId,
  fileName: 'a.jpg',
  currentPath: '/lib/photos/a.jpg',
  ext: 'jpg',
  size: 10,
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
  capturedAt: null,
  capturedAtSource: null,
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
  ...overrides,
});

const md5 = 'a'.repeat(32);

const setupScannedPhoto = async (photos: InMemoryPhotosStore, overrides: Partial<PhotoRecord> = {}): Promise<void> => {
  await photos.upsertFolder(folder);
  await photos.upsertPhoto(photo(overrides));
  await photos.upsertSighting({
    fingerprint,
    currentPath: '/lib/photos/a.jpg',
    folderId: folder.folderId,
    size: 10,
    mtimeMs: 0,
    lastSeenAt: '2026-01-01T00:00:00.000Z',
  });
  await photos.startPhotoRun({
    runId: 'run-1',
    root: '/lib',
    stage: 'scan',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:01:00.000Z',
    filesTotal: 1,
    filesDone: 1,
    filesSkipped: 0,
    filesFailed: 0,
    lastActivityAt: '2026-01-01T00:01:00.000Z',
    batchJson: null,
  });
};

const embedding = Array.from({ length: 128 }, (_, index) => index / 128);

const buildArtifacts = (fs: InMemoryFileSystem): void => {
  fs.addFile('/manifest.ndjson', { content: `${JSON.stringify({ path: 'photos/a.jpg', size: 10, mtime: 0, md5 })}\n` });
  fs.addFile('/artifacts/descriptions.ndjson', {
    content: `${JSON.stringify({ md5, descPl: 'Zachod slonca', tags: ['sky', 'sunset'], scene: 'portrait', quality: 'ok' })}\n`,
  });
  fs.addFile('/artifacts/faces.ndjson', {
    content: [
      JSON.stringify({
        md5,
        obsId: `${md5}:face:1`,
        bbox: { x: 1, y: 2, width: 10, height: 10 },
        score: 0.9,
        embedding,
      }),
    ].join('\n'),
  });
  fs.addFile('/artifacts/geo.ndjson', {
    content: `${JSON.stringify({ path: 'photos/a.jpg', lat: 10, lon: 20, placeId: null, semanticType: 'Unknown', source: 'visit', confidence: 'high' })}\n`,
  });
};

describe('runPhotoImportLibra', () => {
  it('joins by manifest path, imports description/tags, faces and geo, and marks the face index complete', async () => {
    const fs = new InMemoryFileSystem('/work');
    buildArtifacts(fs);
    const photos = new InMemoryPhotosStore();
    await setupScannedPhoto(photos);
    const globalCatalog = new InMemoryGlobalCatalogStore();

    const result = await runPhotoImportLibra(
      { fs, photos, globalCatalog },
      { artifactsDir: '/artifacts', manifestPath: '/manifest.ndjson', dryRun: false },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.manifest).toMatchObject({ entries: 1, matched: 1, unmatched: 0 });
    expect(result.value.descriptions).toMatchObject({ entries: 1, imported: 1, unmatched: 0 });
    expect(result.value.faces).toMatchObject({ entries: 1, imported: 1, unmatched: 0, photosCompleted: 1 });
    expect(result.value.geo).toMatchObject({ written: 1, unmatched: 0 });

    const configId = photoConfigId(buildImportedPhotoConfigDescriptor());
    const variants = await photos.listPhotoVariants(fingerprint);
    expect(variants.ok).toBe(true);
    if (!variants.ok) return;
    expect(variants.value).toEqual([expect.objectContaining({
      configId,
      description: 'Zachod slonca',
      scene: 'people',
      quality: 'good',
      tags: ['sky', 'sunset'],
      analyzer: 'imported',
      selected: true,
    })]);

    const selected = await photos.resolveSelectedConfigId(fingerprint);
    expect(selected.ok && selected.value).toBe(configId);

    const observations = await globalCatalog.listFaceObservations({ fingerprint });
    expect(observations.ok).toBe(true);
    if (!observations.ok) return;
    expect(observations.value).toEqual([expect.objectContaining({
      obsId: `${fingerprint}:face:1:1`,
      fingerprint,
      personId: null,
      media: 'photo',
    })]);

    const stored = await photos.getPhoto(fingerprint);
    expect(stored.ok && stored.value?.gpsLat).toBe(10);
    expect(stored.ok && stored.value?.gpsSource).toBe('timeline');
  });

  it('dry-run reports matches without writing anything', async () => {
    const fs = new InMemoryFileSystem('/work');
    buildArtifacts(fs);
    const photos = new InMemoryPhotosStore();
    await setupScannedPhoto(photos);
    const globalCatalog = new InMemoryGlobalCatalogStore();

    const result = await runPhotoImportLibra(
      { fs, photos, globalCatalog },
      { artifactsDir: '/artifacts', manifestPath: '/manifest.ndjson', dryRun: true },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.descriptions.imported).toBe(1);
    expect(result.value.faces.imported).toBe(1);

    const variants = await photos.listPhotoVariants(fingerprint);
    expect(variants.ok && variants.value).toEqual([]);
    const observations = await globalCatalog.listFaceObservations({ fingerprint });
    expect(observations.ok && observations.value).toEqual([]);
  });

  it('never overrides an existing live analysis selection', async () => {
    const fs = new InMemoryFileSystem('/work');
    buildArtifacts(fs);
    const photos = new InMemoryPhotosStore();
    await setupScannedPhoto(photos);
    const liveConfigId = 'cfg_live00000';
    await photos.upsertAnalysisConfig({ configId: liveConfigId, descriptorJson: '{}', label: 'live', now: '2026-06-01T00:00:00.000Z' });
    await photos.recordPhotoAnalysis({
      fingerprint,
      configId: liveConfigId,
      description: 'Live description',
      scene: 'other',
      quality: 'good',
      language: 'en',
      analyzer: 'api',
      model: 'gpt-5.5',
      batchSize: 12,
      usageJson: null,
      tags: ['live'],
      createdAt: '2026-06-01T00:00:00.000Z',
    });
    const globalCatalog = new InMemoryGlobalCatalogStore();

    const result = await runPhotoImportLibra(
      { fs, photos, globalCatalog },
      { artifactsDir: '/artifacts', manifestPath: '/manifest.ndjson', dryRun: false },
    );
    expect(result.ok).toBe(true);

    const selected = await photos.resolveSelectedConfigId(fingerprint);
    expect(selected.ok && selected.value).toBe(liveConfigId);
  });

  it('is idempotent across re-runs', async () => {
    const fs = new InMemoryFileSystem('/work');
    buildArtifacts(fs);
    const photos = new InMemoryPhotosStore();
    await setupScannedPhoto(photos);
    const globalCatalog = new InMemoryGlobalCatalogStore();
    const deps = { fs, photos, globalCatalog };
    const input = { artifactsDir: '/artifacts', manifestPath: '/manifest.ndjson', dryRun: false };

    await runPhotoImportLibra(deps, input);
    const second = await runPhotoImportLibra(deps, input);

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.geo.unchanged).toBe(1);
    const variants = await photos.listPhotoVariants(fingerprint);
    expect(variants.ok && variants.value).toHaveLength(1);
    const observations = await globalCatalog.listFaceObservations({ fingerprint });
    expect(observations.ok && observations.value).toHaveLength(1);
  });

  it('reports unmatched manifest entries without guessing and never writes for them', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addFile('/manifest.ndjson', { content: `${JSON.stringify({ path: 'photos/missing.jpg', size: 1, mtime: 0, md5 })}\n` });
    fs.addFile('/artifacts/descriptions.ndjson', {
      content: `${JSON.stringify({ md5, descPl: 'X', tags: ['x'], scene: 'other', quality: 'ok' })}\n`,
    });
    const photos = new InMemoryPhotosStore();
    await setupScannedPhoto(photos);
    const globalCatalog = new InMemoryGlobalCatalogStore();

    const result = await runPhotoImportLibra(
      { fs, photos, globalCatalog },
      { artifactsDir: '/artifacts', manifestPath: '/manifest.ndjson', dryRun: false },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.manifest).toMatchObject({ matched: 0, unmatched: 1 });
    expect(result.value.descriptions).toMatchObject({ imported: 0, unmatched: 1 });
    const variants = await photos.listPhotoVariants(fingerprint);
    expect(variants.ok && variants.value).toEqual([]);
  });

  it('skips face entries missing bbox or embedding rather than fabricating them', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addFile('/manifest.ndjson', { content: `${JSON.stringify({ path: 'photos/a.jpg', size: 10, mtime: 0, md5 })}\n` });
    fs.addFile('/artifacts/faces.ndjson', { content: `${JSON.stringify({ md5, obsId: `${md5}:face:1` })}\n` });
    const photos = new InMemoryPhotosStore();
    await setupScannedPhoto(photos);
    const globalCatalog = new InMemoryGlobalCatalogStore();

    const result = await runPhotoImportLibra(
      { fs, photos, globalCatalog },
      { artifactsDir: '/artifacts', manifestPath: '/manifest.ndjson', dryRun: false },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.faces).toMatchObject({ imported: 0, skippedIncomplete: 1, photosCompleted: 1 });
  });

  it('counts a geo row libra could not resolve as an unsupported source, not a corrupt line', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addFile('/manifest.ndjson', { content: `${JSON.stringify({ path: 'photos/a.jpg', size: 10, mtime: 0, md5 })}\n` });
    fs.addFile('/artifacts/geo.ndjson', {
      content: `${JSON.stringify({ path: 'photos/a.jpg', lat: null, lon: null, placeId: null, semanticType: null, source: null, confidence: null })}\n`,
    });
    const photos = new InMemoryPhotosStore();
    await setupScannedPhoto(photos);
    const globalCatalog = new InMemoryGlobalCatalogStore();

    const result = await runPhotoImportLibra(
      { fs, photos, globalCatalog },
      { artifactsDir: '/artifacts', manifestPath: '/manifest.ndjson', dryRun: false },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.geo).toMatchObject({ entries: 1, invalidLines: 0, written: 0, skippedUnsupportedSource: 1 });
    const stored = await photos.getPhoto(fingerprint);
    expect(stored.ok && stored.value?.gpsLat).toBe(null);
  });

  it('fails with prerequisites_failed when no photo root has been scanned', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addFile('/manifest.ndjson', { content: '' });
    const photos = new InMemoryPhotosStore();
    const globalCatalog = new InMemoryGlobalCatalogStore();

    const result = await runPhotoImportLibra(
      { fs, photos, globalCatalog },
      { artifactsDir: '/artifacts', manifestPath: '/manifest.ndjson', dryRun: false },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('prerequisites_failed');
  });
});
