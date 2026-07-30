import { describe, expect, it } from 'vitest';

import { sha256Hex } from '@core/domain/sha256.js';
import {
  appError,
  defaultGeminiNativeProvider,
  ok,
  photoFingerprintFromSha256,
  type AppError,
  type Result,
} from '@core/domain/index.js';
import type { JobExecutionContext, JobProgress } from '../ports.js';

import {
  FakeExifPort,
  FakePhotoMediaPort,
  InMemoryAnalyzer,
  InMemoryConfig,
  InMemoryFileSystem,
  InMemoryJobs,
  InMemoryPhotosStore,
  InMemorySpendLedger,
} from '../../../test/server/usecases/test-fakes.js';
import {
  enqueuePhotoProcess,
  enqueuePhotoProxies,
  enqueuePhotoScan,
  photosDetail,
  photosForget,
  photosList,
  photosStatus,
  photosTree,
  resolvePhotoAnalyzerOptions,
  runPhotoProcess,
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
  config: InMemoryConfig;
  analyzer: InMemoryAnalyzer;
  spendLedger: InMemorySpendLedger;
} => {
  const fs = new InMemoryFileSystem('/work');
  const photos = new InMemoryPhotosStore();
  const exif = new FakeExifPort();
  const jobs = new InMemoryJobs();
  const photoMedia = new FakePhotoMediaPort(fs);
  const config = new InMemoryConfig();
  const analyzer = new InMemoryAnalyzer();
  const spendLedger = new InMemorySpendLedger();
  return {
    deps: { photos, fs, exif, jobs, photoMedia, config, analyzer, spendLedger },
    fs,
    photos,
    exif,
    jobs,
    photoMedia,
    config,
    analyzer,
    spendLedger,
  };
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

const seedAnalysisReadyPhoto = async (photos: InMemoryPhotosStore, fingerprint: string, currentPath: string): Promise<void> => {
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
    exifReadAt: now,
    proxyState: 'done',
    proxyWidth: 100,
    proxyHeight: 100,
    thumbState: 'done',
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

const recordingProgress = (events: JobProgress[]): JobExecutionContext => ({
  signal: new AbortController().signal,
  reportProgress: (progress: JobProgress): Promise<Result<void, AppError>> => {
    events.push(progress);
    return Promise.resolve(ok(undefined));
  },
});

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

describe('resolvePhotoAnalyzerOptions', () => {
  it('defaults to the legacy claude harness provider and resolves an explicit provider from config', async () => {
    const { deps, config } = buildDeps();

    const defaulted = await resolvePhotoAnalyzerOptions(deps, '/work/photos');
    expect(defaulted.ok && defaulted.value.provider.family).toBe('harness');

    await config.set({ kind: 'folder', folder: '/work/photos' }, 'analyzer_provider', JSON.stringify({
      family: 'api', providerId: 'openai', baseUrl: 'https://api.openai.com/v1', apiKeyRef: 'openai', model: 'gpt-5.5', maxImageDetail: 'high',
    }));
    const resolved = await resolvePhotoAnalyzerOptions(deps, '/work/photos');
    expect(resolved.ok && resolved.value.provider).toMatchObject({ family: 'api', providerId: 'openai' });
  });
});

describe('runPhotoProcess', () => {
  it('splits a malformed batch, records actual batch_size provenance, and completes ok (P4)', async () => {
    const { deps, photos, analyzer } = buildDeps();
    for (let index = 1; index <= 4; index += 1) {
      await seedAnalysisReadyPhoto(photos, `ph_${String(index).padStart(16, '0')}`, `/work/photos/${String(index)}.jpg`);
    }
    analyzer.photoCallScripts = [
      { kind: 'ok', rawResponse: 'not an array' },
      { kind: 'ok', rawResponse: 'not an array' },
      undefined,
      { kind: 'ok', rawResponse: 'not an array' },
      undefined,
    ];

    const result = await runPhotoProcess(deps, { root: '/work/photos', force: false, batchSize: 4 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates).toBe(4);
    expect(result.value.analysed).toBe(3);
    expect(result.value.failed).toBe(1);
    expect(result.value.splitRetries).toBe(4);
    const rowSizes = [...photos.analyses.values()].map((row) => row.batchSize).sort((left, right) => left - right);
    expect(rowSizes).not.toContain(4);
    expect(rowSizes.filter((size) => size === 1)).toHaveLength(1);
  });

  it('runs idempotently: a second run of the same config sees zero candidates, force overwrites, a different config adds a variant (P5)', async () => {
    const { deps, photos, config } = buildDeps();
    await seedAnalysisReadyPhoto(photos, 'ph_0000000000000001', '/work/photos/a.jpg');

    const first = await runPhotoProcess(deps, { root: '/work/photos', force: false, batchSize: null });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.candidates).toBe(1);
    expect(first.value.analysed).toBe(1);
    const firstConfigId = first.value.configId;

    const second = await runPhotoProcess(deps, { root: '/work/photos', force: false, batchSize: null });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.candidates).toBe(0);
    expect(second.value.skippedExisting).toBe(1);
    expect(second.value.configId).toBe(firstConfigId);

    const forced = await runPhotoProcess(deps, { root: '/work/photos', force: true, batchSize: null });
    expect(forced.ok).toBe(true);
    if (!forced.ok) return;
    expect(forced.value.candidates).toBe(1);
    expect(forced.value.analysed).toBe(1);
    expect([...photos.analyses.values()].filter((row) => row.configId === firstConfigId)).toHaveLength(1);

    await config.set({ kind: 'folder', folder: '/work/photos' }, 'analyzer_provider', JSON.stringify({
      family: 'api', providerId: 'openai', baseUrl: 'https://api.openai.com/v1', apiKeyRef: 'openai', model: 'gpt-5.5', maxImageDetail: 'high',
    }));
    const differentProvider = await runPhotoProcess(deps, { root: '/work/photos', force: false, batchSize: null });
    expect(differentProvider.ok).toBe(true);
    if (!differentProvider.ok) return;
    expect(differentProvider.value.configId).not.toBe(firstConfigId);
    expect(differentProvider.value.candidates).toBe(1);
    expect([...photos.analyses.values()].filter((row) => row.configId === firstConfigId)).toHaveLength(1);
    expect([...photos.analyses.values()].filter((row) => row.configId === differentProvider.value.configId)).toHaveLength(1);
  });

  it('pauses when the monthly Gemini budget is exceeded, keeping already recorded rows and reporting budget_cap_reached (P6)', async () => {
    const { deps, photos, config, analyzer, spendLedger } = buildDeps();
    await seedAnalysisReadyPhoto(photos, 'ph_0000000000000001', '/work/photos/a.jpg');
    await seedAnalysisReadyPhoto(photos, 'ph_0000000000000002', '/work/photos/b.jpg');
    await config.set({ kind: 'folder', folder: '/work/photos' }, 'analyzer_provider', JSON.stringify(defaultGeminiNativeProvider()));
    await config.set({ kind: 'home' }, 'gemini_monthly_budget_usd', '1');
    const currentMonth = new Date().toISOString().slice(0, 7);
    spendLedger.entries.push({
      kind: 'estimate',
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      pricingMode: 'interactive',
      promptTokens: 1_000_000,
      candidatesTokens: 0,
      thoughtsTokens: 0,
      billedOutputTokens: 0,
      totalTokens: 1_000_000,
      inputPerMillionUsd: 10,
      outputPerMillionUsd: 0,
      estimatedCostUsd: 10,
      schemaVersion: 1,
      recordedAt: new Date().toISOString(),
      month: currentMonth,
      providerId: 'gemini',
      videoPath: '/work/photos/prior.jpg',
      runId: 'prior-run',
    });
    const events: JobProgress[] = [];

    const result = await runPhotoProcess(deps, { root: '/work/photos', force: false, batchSize: null }, recordingProgress(events));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('drive_run_aborted');
    expect(events.some((event) => event.step === 'budget_cap_reached')).toBe(true);
    expect(analyzer.analyzePhotosCalls).toHaveLength(0);
    expect(photos.analyses.size).toBe(0);
  });

  it('does not pause under the budget cap or when unset', async () => {
    const { deps, photos, config } = buildDeps();
    await seedAnalysisReadyPhoto(photos, 'ph_0000000000000001', '/work/photos/a.jpg');
    await config.set({ kind: 'home' }, 'gemini_monthly_budget_usd', '1000');

    const result = await runPhotoProcess(deps, { root: '/work/photos', force: false, batchSize: null });

    expect(result.ok).toBe(true);
  });

  it('fails with internal when a budget is set but no spend ledger dependency is available', async () => {
    const { fs, photos, jobs, photoMedia, exif, config, analyzer } = buildDeps();
    await seedAnalysisReadyPhoto(photos, 'ph_0000000000000001', '/work/photos/a.jpg');
    await config.set({ kind: 'home' }, 'gemini_monthly_budget_usd', '1');
    const deps = { fs, photos, jobs, photoMedia, exif, config, analyzer };

    const result = await runPhotoProcess(deps, { root: '/work/photos', force: false, batchSize: null });

    expect(result).toMatchObject({ ok: false, error: { code: 'internal' } });
  });
});

describe('enqueuePhotoProcess', () => {
  it('rejects a missing or non-directory root and enqueues a photo_process job otherwise', async () => {
    const { deps, fs } = buildDeps();

    const missing = await enqueuePhotoProcess(deps, { root: '/nope', force: false, batchSize: null });
    expect(missing).toMatchObject({ ok: false, error: { code: 'folder_not_found' } });

    fs.addFile('/work/file.jpg', { content: 'x' });
    const notADirectory = await enqueuePhotoProcess(deps, { root: '/work/file.jpg', force: false, batchSize: null });
    expect(notADirectory).toMatchObject({ ok: false, error: { code: 'not_a_directory' } });

    fs.addDirectory('/work/photos');
    const enqueued = await enqueuePhotoProcess(deps, { root: '/work/photos', force: false, batchSize: null });
    expect(enqueued.ok).toBe(true);
  });
});
