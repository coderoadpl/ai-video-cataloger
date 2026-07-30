import { describe, expect, it } from 'vitest';

import { sha256Hex } from '@core/domain/sha256.js';
import { appError, photoFingerprintFromSha256 } from '@core/domain/index.js';

import {
  FakeExifPort,
  FakePhotoMediaPort,
  InMemoryFileSystem,
  InMemoryJobs,
  InMemoryPhotosStore,
} from '../../../test/server/usecases/test-fakes.js';
import {
  enqueuePhotoProxies,
  enqueuePhotoScan,
  photosDetail,
  photosForget,
  photosList,
  photosStatus,
  photosTree,
  runPhotoProxiesPass,
  runPhotoScan,
  type PhotosDeps,
} from './photos.js';

const buildDeps = (): {
  deps: PhotosDeps;
  fs: InMemoryFileSystem;
  photos: InMemoryPhotosStore;
  exif: FakeExifPort;
  jobs: InMemoryJobs;
  photoMedia: FakePhotoMediaPort;
} => {
  const fs = new InMemoryFileSystem('/work');
  const photos = new InMemoryPhotosStore();
  const exif = new FakeExifPort();
  const jobs = new InMemoryJobs();
  const photoMedia = new FakePhotoMediaPort(fs);
  return { deps: { photos, fs, exif, jobs, photoMedia }, fs, photos, exif, jobs, photoMedia };
};

const fingerprintOf = (content: string): string => photoFingerprintFromSha256(sha256Hex(content));

const seedPhoto = async (photos: InMemoryPhotosStore, fingerprint: string, currentPath: string): Promise<void> => {
  const now = '2026-01-01T00:00:00.000Z';
  await photos.upsertFolder({
    folderId: 'folder-1',
    currentPath: '/work/photos',
    displayName: 'photos',
    firstSeenAt: now,
    lastSeenAt: now,
    defaultConfigId: null,
  });
  await photos.upsertPhoto({
    fingerprint,
    folderId: 'folder-1',
    fileName: currentPath.split('/').pop() ?? currentPath,
    currentPath,
    ext: 'jpg',
    size: 1,
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
    exifReadAt: null,
    proxyState: 'pending',
    proxyWidth: null,
    proxyHeight: null,
    thumbState: 'pending',
    missingAt: null,
    selectedConfigId: null,
  });
  await photos.upsertSighting({
    fingerprint,
    currentPath,
    folderId: 'folder-1',
    size: 1,
    mtimeMs: 1,
    lastSeenAt: now,
  });
};

describe('runPhotoScan', () => {
  it('indexes new photos, deriving captured-at from file mtime when there is no EXIF', async () => {
    const { deps, fs } = buildDeps();
    fs.addFile('/work/photos/a.jpg', { content: 'photo-a-bytes', mtimeMs: 1000, size: 13 });
    fs.addFile('/work/photos/b.jpg', { content: 'photo-b-bytes', mtimeMs: 2000, size: 13 });
    fs.addFile('/work/photos/notes.txt', { content: 'not a photo' });
    fs.addFile('/work/photos/._a.jpg', { content: 'apple double' });

    const result = await runPhotoScan(deps, { root: '/work/photos' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      media: 'photo',
      filesTotal: 2,
      photosNew: 2,
      pathsSeen: 2,
      exifRead: 0,
      exifFailed: 2,
    });

    const status = await photosStatus(deps, {});
    expect(status.ok && status.value.counts).toMatchObject({ photos: 2, paths: 2 });
  });

  it('skips the AppleDouble prefix, dotfiles, wrong extensions, and the catalog directory', async () => {
    const { deps, fs } = buildDeps();
    fs.addFile('/work/photos/a.jpg', { content: 'a' });
    fs.addFile('/work/photos/.hidden.jpg', { content: 'hidden' });
    fs.addFile('/work/photos/notes.txt', { content: 'notes' });
    fs.addFile('/work/photos/.ai-video-cataloger/db.jpg', { content: 'internal' });

    const result = await runPhotoScan(deps, { root: '/work/photos' });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.filesTotal).toBe(1);
  });

  it('re-scan fast path skips re-hashing an unchanged file', async () => {
    const { deps, fs, photos } = buildDeps();
    fs.addFile('/work/photos/a.jpg', { content: 'photo-a-bytes', mtimeMs: 1000, size: 13 });
    await runPhotoScan(deps, { root: '/work/photos' });
    const afterFirst = photos.photoRows.size;

    const second = await runPhotoScan(deps, { root: '/work/photos' });

    expect(second.ok).toBe(true);
    expect(second.ok && second.value.skippedUnchanged).toBe(1);
    expect(second.ok && second.value.photosNew).toBe(0);
    expect(photos.photoRows.size).toBe(afterFirst);
  });

  it('re-attaches the same fingerprint after a rename, reconciling the old sighting away', async () => {
    const { deps, fs } = buildDeps();
    fs.addFile('/work/photos/a.jpg', { content: 'photo-a-bytes', mtimeMs: 1000, size: 13 });
    await runPhotoScan(deps, { root: '/work/photos' });

    await fs.deleteFile('/work/photos/a.jpg');
    fs.addFile('/work/photos/renamed.jpg', { content: 'photo-a-bytes', mtimeMs: 1000, size: 13 });
    const result = await runPhotoScan(deps, { root: '/work/photos' });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.photosNew).toBe(0);

    const status = await photosStatus(deps, {});
    expect(status.ok && status.value.counts).toMatchObject({ photos: 1, paths: 1 });

    const fingerprint = fingerprintOf('photo-a-bytes');
    const photo = await deps.photos.getPhoto(fingerprint);
    expect(photo.ok && photo.value?.currentPath).toBe('/work/photos/renamed.jpg');
  });

  it('records a duplicate copy as a second sighting of the same photo, owner unchanged', async () => {
    const { deps, fs } = buildDeps();
    fs.addFile('/work/photos/a.jpg', { content: 'photo-a-bytes', mtimeMs: 1000, size: 13 });
    await runPhotoScan(deps, { root: '/work/photos' });

    fs.addFile('/work/photos/copy-of-a.jpg', { content: 'photo-a-bytes', mtimeMs: 1000, size: 13 });
    const result = await runPhotoScan(deps, { root: '/work/photos' });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.photosNew).toBe(0);
    const status = await photosStatus(deps, {});
    expect(status.ok && status.value.counts).toMatchObject({ photos: 1, paths: 2, duplicates: 1 });

    const fingerprint = fingerprintOf('photo-a-bytes');
    const photo = await deps.photos.getPhoto(fingerprint);
    expect(photo.ok && photo.value?.currentPath).toBe('/work/photos/a.jpg');
  });

  it('resolves an NFD path input to the same folder id as its NFC form', async () => {
    const { deps, fs, photos } = buildDeps();
    const nfc = '/work/photos-é';
    const nfd = '/work/photos-é';
    fs.addFile(`${nfc}/a.jpg`, { content: 'a' });

    await runPhotoScan(deps, { root: nfc });
    const nfcFolderId = [...photos.folders.values()][0]?.folderId;

    const other = new InMemoryFileSystem('/work');
    other.addFile(`${nfd}/b.jpg`, { content: 'b' });
    await runPhotoScan({ ...deps, fs: other }, { root: nfd });
    const nfdFolderId = [...photos.folders.values()].find((folder) => folder.currentPath === nfc)?.folderId;

    expect(nfdFolderId).toBe(nfcFolderId);
  });

  it('reports a warning step and falls through to file_mtime when EXIF reading fails', async () => {
    const { deps, fs, exif } = buildDeps();
    fs.addFile('/work/photos/a.jpg', { content: 'a', mtimeMs: 5000 });
    exif.setResult('/work/photos/a.jpg', { code: 'read_error', message: 'boom' });

    const result = await runPhotoScan(deps, { root: '/work/photos' });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.exifFailed).toBe(1);
    const fingerprint = fingerprintOf('a');
    const photo = await deps.photos.getPhoto(fingerprint);
    expect(photo.ok && photo.value?.capturedAtSource).toBe('file_mtime');
  });

  it('marks a photo missing when its only sighting disappears from the scanned root', async () => {
    const { deps, fs } = buildDeps();
    fs.addFile('/work/photos/a.jpg', { content: 'a' });
    await runPhotoScan(deps, { root: '/work/photos' });

    await fs.deleteFile('/work/photos/a.jpg');
    const result = await runPhotoScan(deps, { root: '/work/photos' });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.missingMarked).toBe(1);
    const fingerprint = fingerprintOf('a');
    const photo = await deps.photos.getPhoto(fingerprint);
    expect(photo.ok && photo.value?.missingAt).not.toBeNull();
  });

  it('re-points the owner to a surviving sighting when only the owner path disappears', async () => {
    const { deps, fs } = buildDeps();
    fs.addFile('/work/photos/a.jpg', { content: 'a', mtimeMs: 1 });
    fs.addFile('/work/photos/copy-of-a.jpg', { content: 'a', mtimeMs: 1 });
    await runPhotoScan(deps, { root: '/work/photos' });

    await fs.deleteFile('/work/photos/a.jpg');
    const result = await runPhotoScan(deps, { root: '/work/photos' });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.missingMarked).toBe(0);
    const fingerprint = fingerprintOf('a');
    const photo = await deps.photos.getPhoto(fingerprint);
    expect(photo.ok && photo.value?.currentPath).toBe('/work/photos/copy-of-a.jpg');
    expect(photo.ok && photo.value?.missingAt).toBeNull();
  });

  it('replaces the sighting and marks the superseded photo missing when a file is edited in place', async () => {
    const { deps, fs } = buildDeps();
    fs.addFile('/work/photos/a.jpg', { content: 'original-bytes', mtimeMs: 1000, size: 14 });
    await runPhotoScan(deps, { root: '/work/photos' });

    fs.addFile('/work/photos/a.jpg', { content: 'edited-bytes', mtimeMs: 2000, size: 12 });
    const result = await runPhotoScan(deps, { root: '/work/photos' });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.photosNew).toBe(1);

    const status = await photosStatus(deps, { root: '/work/photos' });
    expect(status.ok && status.value.counts).toMatchObject({ paths: 1, missing: 1 });

    const edited = await deps.photos.getPhoto(fingerprintOf('edited-bytes'));
    expect(edited.ok && edited.value?.currentPath).toBe('/work/photos/a.jpg');
    expect(edited.ok && edited.value?.missingAt).toBeNull();

    const superseded = await deps.photos.getPhoto(fingerprintOf('original-bytes'));
    expect(superseded.ok && superseded.value?.missingAt).not.toBeNull();
  });

  it('aborts between batches and reports the cancellation as processing_error', async () => {
    const { deps, fs } = buildDeps();
    fs.addFile('/work/photos/a.jpg', { content: 'a' });
    const controller = new AbortController();
    controller.abort();

    const result = await runPhotoScan(deps, { root: '/work/photos' }, {
      signal: controller.signal,
      reportProgress: () => Promise.resolve({ ok: true, value: undefined }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('processing_error');
  });
});

describe('enqueuePhotoScan', () => {
  it('rejects a missing root before enqueueing a job', async () => {
    const { deps } = buildDeps();
    const result = await enqueuePhotoScan(deps, { root: '/work/missing' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('folder_not_found');
  });

  it('rejects a file root as not_a_directory', async () => {
    const { deps, fs } = buildDeps();
    fs.addFile('/work/a.jpg', { content: 'a' });
    const result = await enqueuePhotoScan(deps, { root: '/work/a.jpg' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_a_directory');
  });

  it('enqueues and completes a scan job', async () => {
    const { deps, fs, jobs } = buildDeps();
    fs.addFile('/work/photos/a.jpg', { content: 'a' });
    const enqueued = await enqueuePhotoScan(deps, { root: '/work/photos' });
    expect(enqueued.ok).toBe(true);
    if (!enqueued.ok) return;
    const record = await jobs.get(enqueued.value.jobId);
    expect(record.ok && record.value?.status).toBe('completed');
  });
});

describe('photosForget', () => {
  it('deletes every photo under a root with no surviving sightings elsewhere', async () => {
    const { deps, fs } = buildDeps();
    fs.addFile('/work/photos/a.jpg', { content: 'a' });
    fs.addFile('/work/photos/b.jpg', { content: 'b' });
    await runPhotoScan(deps, { root: '/work/photos' });

    const forgotten = await photosForget(deps, { root: '/work/photos' });

    expect(forgotten.ok).toBe(true);
    expect(forgotten.ok && forgotten.value).toMatchObject({ pathsRemoved: 2, photosDeleted: 2, photosRepointed: 0 });
    const status = await photosStatus(deps, {});
    expect(status.ok && status.value.counts.photos).toBe(0);
  });

  it('re-points the owner instead of deleting when a sighting survives outside the forgotten root', async () => {
    const { deps, fs } = buildDeps();
    fs.addFile('/work/photos/a.jpg', { content: 'a', mtimeMs: 1 });
    await runPhotoScan(deps, { root: '/work/photos' });
    fs.addFile('/work/backup/a.jpg', { content: 'a', mtimeMs: 1 });
    await runPhotoScan(deps, { root: '/work/backup' });

    const forgotten = await photosForget(deps, { root: '/work/photos' });

    expect(forgotten.ok).toBe(true);
    expect(forgotten.ok && forgotten.value).toMatchObject({ pathsRemoved: 1, photosDeleted: 0, photosRepointed: 1 });
    const fingerprint = fingerprintOf('a');
    const photo = await deps.photos.getPhoto(fingerprint);
    expect(photo.ok && photo.value?.currentPath).toBe('/work/backup/a.jpg');
  });

  it('deletes proxy and thumbnail artifacts for a deleted fingerprint, and keeps a surviving fingerprint\'s artifacts', async () => {
    const { deps, fs } = buildDeps();
    fs.addFile('/work/photos/a.jpg', { content: 'a' });
    fs.addFile('/work/photos/b.jpg', { content: 'b' });
    await runPhotoScan(deps, { root: '/work/photos' });
    const fingerprintA = fingerprintOf('a');
    const fingerprintB = fingerprintOf('b');
    await fs.deleteFile(`/home/.ai-video-cataloger/photo-artifacts/thumbs/${fingerprintB}.jpg`);

    const forgotten = await photosForget(deps, { root: '/work/photos' });

    expect(forgotten.ok).toBe(true);
    if (!forgotten.ok) return;
    expect(forgotten.value.artifactPaths.sort()).toEqual([
      `/home/.ai-video-cataloger/photo-artifacts/proxies/${fingerprintA}.jpg`,
      `/home/.ai-video-cataloger/photo-artifacts/proxies/${fingerprintB}.jpg`,
      `/home/.ai-video-cataloger/photo-artifacts/thumbs/${fingerprintA}.jpg`,
    ].sort());
  });
});

describe('runPhotoProxiesPass', () => {
  it('is idempotent: a second non-force run skips the present artifacts and never calls the port again; force reprocesses', async () => {
    const { deps, fs, photoMedia } = buildDeps();
    fs.addFile('/work/photos/a.jpg', { content: 'a' });
    fs.addFile('/work/photos/b.jpg', { content: 'b' });
    await runPhotoScan(deps, { root: '/work/photos' });
    expect(photoMedia.calls.length).toBe(2);

    const second = await runPhotoProxiesPass(deps, { root: '/work/photos', force: false });
    expect(second.ok).toBe(true);
    expect(second.ok && second.value).toMatchObject({ candidates: 2, generated: 0, skippedExisting: 2, failed: 0 });
    expect(photoMedia.calls.length).toBe(2);

    const forced = await runPhotoProxiesPass(deps, { root: '/work/photos', force: true });
    expect(forced.ok).toBe(true);
    expect(forced.ok && forced.value).toMatchObject({ candidates: 2, generated: 2, skippedExisting: 0 });
    expect(photoMedia.calls.length).toBe(4);
  });

  it('regenerates a proxy whose artifact file disappeared even though the row still says done', async () => {
    const { deps, fs, photoMedia } = buildDeps();
    fs.addFile('/work/photos/a.jpg', { content: 'a' });
    await runPhotoScan(deps, { root: '/work/photos' });
    const fingerprint = fingerprintOf('a');
    const deleted = await fs.deleteFile(`/home/.ai-video-cataloger/photo-artifacts/proxies/${fingerprint}.jpg`);
    expect(deleted.ok).toBe(true);

    const pass = await runPhotoProxiesPass(deps, { root: '/work/photos', force: false });

    expect(pass.ok && pass.value).toMatchObject({ candidates: 1, generated: 1, skippedExisting: 0 });
    expect(photoMedia.calls.length).toBe(2);
    const restored = await fs.exists(`/home/.ai-video-cataloger/photo-artifacts/proxies/${fingerprint}.jpg`);
    expect(restored.ok && restored.value).toBe(true);
  });

  it('marks a per-candidate port failure with the failing code, without failing the whole pass', async () => {
    const { deps, photos, photoMedia } = buildDeps();
    await seedPhoto(photos, fingerprintOf('a'), '/work/photos/a.jpg');
    await seedPhoto(photos, fingerprintOf('b'), '/work/photos/b.jpg');
    photoMedia.failFor('/work/photos/a.jpg');

    const pass = await runPhotoProxiesPass(deps, { root: '/work/photos', force: false });
    expect(pass.ok).toBe(true);
    expect(pass.ok && pass.value).toMatchObject({ candidates: 2, generated: 1, failed: 1 });

    const status = await photosStatus(deps, {});
    expect(status.ok && status.value.counts).toMatchObject({ proxied: 1, proxyFailed: 1 });
  });

  it('records a thumb-step failure as a completed proxy with a null thumb', async () => {
    const { deps, photos, photoMedia } = buildDeps();
    await seedPhoto(photos, fingerprintOf('a'), '/work/photos/a.jpg');
    photoMedia.outcomeFor('/work/photos/a.jpg', { thumbWidth: null, thumbHeight: null });

    const pass = await runPhotoProxiesPass(deps, { root: '/work/photos', force: false });
    expect(pass.ok && pass.value).toMatchObject({ candidates: 1, generated: 1, thumbFailed: 1, failed: 0 });

    const status = await photosStatus(deps, {});
    expect(status.ok && status.value.counts).toMatchObject({ proxied: 1, proxyFailed: 0 });
  });
});

describe('photos scan auto-chains proxies', () => {
  it('folds a successful chained proxies pass into the scan summary', async () => {
    const { deps, fs } = buildDeps();
    fs.addFile('/work/photos/a.jpg', { content: 'a' });
    fs.addFile('/work/photos/b.jpg', { content: 'b' });

    const result = await runPhotoScan(deps, { root: '/work/photos' });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.proxies).toEqual({
      ran: true,
      generated: 2,
      skippedExisting: 0,
      failed: 0,
      skippedReason: null,
    });
  });

  it('folds a failed chained proxies pass as skippedReason "failed" without failing the scan', async () => {
    const { deps, fs, photos } = buildDeps();
    fs.addFile('/work/photos/a.jpg', { content: 'a' });
    photos.listProxyCandidates = () => Promise.resolve({ ok: false, error: appError('internal', 'boom') });

    const result = await runPhotoScan(deps, { root: '/work/photos' });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.proxies).toMatchObject({ ran: false, skippedReason: 'failed' });
  });
});

describe('enqueuePhotoProxies', () => {
  it('rejects a missing root before enqueueing a job', async () => {
    const { deps } = buildDeps();
    const result = await enqueuePhotoProxies(deps, { root: '/work/missing', force: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('folder_not_found');
  });

  it('enqueues and completes a proxies job', async () => {
    const { deps, fs, jobs } = buildDeps();
    fs.addFile('/work/photos/a.jpg', { content: 'a' });
    const enqueued = await enqueuePhotoProxies(deps, { root: '/work/photos', force: false });
    expect(enqueued.ok).toBe(true);
    if (!enqueued.ok) return;
    const record = await jobs.get(enqueued.value.jobId);
    expect(record.ok && record.value?.status).toBe('completed');
  });
});

describe('photosTree, photosList, photosDetail', () => {
  it('tree lists scanned roots, list pages photos with artifact paths, detail composes proxy/thumb paths', async () => {
    const { deps, fs } = buildDeps();
    fs.addFile('/work/photos/a.jpg', { content: 'a' });
    await runPhotoScan(deps, { root: '/work/photos' });
    const fingerprint = fingerprintOf('a');

    const tree = await photosTree(deps);
    expect(tree.ok && tree.value.roots).toEqual([
      expect.objectContaining({ root: '/work/photos', photos: 1 }),
    ]);

    const list = await photosList(deps, { offset: 0, limit: 10 });
    expect(list.ok).toBe(true);
    const listedItem = list.ok ? list.value.items[0] : undefined;
    expect(listedItem?.fingerprint).toBe(fingerprint);
    expect(listedItem?.proxyPath).toContain(fingerprint);

    const detail = await photosDetail(deps, { fingerprint });
    expect(detail.ok && detail.value?.proxyPath).toContain(fingerprint);
    expect(detail.ok && detail.value?.ownerPath).toBe('/work/photos/a.jpg');

    const missing = await photosDetail(deps, { fingerprint: 'ph_ffffffffffffffff' });
    expect(missing.ok && missing.value).toBeNull();
  });
});
