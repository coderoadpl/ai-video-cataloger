import { describe, expect, it } from 'vitest';

import { ok, snapshotLineSchema, type AppError, type CatalogFile, type CatalogFolder, type Person, type Result } from '@core/domain/index.js';

import type { JobExecutionContext, PhotoFolderRecord, PhotoRecord, TrashPort } from '../ports.js';
import { InMemoryFileSystem, InMemoryGlobalCatalogStore, InMemoryJobs, InMemoryMedia, InMemoryPhotosStore } from '../../../test/server/usecases/test-fakes.js';
import { libraryHide, libraryUnhide } from './library-hide.js';
import { libraryTrash, libraryTrashPreflight, runLibraryTrash } from './library-trash.js';
import { exportFolderSnapshot, folderSnapshotPath } from './catalog-snapshot.js';

const now = '2026-01-01T00:00:00.000Z';

const videoFolder = (folderId: string, currentPath: string): CatalogFolder => ({
  folderId,
  currentPath,
  displayName: currentPath.split('/').pop() ?? currentPath,
  firstSeenAt: now,
  lastSeenAt: now,
});

const videoFile = (fingerprint: string, folderId: string, fileName: string): CatalogFile => ({
  fingerprint,
  folderId,
  fileName,
  size: 10,
  durationS: 1,
  width: null,
  height: null,
  gpsLat: null,
  gpsLon: null,
  processedAt: now,
  analyzer: null,
  model: null,
  missingAt: null,
  hiddenAt: null,
  capturedAt: null,
  capturedAtSource: null,
  gpsSource: null,
  gpsAccuracyM: null,
  gpsIntervalKind: null,
  gpsResolvedAt: null,
  place: null,
});

const photoFolder = (folderId: string, currentPath: string): PhotoFolderRecord => ({
  folderId,
  currentPath,
  displayName: currentPath.split('/').pop() ?? currentPath,
  firstSeenAt: now,
  lastSeenAt: now,
  defaultConfigId: null,
});

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

const person = (personId: string): Person => ({
  personId,
  displayName: 'Person',
  kind: 'face',
  createdAt: now,
  centroid: [0.1],
  exemplarCount: 1,
});

class RecordingTrashPort implements TrashPort {
  readonly moved: string[] = [];
  failOnCall: number | null = null;

  moveToTrash(targetPath: string): Promise<Result<void, AppError>> {
    this.moved.push(targetPath);
    if (this.failOnCall === this.moved.length) {
      return Promise.resolve({ ok: false, error: { code: 'delete_error', message: 'Trash failed' } });
    }
    return Promise.resolve(ok(undefined));
  }
}

const deps = () => {
  const fs = new InMemoryFileSystem('/library');
  const globalCatalog = new InMemoryGlobalCatalogStore();
  const photos = new InMemoryPhotosStore();
  const jobs = new InMemoryJobs();
  const media = new InMemoryMedia(fs);
  const trash = new RecordingTrashPort();
  return { fs, globalCatalog, photos, jobs, media, trash };
};

const seedVideo = async (
  setup: ReturnType<typeof deps>,
  folder: CatalogFolder,
  fingerprint: string,
  fileName: string,
): Promise<void> => {
  setup.fs.addFile(setup.fs.join(folder.currentPath, fileName), { content: fingerprint });
  await setup.globalCatalog.upsertFile(videoFile(fingerprint, folder.folderId, fileName));
};

const snapshotFingerprints = async (
  setup: ReturnType<typeof deps>,
  folder: CatalogFolder,
): Promise<string[]> => {
  const snapshot = await setup.fs.readTextFile(folderSnapshotPath(setup.fs, folder.currentPath));
  if (!snapshot.ok || snapshot.value === null) throw new Error('Snapshot was not exported');
  const fingerprints: string[] = [];
  for (const rawLine of snapshot.value.split('\n')) {
    if (rawLine.trim().length === 0) continue;
    const parsed = snapshotLineSchema.parse(JSON.parse(rawLine));
    if (parsed.type === 'record') fingerprints.push(parsed.file.fingerprint);
  }
  return fingerprints.sort();
};

describe('library hide and unhide', () => {
  it('marks video and photo selections hidden and restores them without deleting records', async () => {
    const setup = deps();
    await setup.globalCatalog.upsertFolder(videoFolder('11111111-1111-4111-8111-111111111111', '/library/videos'));
    await setup.globalCatalog.upsertFile(videoFile('fp-video', '11111111-1111-4111-8111-111111111111', 'clip.mp4'));
    await setup.photos.upsertFolder(photoFolder('path-aaaaaaaa', '/library/photos'));
    await setup.photos.upsertPhoto(photoRecord('fp-photo', 'path-aaaaaaaa', '/library/photos/a.jpg'));
    await setup.photos.upsertSighting({ fingerprint: 'fp-photo', currentPath: '/library/photos/a.jpg', folderId: 'path-aaaaaaaa', size: 10, mtimeMs: 1, lastSeenAt: now });

    const hidden = await libraryHide(setup, { scope: { kind: 'fingerprints', fingerprints: ['fp-video', 'fp-photo'] } });

    expect(hidden).toMatchObject({ ok: true, value: { requested: 2, changed: 2, unchanged: 0, videos: 1, photos: 1 } });
    const videoSearch = await setup.globalCatalog.search({
      match: null,
      rankingTerms: [],
      filters: { tagTermSets: [], personIds: [], place: null, capturedFrom: null, capturedTo: null, hasGps: null, folderId: null, excludeFolderIds: [], excludeMissing: false },
      sort: 'captured_desc',
      limit: 10,
      offset: 0,
    });
    expect(videoSearch.ok && videoSearch.value.rows).toEqual([]);
    expect(await setup.photos.countHidden()).toMatchObject({ ok: true, value: 1 });

    const restored = await libraryUnhide(setup, { scope: { kind: 'fingerprints', fingerprints: ['fp-video', 'fp-photo'] } });

    expect(restored).toMatchObject({ ok: true, value: { requested: 2, changed: 2, unchanged: 0, videos: 1, photos: 1 } });
    const video = await setup.globalCatalog.getFile('fp-video');
    const photo = await setup.photos.getPhoto('fp-photo');
    expect(video.ok && video.value?.hiddenAt).toBeNull();
    expect(photo.ok && photo.value?.hiddenAt).toBeNull();
  });
});

describe('library trash', () => {
  it('rejects the whole selection when any affected root is not writable', async () => {
    const setup = deps();
    setup.fs.addDirectory('/library/ok');
    setup.fs.addDirectory('/library/readonly');
    setup.fs.markReadOnly('/library/readonly');
    await setup.globalCatalog.upsertFolder(videoFolder('11111111-1111-4111-8111-111111111111', '/library/ok'));
    await setup.globalCatalog.upsertFolder(videoFolder('22222222-2222-4222-8222-222222222222', '/library/readonly'));
    await setup.globalCatalog.upsertFile(videoFile('fp-ok', '11111111-1111-4111-8111-111111111111', 'ok.mp4'));
    await setup.globalCatalog.upsertFile(videoFile('fp-readonly', '22222222-2222-4222-8222-222222222222', 'readonly.mp4'));

    const result = await libraryTrashPreflight(setup, { scope: { kind: 'fingerprints', fingerprints: ['fp-ok', 'fp-readonly'] } });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('target_read_only');
    expect(setup.trash.moved).toEqual([]);
    expect(await setup.globalCatalog.getFile('fp-ok')).toMatchObject({ ok: true, value: { fingerprint: 'fp-ok' } });
  });

  it('deletes records and owned artifacts before moving selected paths to Trash', async () => {
    const setup = deps();
    setup.fs.addDirectory('/library/videos');
    setup.fs.addFile('/library/videos/clip.mp4', { content: 'video' });
    setup.fs.addFile('/library/crop.jpg', { content: 'crop' });
    await setup.globalCatalog.upsertFolder(videoFolder('11111111-1111-4111-8111-111111111111', '/library/videos'));
    await setup.globalCatalog.upsertFile(videoFile('fp-video', '11111111-1111-4111-8111-111111111111', 'clip.mp4'));
    await setup.globalCatalog.upsertPerson(person('p-1'));
    await setup.globalCatalog.upsertFaceObservation({
      obsId: 'obs-1',
      fingerprint: 'fp-video',
      kind: 'face',
      frameTsS: 1,
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      embedding: [0.1],
      quality: 0.9,
      personId: 'p-1',
      cropPath: '/library/crop.jpg',
      media: 'video',
    });

    const started = await libraryTrash(setup, { scope: { kind: 'fingerprints', fingerprints: ['fp-video'] }, confirm: true, dryRun: false });

    expect(started).toMatchObject({ ok: true, value: { kind: 'job', jobId: 'job-1' } });
    const job = await setup.jobs.get('job-1');
    expect(job.ok && job.value?.status).toBe('completed');
    expect(job.ok && job.value?.result).toMatchObject({
      kind: 'library_trash',
      filesTrashed: 1,
      videosTrashed: 1,
      observationsDeleted: 1,
      peopleDeleted: 1,
    });
    expect(await setup.globalCatalog.getFile('fp-video')).toMatchObject({ ok: true, value: null });
    expect(await setup.fs.exists('/library/crop.jpg')).toMatchObject({ ok: true, value: false });
    expect(setup.trash.moved).toEqual(['/library/videos/clip.mp4']);
  });

  it('re-exports a writable video folder snapshot with only the entries actually trashed before cancellation', async () => {
    const setup = deps();
    const folder = videoFolder('11111111-1111-4111-8111-111111111111', '/library/videos');
    setup.fs.addDirectory(folder.currentPath);
    await setup.globalCatalog.upsertFolder(folder);
    for (const index of [1, 2, 3, 4, 5]) await seedVideo(setup, folder, `fp-${String(index)}`, `clip-${String(index)}.mp4`);
    const exported = await exportFolderSnapshot({ globalCatalog: setup.globalCatalog, fs: setup.fs }, folder);
    expect(exported).toMatchObject({ ok: true });
    const controller = new AbortController();
    const context: JobExecutionContext = {
      signal: controller.signal,
      reportProgress: () => Promise.resolve(ok(undefined)),
    };
    setup.trash.moveToTrash = (targetPath) => {
      setup.trash.moved.push(targetPath);
      if (setup.trash.moved.length === 2) controller.abort();
      return Promise.resolve(ok(undefined));
    };

    const result = await runLibraryTrash(setup, {
      scope: { kind: 'fingerprints', fingerprints: ['fp-1', 'fp-2', 'fp-3', 'fp-4', 'fp-5'] },
    }, context);

    expect(result.ok).toBe(false);
    expect(await snapshotFingerprints(setup, folder)).toEqual(['fp-3', 'fp-4', 'fp-5']);
  });

  it('leaves every root untouched when one affected root fails the writability pre-check', async () => {
    const setup = deps();
    const rootA = videoFolder('11111111-1111-4111-8111-111111111111', '/library/root-a');
    const rootB = videoFolder('22222222-2222-4222-8222-222222222222', '/library/root-b');
    setup.fs.addDirectory('/library/root-a/locked');
    setup.fs.addDirectory('/library/root-a/open');
    setup.fs.addDirectory(rootB.currentPath);
    setup.fs.markReadOnly('/library/root-a/locked');
    await setup.globalCatalog.upsertFolder(rootA);
    await setup.globalCatalog.upsertFolder(rootB);
    await seedVideo(setup, rootA, 'fp-a-1', 'locked/a-1.mp4');
    await seedVideo(setup, rootA, 'fp-a-2', 'locked/a-2.mp4');
    await seedVideo(setup, rootA, 'fp-a-3', 'open/a-3.mp4');
    await seedVideo(setup, rootB, 'fp-b-1', 'b-1.mp4');
    await seedVideo(setup, rootB, 'fp-b-2', 'b-2.mp4');
    await seedVideo(setup, rootB, 'fp-b-3', 'b-3.mp4');
    const fingerprints = ['fp-a-1', 'fp-a-2', 'fp-a-3', 'fp-b-1', 'fp-b-2', 'fp-b-3'];

    const result = await libraryTrash(setup, {
      scope: { kind: 'fingerprints', fingerprints },
      confirm: true,
      dryRun: false,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'target_read_only' } });
    expect(setup.trash.moved).toEqual([]);
    for (const fingerprint of fingerprints) {
      const file = await setup.globalCatalog.getFile(fingerprint);
      expect(file.ok && file.value?.fingerprint).toBe(fingerprint);
    }
    await expectAllFilesExist(setup, [
      '/library/root-a/locked/a-1.mp4',
      '/library/root-a/locked/a-2.mp4',
      '/library/root-a/open/a-3.mp4',
      '/library/root-b/b-1.mp4',
      '/library/root-b/b-2.mp4',
      '/library/root-b/b-3.mp4',
    ]);
  });

  it('stops on a trash failure and reports the processed, failed, and not-attempted counts', async () => {
    const setup = deps();
    const folder = videoFolder('11111111-1111-4111-8111-111111111111', '/library/videos');
    setup.fs.addDirectory(folder.currentPath);
    await setup.globalCatalog.upsertFolder(folder);
    const fingerprints = Array.from({ length: 10 }, (_value, index) => `fp-${String(index + 1).padStart(2, '0')}`);
    for (const fingerprint of fingerprints) await seedVideo(setup, folder, fingerprint, `${fingerprint}.mp4`);
    setup.trash.failOnCall = 4;

    const result = await runLibraryTrash(setup, {
      scope: { kind: 'fingerprints', fingerprints },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      filesTrashed: 3,
      videosTrashed: 3,
      photosTrashed: 0,
      filesFailed: 1,
      filesNotAttempted: 6,
      failedFingerprint: 'fp-04',
      cancelled: false,
    });
    expect(setup.trash.moved).toEqual([
      '/library/videos/fp-01.mp4',
      '/library/videos/fp-02.mp4',
      '/library/videos/fp-03.mp4',
      '/library/videos/fp-04.mp4',
    ]);
    for (const fingerprint of fingerprints.slice(4)) {
      const file = await setup.globalCatalog.getFile(fingerprint);
      expect(file.ok && file.value?.fingerprint).toBe(fingerprint);
      expect(await setup.fs.exists(`/library/videos/${fingerprint}.mp4`)).toMatchObject({ ok: true, value: true });
    }
  });

  it('leaves forgetEntry as a no-op for photo fingerprints while photo trash deletes photo face observations and photo rows', async () => {
    const setup = deps();
    setup.fs.addDirectory('/library/photos');
    setup.fs.addFile('/library/photos/a.jpg', { content: 'photo' });
    await setup.photos.upsertFolder(photoFolder('path-aaaaaaaa', '/library/photos'));
    await setup.photos.upsertPhoto(photoRecord('ph_0000000000000001', 'path-aaaaaaaa', '/library/photos/a.jpg'));
    await setup.photos.upsertSighting({
      fingerprint: 'ph_0000000000000001',
      currentPath: '/library/photos/a.jpg',
      folderId: 'path-aaaaaaaa',
      size: 10,
      mtimeMs: 1,
      lastSeenAt: now,
    });
    await setup.globalCatalog.upsertPerson(person('p-1'));
    await setup.globalCatalog.upsertFaceObservation({
      obsId: 'obs-photo',
      fingerprint: 'ph_0000000000000001',
      kind: 'face',
      frameTsS: null,
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      embedding: [0.1],
      quality: 0.9,
      personId: 'p-1',
      cropPath: '/library/photo-crop.jpg',
      media: 'photo',
    });
    const forgotten = await setup.globalCatalog.forgetEntry('ph_0000000000000001');
    expect(forgotten).toEqual(ok({
      fingerprint: 'ph_0000000000000001',
      deleted: false,
      folderId: null,
      cropPaths: [],
    }));
    expect(await setup.globalCatalog.listFaceObservations({ fingerprint: 'ph_0000000000000001' })).toMatchObject({
      ok: true,
      value: [expect.objectContaining({ obsId: 'obs-photo' })],
    });

    const trashed = await runLibraryTrash(setup, {
      scope: { kind: 'fingerprints', fingerprints: ['ph_0000000000000001'] },
    });

    expect(trashed).toMatchObject({ ok: true, value: { filesTrashed: 1, photosTrashed: 1 } });
    expect(setup.globalCatalog.deleteFaceObservationsForFileCalls).toBe(1);
    expect(await setup.globalCatalog.listFaceObservations({ fingerprint: 'ph_0000000000000001' })).toMatchObject({ ok: true, value: [] });
    expect(await setup.photos.getPhoto('ph_0000000000000001')).toMatchObject({ ok: true, value: null });
    expect(setup.trash.moved).toEqual(['/library/photos/a.jpg']);
  });
});

const expectAllFilesExist = async (
  setup: ReturnType<typeof deps>,
  paths: readonly string[],
): Promise<void> => {
  for (const targetPath of paths) {
    expect(await setup.fs.exists(targetPath)).toMatchObject({ ok: true, value: true });
  }
};
