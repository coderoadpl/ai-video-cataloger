import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { CatalogAnalysis, CatalogFile, CatalogFolder } from '@core/domain/index.js';
import { libraryCollection, type CollectionFiltersInput, type PhotoFolderRecord, type PhotoRecord } from '@core/server/index.js';

import { SqlJsGlobalCatalogStore } from '@adapters/db/global-catalog.js';
import { SqlJsPhotosStore } from '@adapters/db/photos-store.js';
import { InMemoryFileSystem, InMemoryMedia } from '../../../test/server/usecases/test-fakes.js';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const tempHome = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'avc-collection-real-stores-'));
  tempRoots.push(root);
  return root;
};

const EMPTY_FILTERS: CollectionFiltersInput = {
  tags: [],
  people: [],
  place: null,
  from: null,
  to: null,
  hasGps: null,
  folderId: null,
};

const videoFolder: CatalogFolder = {
  folderId: '33333333-3333-4333-8333-333333333333',
  currentPath: '/media/videos',
  displayName: 'videos',
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
};

const photoFolder: PhotoFolderRecord = {
  folderId: 'path-bbbbbbbb',
  currentPath: '/media/photos',
  displayName: 'photos',
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
  defaultConfigId: null,
};

const video = (fingerprint: string, capturedAt: string | null, fileName: string): CatalogFile => ({
  fingerprint,
  folderId: videoFolder.folderId,
  fileName,
  size: 100,
  durationS: null,
  gpsLat: null,
  gpsLon: null,
  processedAt: '2026-01-02T00:00:00.000Z',
  analyzer: null,
  model: null,
  missingAt: null,
  capturedAt,
  capturedAtSource: null,
  gpsSource: null,
  gpsAccuracyM: null,
  gpsIntervalKind: null,
  gpsResolvedAt: null,
  place: null,
});

const videoAnalysis = (fingerprint: string, finalName: string): CatalogAnalysis => ({
  fingerprint,
  finalName,
  description: 'a video',
  transcript: '',
  language: null,
  tags: [],
});

const photo = (fingerprint: string, capturedAt: string | null, fileName: string): PhotoRecord => ({
  fingerprint,
  folderId: photoFolder.folderId,
  fileName,
  currentPath: `/media/photos/${fileName}`,
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
  capturedAt,
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
});

const buildDeps = async () => {
  const home = await tempHome();
  const globalCatalog = new SqlJsGlobalCatalogStore({ homeDirectory: home });
  const photos = new SqlJsPhotosStore({ homeDirectory: home });
  const fs = new InMemoryFileSystem('/media');
  fs.addDirectory(videoFolder.currentPath);
  fs.addDirectory(photoFolder.currentPath);
  const media = new InMemoryMedia();
  return { deps: { globalCatalog, photos, fs, media }, globalCatalog, photos };
};

describe('libraryCollection against real SqlJsGlobalCatalogStore + SqlJsPhotosStore', () => {
  it('pins cross-source ordering in browse mode (captured_desc, video-before-photo on tie)', async () => {
    const { deps, globalCatalog, photos } = await buildDeps();
    await globalCatalog.upsertFolder(videoFolder);
    await globalCatalog.upsertFile(video('v1', '2026-01-03T00:00:00.000Z', 'v1.mp4'));
    await globalCatalog.upsertFile(video('v2', '2026-01-01T00:00:00.000Z', 'v2.mp4'));
    await photos.upsertFolder(photoFolder);
    await photos.upsertPhoto(photo('p1', '2026-01-02T00:00:00.000Z', 'p1.jpg'));

    const result = await libraryCollection(deps, {
      query: null, filters: EMPTY_FILTERS, sort: undefined, media: 'all', limit: 50, cursor: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.map((item) => item.fingerprint)).toEqual(['v1', 'p1', 'v2']);
    expect(result.value.videoTotal).toBe(2);
    expect(result.value.photoTotal).toBe(1);
    expect(result.value.total).toBe(3);
    expect(result.value.nextCursor).toBeNull();
  });

  it('pins cross-source ordering in match mode (per-source relevance rank, video-first on tie)', async () => {
    const { deps, globalCatalog, photos } = await buildDeps();
    await globalCatalog.upsertFolder(videoFolder);
    await globalCatalog.upsertFile(video('v1', null, 'drone-shot.mp4'));
    await globalCatalog.upsertAnalysis(videoAnalysis('v1', 'drone-shot.mp4'));
    await photos.upsertFolder(photoFolder);
    await photos.upsertPhoto(photo('p1', null, 'drone-photo.jpg'));

    const result = await libraryCollection(deps, {
      query: 'drone', filters: EMPTY_FILTERS, sort: undefined, media: 'all', limit: 50, cursor: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.map((item) => item.fingerprint).sort()).toEqual(['p1', 'v1']);
    expect(result.value.items[0]?.media).toBe('video');
  });

  it('merges name_asc in the stores\' binary collation, so the feed matches each leg\'s own order', async () => {
    const { deps, globalCatalog, photos } = await buildDeps();
    await globalCatalog.upsertFolder(videoFolder);
    await globalCatalog.upsertFile(video('v1', null, 'Beta.mp4'));
    await globalCatalog.upsertFile(video('v2', null, 'delta.mp4'));
    await photos.upsertFolder(photoFolder);
    await photos.upsertPhoto(photo('p1', null, 'Gamma.jpg'));
    await photos.upsertPhoto(photo('p2', null, 'alpha.jpg'));

    const result = await libraryCollection(deps, {
      query: null, filters: EMPTY_FILTERS, sort: 'name_asc', media: 'all', limit: 50, cursor: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.map((item) => item.fileName)).toEqual(['Beta.mp4', 'Gamma.jpg', 'alpha.jpg', 'delta.mp4']);
  });

  it('merges an explicit name_asc in match mode in the same collation', async () => {
    const { deps, globalCatalog, photos } = await buildDeps();
    await globalCatalog.upsertFolder(videoFolder);
    await globalCatalog.upsertFile(video('v1', null, 'Drone-Beta.mp4'));
    await globalCatalog.upsertAnalysis(videoAnalysis('v1', 'Drone-Beta.mp4'));
    await photos.upsertFolder(photoFolder);
    await photos.upsertPhoto(photo('p1', null, 'Drone-Alpha.jpg'));
    await photos.upsertPhoto(photo('p2', null, 'drone-zulu.jpg'));

    const result = await libraryCollection(deps, {
      query: 'drone', filters: EMPTY_FILTERS, sort: 'name_asc', media: 'all', limit: 50, cursor: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.map((item) => item.fileName)).toEqual(['Drone-Alpha.jpg', 'Drone-Beta.mp4', 'drone-zulu.jpg']);
  });

  it('breaks a cross-source captured_at tie by file name, the way each store breaks its own', async () => {
    const { deps, globalCatalog, photos } = await buildDeps();
    const capturedAt = '2026-01-02T00:00:00.000Z';
    await globalCatalog.upsertFolder(videoFolder);
    await globalCatalog.upsertFile(video('v1', capturedAt, 'b.mp4'));
    await photos.upsertFolder(photoFolder);
    await photos.upsertPhoto(photo('p1', capturedAt, 'a.jpg'));
    await photos.upsertPhoto(photo('p2', capturedAt, 'c.jpg'));

    const result = await libraryCollection(deps, {
      query: null, filters: EMPTY_FILTERS, sort: 'captured_desc', media: 'all', limit: 50, cursor: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.map((item) => item.fileName)).toEqual(['a.jpg', 'b.mp4', 'c.jpg']);
  });
});
