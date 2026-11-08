import { describe, expect, it, vi } from 'vitest';

import { appError, derivedFolderId, err, type AppError, type Result } from '@core/domain/index.js';

import {
  InMemoryFileSystem,
  InMemoryGlobalCatalogStore,
  InMemoryPhotosStore,
} from '../../../test/server/usecases/test-fakes.js';
import type { PhotoRecord } from '../ports.js';
import { readOnlyArtifactRootById } from './artifact-root.js';
import { relocateRoot, type RelocateRootInput, type RelocateRootOutput } from './relocate-root.js';

const now = '2026-11-01T10:00:00.000Z';
const OLD_ROOT = '/Volumes/media';
const NEW_ROOT = '/Volumes/library';
const LOOKALIKE_ROOT = '/Volumes/media2';
const MARKER_ID = '8d3f2c1e-5b6a-4c7d-9e8f-0a1b2c3d4e5f';
const NFC_NAME = 'Łódź Å';
const NFD_NAME = NFC_NAME.normalize('NFD');

const value = <T>(result: Result<T, AppError>): T => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
};

const failure = <T>(result: Result<T, AppError>): AppError => {
  if (result.ok) throw new Error('expected a failure');
  return result.error;
};

const photoRecord = (fingerprint: string, folderId: string, currentPath: string): PhotoRecord => ({
  fingerprint,
  folderId,
  fileName: currentPath.split('/').pop() ?? currentPath,
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

interface Fixture {
  fs: InMemoryFileSystem;
  globalCatalog: InMemoryGlobalCatalogStore;
  photos: InMemoryPhotosStore;
  run: (input: Partial<RelocateRootInput>) => Promise<Result<RelocateRootOutput, AppError>>;
}

const mirrorOf = (fs: InMemoryFileSystem, folderId: string): string => readOnlyArtifactRootById(fs, folderId).path;

const seedVideoFolder = async (
  fixture: Pick<Fixture, 'globalCatalog' | 'fs'>,
  folderPath: string,
  options: { folderId?: string; fingerprint?: string; mirror?: boolean } = {},
): Promise<string> => {
  const folderId = options.folderId ?? derivedFolderId(folderPath);
  value(await fixture.globalCatalog.upsertFolder({
    folderId,
    currentPath: folderPath,
    displayName: folderPath.split('/').pop() ?? folderPath,
    firstSeenAt: now,
    lastSeenAt: now,
  }));
  value(await fixture.globalCatalog.upsertFile({
    fingerprint: options.fingerprint ?? `fp-${folderId}`,
    folderId,
    fileName: 'clip.mp4',
    size: 1,
    durationS: null,
    gpsLat: null,
    gpsLon: null,
    processedAt: now,
    analyzer: null,
    model: null,
    missingAt: null,
  }));
  if (options.mirror === true) fixture.fs.addFile(`${mirrorOf(fixture.fs, folderId)}/thumbnails/clip.jpg`, { content: 'jpg' });
  return folderId;
};

const seedPhotoFolder = async (photos: InMemoryPhotosStore, folderPath: string, fingerprint: string): Promise<string> => {
  const folderId = derivedFolderId(folderPath);
  const photoPath = `${folderPath}/IMG_0001.jpg`;
  value(await photos.upsertFolder({
    folderId,
    currentPath: folderPath,
    displayName: folderPath.split('/').pop() ?? folderPath,
    firstSeenAt: now,
    lastSeenAt: now,
    defaultConfigId: null,
  }));
  value(await photos.upsertPhoto(photoRecord(fingerprint, folderId, photoPath)));
  value(await photos.upsertSighting({ fingerprint, currentPath: photoPath, folderId, size: 10, mtimeMs: 1, lastSeenAt: now }));
  return folderId;
};

const createFixture = (): Fixture => {
  const fs = new InMemoryFileSystem('/work');
  const globalCatalog = new InMemoryGlobalCatalogStore();
  const photos = new InMemoryPhotosStore();
  return {
    fs,
    globalCatalog,
    photos,
    run: (input) => relocateRoot(
      { fs, globalCatalog, photos, now: () => new Date(now) },
      { from: OLD_ROOT, to: NEW_ROOT, media: 'all', apply: false, ...input },
    ),
  };
};

const folderPaths = async (store: { listFolders(): Promise<Result<{ currentPath: string }[], AppError>> }): Promise<string[]> =>
  value(await store.listFolders()).map((folder) => folder.currentPath).sort();

describe('relocateRoot', () => {
  it('matches the old root and its descendants but never a lookalike sibling', async () => {
    const fixture = createFixture();
    await seedVideoFolder(fixture, OLD_ROOT);
    await seedVideoFolder(fixture, `${OLD_ROOT}/trip`);
    await seedVideoFolder(fixture, LOOKALIKE_ROOT);
    await seedPhotoFolder(fixture.photos, `${OLD_ROOT}/photos`, 'ph_1');
    await seedPhotoFolder(fixture.photos, `${LOOKALIKE_ROOT}/photos`, 'ph_2');

    const output = value(await fixture.run({ apply: true }));

    expect(output.databases.map((plan) => [plan.media, plan.folders])).toEqual([['video', 2], ['photo', 1]]);
    expect(await folderPaths(fixture.globalCatalog)).toEqual([NEW_ROOT, `${NEW_ROOT}/trip`, LOOKALIKE_ROOT]);
    expect(await folderPaths(fixture.photos)).toEqual([`${NEW_ROOT}/photos`, `${LOOKALIKE_ROOT}/photos`]);
    expect(value(await fixture.photos.getPhoto('ph_2'))?.currentPath).toBe(`${LOOKALIKE_ROOT}/photos/IMG_0001.jpg`);
    expect(value(await fixture.photos.listSightings('ph_2')).map((sighting) => sighting.currentPath))
      .toEqual([`${LOOKALIKE_ROOT}/photos/IMG_0001.jpg`]);
  });

  it('re-derives path ids and moves every row that references them', async () => {
    const fixture = createFixture();
    const oldId = await seedVideoFolder(fixture, `${OLD_ROOT}/trip`, { fingerprint: 'fp-trip' });
    value(await fixture.globalCatalog.setFolderDefaultVariant(oldId, 'cfg_000000000001'));
    const oldPhotoId = await seedPhotoFolder(fixture.photos, `${OLD_ROOT}/photos`, 'ph_1');
    const newId = derivedFolderId(`${NEW_ROOT}/trip`);
    const newPhotoId = derivedFolderId(`${NEW_ROOT}/photos`);

    const output = value(await fixture.run({ apply: true }));

    expect(output.databases.map((plan) => plan.idChanges)).toEqual([1, 1]);
    expect(value(await fixture.globalCatalog.getFolder(oldId))).toBeNull();
    expect(value(await fixture.globalCatalog.getFolder(newId))).toMatchObject({ currentPath: `${NEW_ROOT}/trip`, displayName: 'trip' });
    expect(value(await fixture.globalCatalog.getFile('fp-trip'))?.folderId).toBe(newId);
    expect(value(await fixture.globalCatalog.getFolderDefaultConfigId(newId))).toBe('cfg_000000000001');
    expect(value(await fixture.photos.getFolder(oldPhotoId))).toBeNull();
    expect(value(await fixture.photos.getFolder(newPhotoId))?.currentPath).toBe(`${NEW_ROOT}/photos`);
    expect(value(await fixture.photos.getPhoto('ph_1'))).toMatchObject({
      folderId: newPhotoId,
      currentPath: `${NEW_ROOT}/photos/IMG_0001.jpg`,
    });
    expect(value(await fixture.photos.listSightings('ph_1'))).toEqual([
      expect.objectContaining({ folderId: newPhotoId, currentPath: `${NEW_ROOT}/photos/IMG_0001.jpg` }),
    ]);
  });

  it('renames the root folder display name only when it was the folder basename', async () => {
    const fixture = createFixture();
    await seedVideoFolder(fixture, OLD_ROOT);
    value(await fixture.globalCatalog.upsertFolder({
      folderId: derivedFolderId(`${OLD_ROOT}/custom`),
      currentPath: `${OLD_ROOT}/custom`,
      displayName: 'Holiday',
      firstSeenAt: now,
      lastSeenAt: now,
    }));

    value(await fixture.run({ apply: true }));

    expect(value(await fixture.globalCatalog.getFolder(derivedFolderId(NEW_ROOT)))?.displayName).toBe('library');
    expect(value(await fixture.globalCatalog.getFolder(derivedFolderId(`${NEW_ROOT}/custom`)))?.displayName).toBe('Holiday');
  });

  it('keeps a marker UUID and only rewrites the path', async () => {
    const fixture = createFixture();
    await seedVideoFolder(fixture, `${OLD_ROOT}/marked`, { folderId: MARKER_ID, fingerprint: 'fp-marked' });

    const output = value(await fixture.run({ apply: true, media: 'video' }));

    expect(output.databases[0]).toMatchObject({ folders: 1, files: 1, idChanges: 0, mirrorsToRename: 0 });
    expect(value(await fixture.globalCatalog.getFolder(MARKER_ID))?.currentPath).toBe(`${NEW_ROOT}/marked`);
    expect(value(await fixture.globalCatalog.getFile('fp-marked'))?.folderId).toBe(MARKER_ID);
  });

  it('renames the read-only mirror to the new id', async () => {
    const fixture = createFixture();
    const oldId = await seedVideoFolder(fixture, `${OLD_ROOT}/trip`, { mirror: true });
    const newId = derivedFolderId(`${NEW_ROOT}/trip`);
    value(await fixture.globalCatalog.recordGridThumbnail({
      outputPath: `${mirrorOf(fixture.fs, oldId)}/thumbnails/clip.grid.jpg`,
      generationVersion: 1,
      sourcePath: `${OLD_ROOT}/trip/clip.mp4`,
      sourceKind: 'video',
      primary: true,
    }));

    const output = value(await fixture.run({ apply: true, media: 'video' }));

    expect(output.databases[0]).toMatchObject({ mirrorsToRename: 1, gridThumbnails: 1 });
    expect(value(await fixture.fs.exists(mirrorOf(fixture.fs, oldId)))).toBe(false);
    expect(value(await fixture.fs.isFile(`${mirrorOf(fixture.fs, newId)}/thumbnails/clip.jpg`))).toBe(true);
    expect(value(await fixture.globalCatalog.getGridThumbnail(`${mirrorOf(fixture.fs, newId)}/thumbnails/clip.grid.jpg`)))
      .toMatchObject({ sourcePath: `${NEW_ROOT}/trip/clip.mp4` });
  });

  it('rewrites drive runs and photo runs that sit under the old root', async () => {
    const fixture = createFixture();
    await seedVideoFolder(fixture, OLD_ROOT);
    value(await fixture.globalCatalog.startDriveRun({
      runId: 'run-1',
      root: OLD_ROOT,
      startedAt: now,
      finishedAt: null,
      foldersTotal: 1,
      foldersDone: 0,
      filesDone: 0,
      filesSkipped: 0,
      filesFailed: 0,
      lastActivityAt: now,
      batch: null,
    }));
    value(await fixture.photos.startPhotoRun({
      runId: 'photo-run-1',
      root: OLD_ROOT,
      stage: 'scan',
      startedAt: now,
      finishedAt: now,
      filesTotal: 1,
      filesDone: 1,
      filesSkipped: 0,
      filesFailed: 0,
      lastActivityAt: now,
      batchJson: null,
    }));

    const output = value(await fixture.run({ apply: true }));

    expect(output.databases.map((plan) => plan.runs)).toEqual([1, 1]);
    expect(value(await fixture.globalCatalog.unfinishedDriveRuns(NEW_ROOT)).map((run) => run.runId)).toEqual(['run-1']);
    expect(fixture.photos.runs.get('photo-run-1')?.root).toBe(NEW_ROOT);
  });

  it('aborts before any write when a target id already exists as a row', async () => {
    const fixture = createFixture();
    await seedVideoFolder(fixture, `${OLD_ROOT}/trip`, { mirror: true });
    await seedVideoFolder(fixture, `${NEW_ROOT}/trip`);
    const snapshot = vi.spyOn(fixture.globalCatalog, 'snapshotTo');
    const before = fixture.fs.snapshot();

    const dryRun = value(await fixture.run({ media: 'video' }));
    const error = failure(await fixture.run({ apply: true, media: 'video' }));

    expect(dryRun.collisions).toEqual([
      { media: 'video', kind: 'folder_id', fromPath: `${OLD_ROOT}/trip`, target: derivedFolderId(`${NEW_ROOT}/trip`) },
      { media: 'video', kind: 'folder_path', fromPath: `${OLD_ROOT}/trip`, target: `${NEW_ROOT}/trip` },
    ]);
    expect(error.code).toBe('conflict');
    expect(error.message).toContain(`${OLD_ROOT}/trip -> ${derivedFolderId(`${NEW_ROOT}/trip`)}`);
    expect(snapshot).not.toHaveBeenCalled();
    expect(fixture.fs.snapshot()).toEqual(before);
    expect(await folderPaths(fixture.globalCatalog)).toEqual([`${NEW_ROOT}/trip`, `${OLD_ROOT}/trip`]);
  });

  it('aborts when the target mirror directory already exists', async () => {
    const fixture = createFixture();
    await seedVideoFolder(fixture, `${OLD_ROOT}/trip`, { mirror: true });
    const target = mirrorOf(fixture.fs, derivedFolderId(`${NEW_ROOT}/trip`));
    fixture.fs.addDirectory(target);

    const error = failure(await fixture.run({ apply: true, media: 'video' }));

    expect(error.code).toBe('conflict');
    expect(error.details).toEqual({ collisions: [{ media: 'video', kind: 'mirror', fromPath: `${OLD_ROOT}/trip`, target }] });
    expect(await folderPaths(fixture.globalCatalog)).toEqual([`${OLD_ROOT}/trip`]);
  });

  it('aborts when a photo path already exists under the new root for the same content', async () => {
    const fixture = createFixture();
    const folderId = await seedPhotoFolder(fixture.photos, `${OLD_ROOT}/photos`, 'ph_1');
    value(await fixture.photos.upsertSighting({
      fingerprint: 'ph_1',
      currentPath: `${NEW_ROOT}/photos/IMG_0001.jpg`,
      folderId,
      size: 10,
      mtimeMs: 1,
      lastSeenAt: now,
    }));

    const error = failure(await fixture.run({ apply: true, media: 'photo' }));

    expect(error.code).toBe('conflict');
    expect(error.details).toEqual({ collisions: [{
      media: 'photo',
      kind: 'photo_path',
      fromPath: `${OLD_ROOT}/photos/IMG_0001.jpg`,
      target: `${NEW_ROOT}/photos/IMG_0001.jpg`,
    }] });
    expect(await folderPaths(fixture.photos)).toEqual([`${OLD_ROOT}/photos`]);
  });

  it('accepts NFD input for rows stored in NFC and derives ids from the canonical path', async () => {
    const fixture = createFixture();
    await seedVideoFolder(fixture, `${OLD_ROOT}/${NFC_NAME}`, { fingerprint: 'fp-nfc' });

    const output = value(await fixture.run({ from: `${OLD_ROOT}/${NFD_NAME}`, to: `${NEW_ROOT}/${NFD_NAME}`, apply: true, media: 'video' }));

    expect(output.from).toBe(`${OLD_ROOT}/${NFC_NAME}`);
    expect(output.to).toBe(`${NEW_ROOT}/${NFC_NAME}`);
    const newId = derivedFolderId(`${NEW_ROOT}/${NFC_NAME}`);
    expect(value(await fixture.globalCatalog.getFolder(newId))?.currentPath).toBe(`${NEW_ROOT}/${NFC_NAME}`);
    expect(value(await fixture.globalCatalog.getFile('fp-nfc'))?.folderId).toBe(newId);
  });

  it('makes no writes during a dry run', async () => {
    const fixture = createFixture();
    await seedVideoFolder(fixture, `${OLD_ROOT}/trip`, { mirror: true });
    await seedPhotoFolder(fixture.photos, `${OLD_ROOT}/photos`, 'ph_1');
    const videoRelocate = vi.spyOn(fixture.globalCatalog, 'relocateRoot');
    const photoRelocate = vi.spyOn(fixture.photos, 'relocateRoot');
    const snapshot = vi.spyOn(fixture.globalCatalog, 'snapshotTo');
    const before = fixture.fs.snapshot();

    const output = value(await fixture.run({}));

    expect(output).toMatchObject({ apply: false, applied: false, backupDirectory: null, remaining: null, collisions: [] });
    expect(output.databases).toEqual([
      expect.objectContaining({ media: 'video', folders: 1, files: 1, idChanges: 1, mirrorsToRename: 1 }),
      expect.objectContaining({ media: 'photo', folders: 1, files: 1, paths: 1, idChanges: 1, mirrorsToRename: 0 }),
    ]);
    expect(output.databases[0]?.examples).toEqual([{
      fromPath: `${OLD_ROOT}/trip`,
      toPath: `${NEW_ROOT}/trip`,
      fromFolderId: derivedFolderId(`${OLD_ROOT}/trip`),
      toFolderId: derivedFolderId(`${NEW_ROOT}/trip`),
      mirror: {
        from: mirrorOf(fixture.fs, derivedFolderId(`${OLD_ROOT}/trip`)),
        to: mirrorOf(fixture.fs, derivedFolderId(`${NEW_ROOT}/trip`)),
      },
    }]);
    expect(videoRelocate).not.toHaveBeenCalled();
    expect(photoRelocate).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
    expect(fixture.fs.snapshot()).toEqual(before);
    expect(await folderPaths(fixture.globalCatalog)).toEqual([`${OLD_ROOT}/trip`]);
  });

  it('backs up both databases, applies, and verifies nothing remains under the old root', async () => {
    const fixture = createFixture();
    await seedVideoFolder(fixture, OLD_ROOT);
    await seedVideoFolder(fixture, `${OLD_ROOT}/trip`, { mirror: true });
    await seedPhotoFolder(fixture.photos, `${OLD_ROOT}/photos`, 'ph_1');
    const videoSnapshot = vi.spyOn(fixture.globalCatalog, 'snapshotTo');
    const photoSnapshot = vi.spyOn(fixture.photos, 'snapshotTo');
    const backupDirectory = '/home/.ai-video-cataloger/backups/2026-11-01T10-00-00-000Z--relocate-root';

    const output = value(await fixture.run({ apply: true }));

    expect(output).toMatchObject({ applied: true, backupDirectory, warnings: [`${NEW_ROOT} is not mounted; folder existence under the new root was not checked`] });
    expect(videoSnapshot).toHaveBeenCalledWith(`${backupDirectory}/catalog.db`);
    expect(photoSnapshot).toHaveBeenCalledWith(`${backupDirectory}/photos.db`);
    expect(output.remaining).toEqual([
      { media: 'video', folders: 0, paths: 0, runs: 0 },
      { media: 'photo', folders: 0, paths: 0, runs: 0 },
    ]);
    expect(value(await fixture.run({})).databases.map((plan) => plan.folders)).toEqual([0, 0]);
  });

  it('only rewrites the database selected by --media', async () => {
    const fixture = createFixture();
    await seedVideoFolder(fixture, `${OLD_ROOT}/trip`);
    await seedPhotoFolder(fixture.photos, `${OLD_ROOT}/photos`, 'ph_1');

    const output = value(await fixture.run({ apply: true, media: 'photo' }));

    expect(output.databases.map((plan) => plan.media)).toEqual(['photo']);
    expect(await folderPaths(fixture.globalCatalog)).toEqual([`${OLD_ROOT}/trip`]);
    expect(await folderPaths(fixture.photos)).toEqual([`${NEW_ROOT}/photos`]);
  });

  it('refuses to apply while another process holds the catalog lock', async () => {
    const fixture = createFixture();
    await seedVideoFolder(fixture, `${OLD_ROOT}/trip`, { mirror: true });
    vi.spyOn(fixture.globalCatalog, 'acquireWriteLock')
      .mockResolvedValue(err(appError('catalog_locked', 'Catalog is in use by gui')));
    const snapshot = vi.spyOn(fixture.globalCatalog, 'snapshotTo');
    const before = fixture.fs.snapshot();

    const error = failure(await fixture.run({ apply: true }));

    expect(error.code).toBe('catalog_locked');
    expect(snapshot).not.toHaveBeenCalled();
    expect(fixture.fs.snapshot()).toEqual(before);
    expect(await folderPaths(fixture.globalCatalog)).toEqual([`${OLD_ROOT}/trip`]);
  });

  it('moves the mirror back when the catalog rewrite fails', async () => {
    const fixture = createFixture();
    const oldId = await seedVideoFolder(fixture, `${OLD_ROOT}/trip`, { mirror: true });
    vi.spyOn(fixture.globalCatalog, 'relocateRoot').mockResolvedValue(err(appError('internal', 'disk full')));

    const error = failure(await fixture.run({ apply: true, media: 'video' }));

    expect(error.code).toBe('internal');
    expect(error.message).toContain('backups in /home/.ai-video-cataloger/backups/');
    expect(value(await fixture.fs.isFile(`${mirrorOf(fixture.fs, oldId)}/thumbnails/clip.jpg`))).toBe(true);
  });

  it('checks the first and last planned folder when the new root is mounted', async () => {
    const fixture = createFixture();
    await seedVideoFolder(fixture, `${OLD_ROOT}/a`);
    await seedVideoFolder(fixture, `${OLD_ROOT}/m`);
    await seedVideoFolder(fixture, `${OLD_ROOT}/z`);
    fixture.fs.addDirectory(`${NEW_ROOT}/a`);

    const output = value(await fixture.run({}));

    expect(output.targetMounted).toBe(true);
    expect(output.warnings).toEqual([`Planned folder ${NEW_ROOT}/z does not exist under the mounted new root`]);
  });

  it.each([
    [{ from: 'relative/path' }, 'absolute'],
    [{ to: `${OLD_ROOT}/inside` }, 'inside the old root'],
    [{ to: `${OLD_ROOT}/` }, 'same path'],
    [{ from: '/' }, 'filesystem root'],
  ])('rejects invalid roots %o', async (input, message) => {
    const fixture = createFixture();

    const error = failure(await fixture.run(input));

    expect(error.code).toBe('validation');
    expect(error.message).toContain(message);
  });
});
