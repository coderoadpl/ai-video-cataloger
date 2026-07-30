import { describe, expect, it, vi } from 'vitest';

import { appError, type CatalogAnalysis, type CatalogFile, type CatalogFolder } from '@core/domain/index.js';
import type { PhotoFolderRecord, PhotoRecord } from '../ports.js';

import { InMemoryFileSystem, InMemoryGlobalCatalogStore, InMemoryPhotosStore } from '../../../test/server/usecases/test-fakes.js';
import { catalogLocations } from './catalog-locations.js';

const folderA: CatalogFolder = {
  folderId: '11111111-1111-4111-8111-111111111111',
  currentPath: '/media/online',
  displayName: 'online',
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
};

const folderB: CatalogFolder = {
  folderId: '22222222-2222-4222-8222-222222222222',
  currentPath: '/media/offline',
  displayName: 'offline',
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
};

const file = (fingerprint: string, folderId: string, fileName: string, gps: { lat: number; lon: number } | null = null): CatalogFile => ({
  fingerprint,
  folderId,
  fileName,
  size: 100,
  durationS: null,
  gpsLat: gps?.lat ?? null,
  gpsLon: gps?.lon ?? null,
  processedAt: '2026-01-02T00:00:00.000Z',
  analyzer: null,
  model: null,
  missingAt: null,
  capturedAt: null,
  capturedAtSource: null,
  gpsSource: null,
  gpsAccuracyM: null,
  gpsIntervalKind: null,
  gpsResolvedAt: null,
  place: null,
});

const analysis = (fingerprint: string, finalName: string | null): CatalogAnalysis => ({
  fingerprint,
  finalName,
  description: null,
  transcript: null,
  language: null,
  tags: [],
});

const photoFolder: PhotoFolderRecord = {
  folderId: 'path-aaaaaaaa',
  currentPath: '/media/photos',
  displayName: 'photos',
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
  defaultConfigId: null,
};

const photo = (fingerprint: string, fileName: string, gps: { lat: number; lon: number } | null = null): PhotoRecord => ({
  fingerprint,
  folderId: photoFolder.folderId,
  fileName,
  currentPath: `${photoFolder.currentPath}/${fileName}`,
  ext: 'jpg',
  size: 100,
  width: null,
  height: null,
  orientation: null,
  cameraMake: null,
  cameraModel: null,
  lens: null,
  iso: null,
  fNumber: null,
  exposureTime: null,
  exifRating: null,
  capturedAt: null,
  capturedAtSource: null,
  gpsLat: gps?.lat ?? null,
  gpsLon: gps?.lon ?? null,
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

describe('catalogLocations', () => {
  it('returns an empty snapshot for an empty catalog', async () => {
    const globalCatalog = new InMemoryGlobalCatalogStore();
    const photos = new InMemoryPhotosStore();
    const fs = new InMemoryFileSystem();

    const result = await catalogLocations({ globalCatalog, photos, fs });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ totalFiles: 0, locatedFiles: 0, totalPhotos: 0, locatedPhotos: 0, locations: [] });
  });

  it('returns only files that carry GPS, with the catalog total', async () => {
    const globalCatalog = new InMemoryGlobalCatalogStore();
    const photos = new InMemoryPhotosStore();
    const fs = new InMemoryFileSystem();
    fs.addDirectory(folderA.currentPath);
    await globalCatalog.upsertFolder(folderA);
    await globalCatalog.upsertFile(file('fp-1', folderA.folderId, 'clip.mp4', { lat: 50, lon: 19 }));
    await globalCatalog.upsertFile(file('fp-2', folderA.folderId, 'no-gps.mp4'));
    await globalCatalog.upsertFile(file('fp-3', folderA.folderId, 'other.mp4'));
    await globalCatalog.upsertAnalysis(analysis('fp-1', 'drone-clip.mp4'));

    const result = await catalogLocations({ globalCatalog, photos, fs });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totalFiles).toBe(3);
    expect(result.value.locatedFiles).toBe(1);
    expect(result.value.locations).toEqual([{
      fingerprint: 'fp-1',
      media: 'video',
      fileName: 'clip.mp4',
      finalName: 'drone-clip.mp4',
      thumbPath: null,
      lat: 50,
      lon: 19,
      missing: false,
      folder: { folderId: folderA.folderId, currentPath: folderA.currentPath, displayName: folderA.displayName, online: true },
      source: null,
      accuracyM: null,
      intervalKind: null,
      place: null,
    }]);
  });

  it('marks a folder offline when its path is absent on disk', async () => {
    const globalCatalog = new InMemoryGlobalCatalogStore();
    const photos = new InMemoryPhotosStore();
    const fs = new InMemoryFileSystem();
    await globalCatalog.upsertFolder(folderB);
    await globalCatalog.upsertFile(file('fp-1', folderB.folderId, 'clip.mp4', { lat: 1, lon: 1 }));

    const result = await catalogLocations({ globalCatalog, photos, fs });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.locations[0]?.folder.online).toBe(false);
  });

  it('flags a file marked missing', async () => {
    const globalCatalog = new InMemoryGlobalCatalogStore();
    const photos = new InMemoryPhotosStore();
    const fs = new InMemoryFileSystem();
    fs.addDirectory(folderA.currentPath);
    await globalCatalog.upsertFolder(folderA);
    await globalCatalog.upsertFile({ ...file('fp-1', folderA.folderId, 'clip.mp4', { lat: 1, lon: 1 }), missingAt: 100 });

    const result = await catalogLocations({ globalCatalog, photos, fs });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.locations[0]?.missing).toBe(true);
  });

  it('resolves folder online-ness once per folder, not once per row', async () => {
    const globalCatalog = new InMemoryGlobalCatalogStore();
    const photos = new InMemoryPhotosStore();
    const fs = new InMemoryFileSystem();
    fs.addDirectory(folderA.currentPath);
    await globalCatalog.upsertFolder(folderA);
    await globalCatalog.upsertFile(file('fp-1', folderA.folderId, 'a.mp4', { lat: 1, lon: 1 }));
    await globalCatalog.upsertFile(file('fp-2', folderA.folderId, 'b.mp4', { lat: 2, lon: 2 }));
    await globalCatalog.upsertFile(file('fp-3', folderA.folderId, 'c.mp4', { lat: 3, lon: 3 }));
    const existsSpy = vi.spyOn(fs, 'exists');

    const result = await catalogLocations({ globalCatalog, photos, fs });

    expect(result.ok).toBe(true);
    expect(existsSpy).toHaveBeenCalledTimes(1);
  });

  it('propagates a store error without throwing', async () => {
    const globalCatalog = new InMemoryGlobalCatalogStore();
    const photos = new InMemoryPhotosStore();
    const fs = new InMemoryFileSystem();
    vi.spyOn(globalCatalog, 'listLocations').mockResolvedValueOnce({
      ok: false,
      error: appError('not_found', 'boom'),
    });

    const result = await catalogLocations({ globalCatalog, photos, fs });

    expect(result.ok).toBe(false);
  });

  it('merges video and photo locations: video-only totals stay video-only, photo totals arrive separately, video rows come first', async () => {
    const globalCatalog = new InMemoryGlobalCatalogStore();
    const photos = new InMemoryPhotosStore();
    const fs = new InMemoryFileSystem();
    fs.addDirectory(folderA.currentPath);
    fs.addDirectory(photoFolder.currentPath);
    await globalCatalog.upsertFolder(folderA);
    await globalCatalog.upsertFile(file('fp-video-1', folderA.folderId, 'a.mp4', { lat: 1, lon: 1 }));
    await globalCatalog.upsertFile(file('fp-video-2', folderA.folderId, 'b.mp4', { lat: 2, lon: 2 }));
    await photos.upsertFolder(photoFolder);
    await photos.upsertPhoto(photo('fp-photo-1', 'a.jpg', { lat: 3, lon: 3 }));
    await photos.upsertPhoto(photo('fp-photo-2', 'b.jpg', { lat: 4, lon: 4 }));
    await photos.upsertPhoto(photo('fp-photo-3', 'no-gps.jpg'));

    const result = await catalogLocations({ globalCatalog, photos, fs });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totalFiles).toBe(2);
    expect(result.value.locatedFiles).toBe(2);
    expect(result.value.totalPhotos).toBe(3);
    expect(result.value.locatedPhotos).toBe(2);
    expect(result.value.locations.map((location) => location.media)).toEqual(['video', 'video', 'photo', 'photo']);
    const photoLocation = result.value.locations.find((location) => location.fingerprint === 'fp-photo-1');
    expect(photoLocation).toMatchObject({ media: 'photo', finalName: null, fileName: 'a.jpg', lat: 3, lon: 3 });
  });

  it('propagates a photo store error without throwing', async () => {
    const globalCatalog = new InMemoryGlobalCatalogStore();
    const photos = new InMemoryPhotosStore();
    const fs = new InMemoryFileSystem();
    vi.spyOn(photos, 'listPhotoLocations').mockResolvedValueOnce({
      ok: false,
      error: appError('not_found', 'boom'),
    });

    const result = await catalogLocations({ globalCatalog, photos, fs });

    expect(result.ok).toBe(false);
  });
});
