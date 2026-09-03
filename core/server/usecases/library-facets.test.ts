import { describe, expect, it } from 'vitest';

import type { CatalogFile, CatalogFolder } from '@core/domain/index.js';

import { InMemoryFileSystem, InMemoryGlobalCatalogStore, InMemoryPhotosStore } from '../../../test/server/usecases/test-fakes.js';
import { libraryFacets } from './library-facets.js';

const folderOnline: CatalogFolder = {
  folderId: '11111111-1111-4111-8111-111111111111',
  currentPath: '/media/online',
  displayName: 'online',
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
};

const folderOffline: CatalogFolder = {
  folderId: '22222222-2222-4222-8222-222222222222',
  currentPath: '/media/offline',
  displayName: 'offline',
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
};

const file = (fingerprint: string, folderId: string): CatalogFile => ({
  fingerprint,
  folderId,
  fileName: `${fingerprint}.mp4`,
  size: 100,
  durationS: null,
  width: null,
  height: null,
  gpsLat: null,
  gpsLon: null,
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

const personRecord = (personId: string, displayName: string | null) => ({
  personId,
  displayName,
  kind: 'face' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  centroid: [],
  exemplarCount: 0,
});

const deps = (globalCatalog: InMemoryGlobalCatalogStore, fs: InMemoryFileSystem) => ({
  globalCatalog,
  fs,
  photos: new InMemoryPhotosStore(),
});

describe('libraryFacets people ordering', () => {
  it('attaches the People-surface index to unnamed people and sorts named first, then unnamed by that index', async () => {
    const globalCatalog = new InMemoryGlobalCatalogStore();
    const fs = new InMemoryFileSystem();
    await globalCatalog.upsertFolder(folderOnline);
    await globalCatalog.upsertFile(file('fp-1', folderOnline.folderId));
    await globalCatalog.upsertFile(file('fp-2', folderOnline.folderId));
    await globalCatalog.upsertFile(file('fp-3', folderOnline.folderId));
    await globalCatalog.upsertPerson(personRecord('p-unnamed-a', null));
    await globalCatalog.upsertPerson(personRecord('p-named', 'Alex'));
    await globalCatalog.upsertPerson(personRecord('p-unnamed-b', null));
    await globalCatalog.upsertFaceObservation({
      obsId: 'o1', fingerprint: 'fp-1', kind: 'face', frameTsS: 1,
      bbox: { x: 0, y: 0, width: 1, height: 1 }, embedding: [], quality: 0.9,
      personId: 'p-unnamed-a', cropPath: null, media: 'video',
    });
    await globalCatalog.upsertFaceObservation({
      obsId: 'o2', fingerprint: 'fp-2', kind: 'face', frameTsS: 1,
      bbox: { x: 0, y: 0, width: 1, height: 1 }, embedding: [], quality: 0.9,
      personId: 'p-named', cropPath: null, media: 'video',
    });
    await globalCatalog.upsertFaceObservation({
      obsId: 'o3', fingerprint: 'fp-3', kind: 'face', frameTsS: 1,
      bbox: { x: 0, y: 0, width: 1, height: 1 }, embedding: [], quality: 0.9,
      personId: 'p-unnamed-b', cropPath: null, media: 'video',
    });

    const result = await libraryFacets(deps(globalCatalog, fs));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.people.map((person) => person.personId)).toEqual(['p-named', 'p-unnamed-a', 'p-unnamed-b']);
    expect(result.value.people.find((person) => person.personId === 'p-unnamed-a')?.fallbackIndex).toBe(0);
    expect(result.value.people.find((person) => person.personId === 'p-unnamed-b')?.fallbackIndex).toBe(2);
  });
});

describe('libraryFacets', () => {
  it('returns empty facets and zero counts for an empty catalog', async () => {
    const globalCatalog = new InMemoryGlobalCatalogStore();
    const fs = new InMemoryFileSystem();

    const result = await libraryFacets(deps(globalCatalog, fs));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      tags: [],
      people: [],
      places: [],
      years: [],
      folders: [],
      counts: { total: 0, withGps: 0, withoutCaptureDate: 0, missing: 0, hidden: 0, offlineFolders: 0 },
    });
  });

  it('counts a folder as offline when its path is absent on disk', async () => {
    const globalCatalog = new InMemoryGlobalCatalogStore();
    const fs = new InMemoryFileSystem();
    fs.addDirectory(folderOnline.currentPath);
    await globalCatalog.upsertFolder(folderOnline);
    await globalCatalog.upsertFolder(folderOffline);
    await globalCatalog.upsertFile(file('fp-1', folderOnline.folderId));
    await globalCatalog.upsertFile(file('fp-2', folderOffline.folderId));

    const result = await libraryFacets(deps(globalCatalog, fs));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.counts.offlineFolders).toBe(1);
    expect(result.value.counts.total).toBe(2);
  });

  it('facets every catalogued folder with its persisted id, path, online flag and file count', async () => {
    const globalCatalog = new InMemoryGlobalCatalogStore();
    const fs = new InMemoryFileSystem();
    fs.addDirectory(folderOnline.currentPath);
    await globalCatalog.upsertFolder(folderOnline);
    await globalCatalog.upsertFolder(folderOffline);
    await globalCatalog.upsertFile(file('fp-1', folderOnline.folderId));
    await globalCatalog.upsertFile(file('fp-2', folderOnline.folderId));

    const result = await libraryFacets(deps(globalCatalog, fs));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.folders).toEqual([
      { folderId: folderOffline.folderId, displayName: 'offline', currentPath: '/media/offline', online: false, count: 0 },
      { folderId: folderOnline.folderId, displayName: 'online', currentPath: '/media/online', online: true, count: 2 },
    ]);
  });
});
