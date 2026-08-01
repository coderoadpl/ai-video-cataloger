import { describe, expect, it } from 'vitest';

import type { CatalogAnalysis, CatalogFile, CatalogFolder } from '@core/domain/index.js';
import type { PhotoFolderRecord, PhotoRecord } from '../ports.js';

import {
  compareCollectionItems,
  decodeCollectionCursor,
  encodeCollectionCursor,
  libraryCollection,
  type CollectionFiltersInput,
} from './collection.js';
import { InMemoryFileSystem, InMemoryGlobalCatalogStore, InMemoryMedia, InMemoryPhotosStore } from '../../../test/server/usecases/test-fakes.js';

const EMPTY_FILTERS: CollectionFiltersInput = {
  tags: [],
  people: [],
  place: null,
  from: null,
  to: null,
  hasGps: null,
  folderId: null,
};

const folderA: CatalogFolder = {
  folderId: '11111111-1111-4111-8111-111111111111',
  currentPath: '/media/videos',
  displayName: 'videos',
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
};

const photoFolder: PhotoFolderRecord = {
  folderId: 'path-aaaaaaaa',
  currentPath: '/media/photos',
  displayName: 'photos',
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
  defaultConfigId: null,
};

const video = (fingerprint: string, capturedAt: string | null, fileName = `${fingerprint}.mp4`): CatalogFile => ({
  fingerprint,
  folderId: folderA.folderId,
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

const videoAnalysis = (fingerprint: string): CatalogAnalysis => ({
  fingerprint,
  finalName: null,
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

const buildDeps = () => {
  const fs = new InMemoryFileSystem('/media');
  fs.addDirectory('/media/videos');
  fs.addDirectory('/media/photos');
  const globalCatalog = new InMemoryGlobalCatalogStore();
  const photos = new InMemoryPhotosStore();
  const media = new InMemoryMedia();
  return { deps: { globalCatalog, photos, fs, media }, globalCatalog, photos, fs, media };
};

describe('compareCollectionItems', () => {
  const video = (capturedAt: string | null, fingerprint = 'v') => ({ media: 'video' as const, capturedAt, displayName: 'v.mp4', fileName: 'v.mp4', fingerprint });
  const photo = (capturedAt: string | null, fingerprint = 'p') => ({ media: 'photo' as const, capturedAt, displayName: 'p.jpg', fileName: 'p.jpg', fingerprint });

  it('sorts captured_desc newest first, nulls last', () => {
    expect(compareCollectionItems('captured_desc', video('2026-01-02T00:00:00.000Z'), photo('2026-01-01T00:00:00.000Z'))).toBeLessThan(0);
    expect(compareCollectionItems('captured_desc', video(null), photo('2026-01-01T00:00:00.000Z'))).toBeGreaterThan(0);
  });

  it('sorts captured_asc oldest first, nulls last', () => {
    expect(compareCollectionItems('captured_asc', video('2026-01-01T00:00:00.000Z'), photo('2026-01-02T00:00:00.000Z'))).toBeLessThan(0);
    expect(compareCollectionItems('captured_asc', video(null), photo('2026-01-01T00:00:00.000Z'))).toBeGreaterThan(0);
  });

  it('breaks a captured_at tie by file name first, the way both stores order their own leg', () => {
    const early = { ...video('2026-01-01T00:00:00.000Z', 'z'), fileName: 'a.mp4' };
    const late = { ...photo('2026-01-01T00:00:00.000Z', 'a'), fileName: 'b.jpg' };
    expect(compareCollectionItems('captured_desc', early, late)).toBeLessThan(0);
    expect(compareCollectionItems('captured_desc', late, early)).toBeGreaterThan(0);
  });

  it('breaks a captured_at and file-name tie video-before-photo, then by fingerprint', () => {
    const sameName = (fingerprint: string, media: 'video' | 'photo') => ({
      ...(media === 'video' ? video('2026-01-01T00:00:00.000Z', fingerprint) : photo('2026-01-01T00:00:00.000Z', fingerprint)),
      fileName: 'same.bin',
      displayName: 'same.bin',
    });
    expect(compareCollectionItems('captured_desc', sameName('z', 'video'), sameName('a', 'photo'))).toBeLessThan(0);
    expect(compareCollectionItems('captured_desc', sameName('a', 'video'), sameName('b', 'video'))).toBeLessThan(0);
  });

  it('sorts name_asc by displayName in the stores\' binary collation, uppercase before lowercase', () => {
    expect(compareCollectionItems('name_asc', { ...video(null), displayName: 'a' }, { ...photo(null), displayName: 'b' })).toBeLessThan(0);
    expect(compareCollectionItems('name_asc', { ...video(null), displayName: 'Gamma.mp4' }, { ...photo(null), displayName: 'alpha.jpg' })).toBeLessThan(0);
  });
});

describe('collection cursor', () => {
  it('round-trips through base64url JSON', () => {
    const encoded = encodeCollectionCursor({ v: 1, video: 3, photo: 5 });
    const decoded = decodeCollectionCursor(encoded);
    expect(decoded).toEqual({ ok: true, value: { v: 1, video: 3, photo: 5 } });
  });

  it('rejects malformed and negative cursors as validation errors', () => {
    expect(decodeCollectionCursor('not-base64-json')).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(decodeCollectionCursor(Buffer.from(JSON.stringify({ v: 2, video: 0, photo: 0 })).toString('base64url')))
      .toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(decodeCollectionCursor(Buffer.from(JSON.stringify({ v: 1, video: -1, photo: 0 })).toString('base64url')))
      .toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});

describe('libraryCollection', () => {
  it('interleaves video and photo browse rows by captured_desc, nulls-last, and reports per-media totals', async () => {
    const { deps, globalCatalog, photos } = buildDeps();
    await globalCatalog.upsertFolder(folderA);
    await globalCatalog.upsertFile(video('v1', '2026-01-03T00:00:00.000Z'));
    await globalCatalog.upsertFile(video('v2', '2026-01-01T00:00:00.000Z'));
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

  it('paginates with no duplicates and no gaps across two pages', async () => {
    const { deps, globalCatalog, photos } = buildDeps();
    await globalCatalog.upsertFolder(folderA);
    await photos.upsertFolder(photoFolder);
    for (let index = 0; index < 3; index += 1) {
      await globalCatalog.upsertFile(video(`v${String(index)}`, `2026-01-0${String(index + 1)}T00:00:00.000Z`));
      await photos.upsertPhoto(photo(`p${String(index)}`, `2026-01-0${String(index + 1)}T12:00:00.000Z`, `p${String(index)}.jpg`));
    }

    const page1 = await libraryCollection(deps, { query: null, filters: EMPTY_FILTERS, sort: undefined, media: 'all', limit: 3, cursor: null });
    expect(page1.ok).toBe(true);
    if (!page1.ok) return;
    expect(page1.value.nextCursor).not.toBeNull();

    const page2 = await libraryCollection(deps, {
      query: null, filters: EMPTY_FILTERS, sort: undefined, media: 'all', limit: 3, cursor: page1.value.nextCursor,
    });
    expect(page2.ok).toBe(true);
    if (!page2.ok) return;

    const allIds = [...page1.value.items, ...page2.value.items].map((item) => item.fingerprint);
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(allIds).toHaveLength(6);
    expect(page2.value.nextCursor).toBeNull();
  });

  it('short-circuits the disabled source when media is video or photo', async () => {
    const { deps, globalCatalog, photos } = buildDeps();
    await globalCatalog.upsertFolder(folderA);
    await globalCatalog.upsertFile(video('v1', '2026-01-01T00:00:00.000Z'));
    await photos.upsertFolder(photoFolder);
    await photos.upsertPhoto(photo('p1', '2026-01-01T00:00:00.000Z', 'p1.jpg'));

    const videoOnly = await libraryCollection(deps, { query: null, filters: EMPTY_FILTERS, sort: undefined, media: 'video', limit: 50, cursor: null });
    expect(videoOnly.ok && videoOnly.value.items.map((item) => item.media)).toEqual(['video']);
    expect(videoOnly.ok && videoOnly.value.photoTotal).toBe(0);

    const photoOnly = await libraryCollection(deps, { query: null, filters: EMPTY_FILTERS, sort: undefined, media: 'photo', limit: 50, cursor: null });
    expect(photoOnly.ok && photoOnly.value.items.map((item) => item.media)).toEqual(['photo']);
    expect(photoOnly.ok && photoOnly.value.videoTotal).toBe(0);
  });

  it('zeroes the photo leg when a video-only filter (people/place/hasGps/folderId) is set', async () => {
    const { deps, globalCatalog, photos } = buildDeps();
    await globalCatalog.upsertFolder(folderA);
    await globalCatalog.upsertFile(video('v1', '2026-01-01T00:00:00.000Z'));
    await photos.upsertFolder(photoFolder);
    await photos.upsertPhoto(photo('p1', '2026-01-01T00:00:00.000Z', 'p1.jpg'));

    const result = await libraryCollection(deps, {
      query: null, filters: { ...EMPTY_FILTERS, hasGps: true }, sort: 'captured_desc', media: 'all', limit: 50, cursor: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.photoTotal).toBe(0);
    expect(result.value.items.every((item) => item.media === 'video')).toBe(true);
  });

  it('merges relevance results positionally by per-source rank, video-first on tie', async () => {
    const { deps, globalCatalog, photos } = buildDeps();
    await globalCatalog.upsertFolder(folderA);
    await globalCatalog.upsertFile(video('v1', null, 'drone-shot.mp4'));
    await globalCatalog.upsertAnalysis(videoAnalysis('v1'));
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

  it('honors an explicit non-relevance sort in match mode, merging both media in capture-date order', async () => {
    const { deps, globalCatalog, photos } = buildDeps();
    await globalCatalog.upsertFolder(folderA);
    await globalCatalog.upsertFile(video('v1', '2022-06-01T00:00:00.000Z', 'drone-shot.mp4'));
    await globalCatalog.upsertAnalysis(videoAnalysis('v1'));
    await photos.upsertFolder(photoFolder);
    await photos.upsertPhoto(photo('p-old', '2020-01-01T00:00:00.000Z', 'drone-photo-old.jpg'));
    await photos.upsertPhoto(photo('p-new', '2024-01-01T00:00:00.000Z', 'drone-photo-new.jpg'));

    const result = await libraryCollection(deps, {
      query: 'drone', filters: EMPTY_FILTERS, sort: 'captured_asc', media: 'all', limit: 50, cursor: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.map((item) => item.fingerprint)).toEqual(['p-old', 'v1', 'p-new']);
  });

  it('ranks photos in match mode by relevance score, not by capture date, when sort is relevance', async () => {
    const { deps, photos } = buildDeps();
    await photos.upsertFolder(photoFolder);
    await photos.upsertPhoto(photo('p-newer-weaker', '2024-01-01T00:00:00.000Z', 'drone.jpg'));
    await photos.upsertPhoto(photo('p-older-stronger', '2020-01-01T00:00:00.000Z', 'drone-drone.jpg'));

    const result = await libraryCollection(deps, {
      query: 'drone', filters: EMPTY_FILTERS, sort: 'relevance', media: 'photo', limit: 50, cursor: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.map((item) => item.fingerprint)).toEqual(['p-older-stronger', 'p-newer-weaker']);
  });

  it('rejects an explicit relevance sort without a query', async () => {
    const { deps } = buildDeps();

    const result = await libraryCollection(deps, { query: null, filters: EMPTY_FILTERS, sort: 'relevance', media: 'all', limit: 50, cursor: null });

    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});
