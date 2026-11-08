import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { derivedFolderId, type AppError, type Result } from '@core/domain/index.js';
import type { PhotoRecord, RootRelocationInput } from '@core/server/ports.js';

import { SqlJsGlobalCatalogStore } from './global-catalog.js';
import { SqlJsPhotosStore } from './photos-store.js';

const OLD_ROOT = '/Volumes/media';
const NEW_ROOT = '/Volumes/library';
const LOOKALIKE_ROOT = '/Volumes/media2';
const now = '2026-11-01T10:00:00.000Z';
const tempRoots: string[] = [];

const tempHome = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'avc-relocate-'));
  tempRoots.push(root);
  return root;
};

const value = <T>(result: Result<T, AppError>): T => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
};

const photo = (fingerprint: string, folderId: string, currentPath: string): PhotoRecord => ({
  fingerprint,
  folderId,
  fileName: path.basename(currentPath),
  currentPath,
  ext: 'jpg',
  size: 10,
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
  capturedAt: now,
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
  discoveredAt: now,
  exifReadAt: now,
  proxyState: 'pending',
  proxyWidth: null,
  proxyHeight: null,
  thumbState: 'pending',
  missingAt: null,
  hiddenAt: null,
  selectedConfigId: null,
});

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('SqlJsGlobalCatalogStore root relocation', () => {
  const seed = async (store: SqlJsGlobalCatalogStore, folderPath: string, fingerprint: string): Promise<string> => {
    const folderId = derivedFolderId(folderPath);
    value(await store.upsertFolder({ folderId, currentPath: folderPath, displayName: path.basename(folderPath), firstSeenAt: now, lastSeenAt: now }));
    value(await store.upsertFile({
      fingerprint,
      folderId,
      fileName: 'clip.mp4',
      size: 1,
      durationS: null,
      width: null,
      height: null,
      gpsLat: null,
      gpsLon: null,
      processedAt: now,
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
    }));
    return folderId;
  };

  it('moves folder ids, file references, drive runs and grid thumbnail paths in one rewrite', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const oldId = await seed(store, `${OLD_ROOT}/trip`, 'fp-trip');
    const lookalikeId = await seed(store, LOOKALIKE_ROOT, 'fp-other');
    value(await store.setFolderDefaultVariant(oldId, 'cfg_000000000001'));
    value(await store.startDriveRun({
      runId: 'run-1', root: OLD_ROOT, startedAt: now, finishedAt: null, foldersTotal: 1, foldersDone: 0,
      filesDone: 0, filesSkipped: 0, filesFailed: 0, lastActivityAt: now, batch: null,
    }));
    value(await store.startDriveRun({
      runId: 'run-2', root: LOOKALIKE_ROOT, startedAt: now, finishedAt: null, foldersTotal: 1, foldersDone: 0,
      filesDone: 0, filesSkipped: 0, filesFailed: 0, lastActivityAt: now, batch: null,
    }));
    const mirrorRoot = path.join(home, '.ai-video-cataloger', 'read-only-folders');
    const newId = derivedFolderId(`${NEW_ROOT}/trip`);
    value(await store.recordGridThumbnail({
      outputPath: `${mirrorRoot}/${oldId}/thumbnails/clip.grid.jpg`,
      generationVersion: 1,
      sourcePath: `${OLD_ROOT}/trip/clip.mp4`,
      sourceKind: 'video',
      primary: true,
    }));
    const input: RootRelocationInput = {
      fromRoot: OLD_ROOT,
      toRoot: NEW_ROOT,
      folders: [{ fromFolderId: oldId, toFolderId: newId, toPath: `${NEW_ROOT}/trip`, displayName: 'trip' }],
      pathPrefixes: [
        { from: OLD_ROOT, to: NEW_ROOT },
        { from: `${mirrorRoot}/${oldId}`, to: `${mirrorRoot}/${newId}` },
      ],
    };

    expect(value(await store.rootRelocationStats(input))).toEqual({ files: 1, driveRuns: 1, gridThumbnails: 1 });
    expect(value(await store.relocateRoot(input))).toEqual({ folders: 1, files: 1, driveRuns: 1, gridThumbnails: 1 });
    value(await store.dispose());

    const reopened = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    expect(value(await reopened.getFolder(oldId))).toBeNull();
    expect(value(await reopened.getFolder(newId))).toMatchObject({ currentPath: `${NEW_ROOT}/trip`, displayName: 'trip' });
    expect(value(await reopened.getFolderDefaultConfigId(newId))).toBe('cfg_000000000001');
    expect(value(await reopened.getFile('fp-trip'))?.folderId).toBe(newId);
    expect(value(await reopened.getFile('fp-other'))?.folderId).toBe(lookalikeId);
    expect(value(await reopened.unfinishedDriveRuns(NEW_ROOT)).map((run) => run.runId)).toEqual(['run-1']);
    expect(value(await reopened.unfinishedDriveRuns(LOOKALIKE_ROOT)).map((run) => run.runId)).toEqual(['run-2']);
    expect(value(await reopened.getGridThumbnail(`${mirrorRoot}/${newId}/thumbnails/clip.grid.jpg`)))
      .toMatchObject({ sourcePath: `${NEW_ROOT}/trip/clip.mp4` });
    expect(value(await reopened.rootRelocationStats(input))).toEqual({ files: 0, driveRuns: 0, gridThumbnails: 0 });
    value(await reopened.dispose());
  });
});

describe('SqlJsPhotosStore root relocation', () => {
  const seed = async (store: SqlJsPhotosStore, folderPath: string, fingerprint: string): Promise<string> => {
    const folderId = derivedFolderId(folderPath);
    const photoPath = `${folderPath}/IMG_0001.jpg`;
    value(await store.upsertFolder({
      folderId,
      currentPath: folderPath,
      displayName: path.basename(folderPath),
      firstSeenAt: now,
      lastSeenAt: now,
      defaultConfigId: null,
    }));
    value(await store.upsertPhoto(photo(fingerprint, folderId, photoPath)));
    value(await store.upsertSighting({ fingerprint, currentPath: photoPath, folderId, size: 10, mtimeMs: 1, lastSeenAt: now }));
    return folderId;
  };

  it('rewrites folders, representative paths, sightings and runs under the old root only', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    const oldId = await seed(store, `${OLD_ROOT}/2024`, 'ph_1');
    const lookalikeId = await seed(store, `${LOOKALIKE_ROOT}/2024`, 'ph_2');
    value(await store.startPhotoRun({
      runId: 'run-1', root: OLD_ROOT, stage: 'scan', startedAt: now, finishedAt: now, filesTotal: 1, filesDone: 1,
      filesSkipped: 0, filesFailed: 0, lastActivityAt: now, batchJson: null,
    }));
    const newId = derivedFolderId(`${NEW_ROOT}/2024`);
    const input: RootRelocationInput = {
      fromRoot: OLD_ROOT,
      toRoot: NEW_ROOT,
      folders: [{ fromFolderId: oldId, toFolderId: newId, toPath: `${NEW_ROOT}/2024`, displayName: '2024' }],
      pathPrefixes: [{ from: OLD_ROOT, to: NEW_ROOT }],
    };

    expect(value(await store.listFolders()).map((folder) => folder.folderId).sort()).toEqual([lookalikeId, oldId].sort());
    expect(value(await store.rootRelocationStats(OLD_ROOT, NEW_ROOT))).toEqual({ photos: 1, paths: 1, runs: 1, pathCollisions: [] });
    expect(value(await store.relocateRoot(input))).toEqual({ folders: 1, photos: 1, paths: 1, runs: 1 });
    value(await store.dispose());

    const reopened = new SqlJsPhotosStore({ homeDirectory: home });
    expect(value(await reopened.getFolder(oldId))).toBeNull();
    expect(value(await reopened.getFolder(newId))?.currentPath).toBe(`${NEW_ROOT}/2024`);
    expect(value(await reopened.getPhoto('ph_1'))).toMatchObject({ folderId: newId, currentPath: `${NEW_ROOT}/2024/IMG_0001.jpg` });
    expect(value(await reopened.listSightings('ph_1'))).toEqual([
      expect.objectContaining({ folderId: newId, currentPath: `${NEW_ROOT}/2024/IMG_0001.jpg` }),
    ]);
    expect(value(await reopened.getPhoto('ph_2'))).toMatchObject({ folderId: lookalikeId, currentPath: `${LOOKALIKE_ROOT}/2024/IMG_0001.jpg` });
    expect(value(await reopened.listRoots()).map((root) => root.root)).toEqual([NEW_ROOT]);
    expect(value(await reopened.rootRelocationStats(OLD_ROOT, NEW_ROOT))).toEqual({ photos: 0, paths: 0, runs: 0, pathCollisions: [] });
    value(await reopened.dispose());
  });

  it('reports a sighting whose rewritten path already exists for the same content', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    const folderId = await seed(store, `${OLD_ROOT}/2024`, 'ph_1');
    value(await store.upsertSighting({
      fingerprint: 'ph_1',
      currentPath: `${NEW_ROOT}/2024/IMG_0001.jpg`,
      folderId,
      size: 10,
      mtimeMs: 1,
      lastSeenAt: now,
    }));

    expect(value(await store.rootRelocationStats(OLD_ROOT, NEW_ROOT)).pathCollisions).toEqual([`${OLD_ROOT}/2024/IMG_0001.jpg`]);
    value(await store.dispose());
  });
});
