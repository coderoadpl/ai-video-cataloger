import { describe, expect, it, vi } from 'vitest';

import { ok, photoFingerprintFromSha256 } from '@core/domain/index.js';
import { sha256Hex } from '@core/domain/sha256.js';
import { enqueuePhotoProcess, runPhotoScan } from '@core/server/usecases/photos.js';
import { runLibraryTrash } from '@core/server/usecases/library-trash.js';
import {
  FakeExifPort, FakePhotoMediaPort, InMemoryAnalyzer, InMemoryConfig, InMemoryDownloads,
  InMemoryFaceEngine, InMemoryFileSystem, InMemoryGlobalCatalogStore, InMemoryMedia,
  InMemoryPhotosStore,
} from '../../test/server/usecases/test-fakes.js';
import { InProcessJobsPort } from './index.js';

const latch = () => {
  let resolve = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

describe('trash and photo processing lock ordering', () => {
  it('finishes when trash starts immediately before the real chained face pass', async () => {
    const fs = new InMemoryFileSystem('/library');
    const root = '/library/photos';
    fs.addDirectory(root);
    fs.addFile(`${root}/image.jpg`, { content: 'synthetic-photo' });
    const jobs = new InProcessJobsPort();
    const downloads = new InMemoryDownloads();
    const config = new InMemoryConfig();
    const moved: string[] = [];
    const deps = {
      fs, jobs, downloads, config, photos: new InMemoryPhotosStore(),
      globalCatalog: new InMemoryGlobalCatalogStore(), media: new InMemoryMedia(fs),
      photoMedia: new FakePhotoMediaPort(fs), exif: new FakeExifPort(),
      analyzer: new InMemoryAnalyzer(), faceEngine: new InMemoryFaceEngine(),
      trash: { moveToTrash: (path: string) => { moved.push(path); return Promise.resolve(ok(undefined)); } },
    };
    expect(await runPhotoScan(deps, { root })).toMatchObject({ ok: true });
    await config.set({ kind: 'home' }, 'faces_enabled', 'true');
    downloads.downloadedArtifacts.add('face-detector/yunet-2023mar');
    downloads.downloadedArtifacts.add('face-embedder/sface-2021dec');
    const approachingFaces = latch();
    const resumeFaces = latch();
    const trashWaiting = latch();
    const status = downloads.fileArtifactStatus.bind(downloads);
    vi.spyOn(downloads, 'fileArtifactStatus').mockImplementation(async (artifact) => {
      approachingFaces.resolve();
      await resumeFaces.promise;
      return status(artifact);
    });
    const acquire = jobs.acquireResource.bind(jobs);
    vi.spyOn(jobs, 'acquireResource').mockImplementation((key, signal, onWait) => {
      const claim = acquire(key, signal, onWait);
      if (key === `photo-process:${root}`) trashWaiting.resolve();
      return claim;
    });
    const processing = await enqueuePhotoProcess(deps, { root, force: false, batchSize: null });
    expect(processing.ok).toBe(true);
    if (!processing.ok) return;
    await approachingFaces.promise;
    const controller = new AbortController();
    const trash = runLibraryTrash(deps, {
      scope: { kind: 'fingerprints', fingerprints: [photoFingerprintFromSha256(sha256Hex('synthetic-photo'))] },
    }, { jobId: 'trash-probe', signal: controller.signal, reportProgress: () => Promise.resolve(ok(undefined)) });
    await trashWaiting.promise;
    expect(moved).toEqual([]);
    resumeFaces.resolve();
    const settled = latch();
    jobs.onSettled(processing.value.jobId, settled.resolve);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([
        Promise.all([settled.promise, trash]).then(([, result]) => ({ status: 'finished', result })),
        new Promise<{ status: string }>((resolve) => { timer = setTimeout(() => resolve({ status: 'blocked' }), 250); }),
      ]);
      expect(outcome).toMatchObject({ status: 'finished', result: { ok: true } });
      expect(await jobs.get(processing.value.jobId)).toMatchObject({
        ok: true, value: {
          status: 'completed',
          progressEvents: expect.arrayContaining([expect.objectContaining({ progress: expect.objectContaining({ step: 'photo-faces-summary' }) })]),
        },
      });
      expect(moved).toEqual([`${root}/image.jpg`]);
    } finally {
      clearTimeout(timer);
      controller.abort();
      await jobs.cancel(processing.value.jobId);
      await Promise.all([settled.promise, trash]);
      vi.restoreAllMocks();
    }
  });
});
