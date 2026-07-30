import { describe, expect, it } from 'vitest';

import { sha256Hex } from '@core/domain/sha256.js';
import { photoFingerprintFromSha256 } from '@core/domain/index.js';

import {
  FakeExifPort,
  InMemoryFileSystem,
  InMemoryJobs,
  InMemoryPhotosStore,
} from '../../../test/server/usecases/test-fakes.js';
import { enqueuePhotoScan, photosForget, photosStatus, runPhotoScan, type PhotosDeps } from './photos.js';

const buildDeps = (): { deps: PhotosDeps; fs: InMemoryFileSystem; photos: InMemoryPhotosStore; exif: FakeExifPort; jobs: InMemoryJobs } => {
  const fs = new InMemoryFileSystem('/work');
  const photos = new InMemoryPhotosStore();
  const exif = new FakeExifPort();
  const jobs = new InMemoryJobs();
  return { deps: { photos, fs, exif, jobs }, fs, photos, exif, jobs };
};

const fingerprintOf = (content: string): string => photoFingerprintFromSha256(sha256Hex(content));

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
});
