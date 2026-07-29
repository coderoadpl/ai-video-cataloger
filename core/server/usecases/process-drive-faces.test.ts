import { describe, expect, it } from 'vitest';

import { appError, normalizeEmbedding, ok, type AppError, type Result } from '@core/domain/index.js';

import { JOB_CANCELLED_ERROR_MESSAGE, type AlignedFaceCrop, type DependencyStatus, type FaceDetection, type FaceEnginePort, type JobProgress } from '../ports.js';
import { processDrive, type ProcessDriveInput } from './process-drive.js';
import {
  InMemoryAnalyzer,
  InMemoryCatalogs,
  InMemoryConfig,
  InMemoryDownloads,
  InMemoryFileSystem,
  InMemoryGlobalCatalogStore,
  InMemoryMedia,
  InMemorySpendLedger,
  InMemoryTranscriber,
} from '../../../test/server/usecases/test-fakes.js';

const unit128 = (): number[] => normalizeEmbedding(Array.from({ length: 128 }, (_value, index) => (index === 0 ? 1 : 0.001)));

class StubFaceEngine implements FaceEnginePort {
  loadCalls = 0;
  failLoad = false;
  detectCalls = 0;
  abortController: AbortController | null = null;
  embedding = unit128();
  detection: FaceDetection = {
    bbox: { x: 0, y: 0, width: 200, height: 200 },
    landmarks: {
      leftEye: { x: 70, y: 90 },
      rightEye: { x: 130, y: 90 },
      nose: { x: 100, y: 120 },
      leftMouth: { x: 80, y: 160 },
      rightMouth: { x: 120, y: 160 },
    },
    score: 0.95,
  };

  load(): Promise<Result<void, AppError>> {
    this.loadCalls += 1;
    if (this.abortController !== null) {
      this.abortController.abort();
      return Promise.resolve({ ok: false, error: appError('processing_error', JOB_CANCELLED_ERROR_MESSAGE) });
    }
    if (this.failLoad) return Promise.resolve({ ok: false, error: appError('provider_error', 'stub engine failed to load') });
    return Promise.resolve(ok(undefined));
  }

  detect(): Promise<Result<FaceDetection[], AppError>> {
    this.detectCalls += 1;
    return Promise.resolve(ok([this.detection]));
  }

  align(frameJpegPath: string, detection: FaceDetection): Promise<Result<AlignedFaceCrop, AppError>> {
    return Promise.resolve(ok({ frameJpegPath, detection, width: 112, height: 112, data: new Uint8Array(112 * 112 * 3) }));
  }

  embed(): Promise<Result<Float32Array, AppError>> {
    return Promise.resolve(ok(new Float32Array(this.embedding)));
  }

  writeCrop(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }

  dispose(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }

  dependency(): Promise<Result<DependencyStatus, AppError>> {
    return Promise.resolve(ok({ name: 'faces', available: true, version: null, source: 'managed', path: null, installHint: '' }));
  }
}

const baseInput: ProcessDriveInput = {
  root: '/drive',
  frames: 3,
  skipRename: true,
  skipRenameExplicit: true,
  verbose: false,
  timeout: 120,
  whisper: 'skip',
  whisperExplicit: true,
  whisperModel: 'base',
};

const addVideo = (fs: InMemoryFileSystem, videoPath: string, hash: string): void => {
  fs.addFile(videoPath, { size: 1024, mtimeMs: new Date('2026-01-01T00:00:00.000Z').getTime(), hash });
};

const makeDeps = (fs = new InMemoryFileSystem('/drive')) => {
  const downloads = new InMemoryDownloads();
  downloads.downloadedArtifacts.add('face-detector/yunet-2023mar');
  downloads.downloadedArtifacts.add('face-embedder/sface-2021dec');
  return {
    catalogs: new InMemoryCatalogs(),
    config: new InMemoryConfig(),
    fs,
    media: new InMemoryMedia(fs),
    transcriber: new InMemoryTranscriber(fs),
    analyzer: new InMemoryAnalyzer(),
    globalCatalog: new InMemoryGlobalCatalogStore(),
    spendLedger: new InMemorySpendLedger(),
    downloads,
    faceEngine: new StubFaceEngine(),
  };
};

const enableFaces = async (deps: { config: InMemoryConfig }): Promise<void> => {
  await deps.config.set({ kind: 'home' }, 'faces_enabled', 'true');
};

const recordingProgress = (events: JobProgress[], signal = new AbortController().signal) => ({
  signal,
  reportProgress: (progress: JobProgress): Promise<Result<void, AppError>> => {
    events.push(progress);
    return Promise.resolve(ok(undefined));
  },
});

describe('process-drive faces pass', () => {
  it('indexes faces over the run root when faces are enabled and artifacts are present', async () => {
    const deps = makeDeps();
    await enableFaces(deps);
    addVideo(deps.fs, '/drive/clip.mp4', 'hash-clip');
    const events: JobProgress[] = [];

    const run = await processDrive(deps, baseInput, recordingProgress(events), { runId: 'run-faces' });

    expect(run.ok).toBe(true);
    if (!run.ok) throw new Error(run.error.message);
    expect(run.value.faces).toMatchObject({ ran: true, skippedReason: null, filesIndexed: 1 });
    const observations = await deps.globalCatalog.listFaceObservations({});
    expect(observations.ok && observations.value.length).toBeGreaterThan(0);
    expect(events).toContainEqual(expect.objectContaining({
      step: 'run-summary',
      data: expect.objectContaining({ faces: expect.objectContaining({ ran: true }) }),
    }));
  });

  it('leaves faces out of the summary and never loads the engine when faces are off', async () => {
    const deps = makeDeps();
    addVideo(deps.fs, '/drive/clip.mp4', 'hash-clip');
    const events: JobProgress[] = [];

    const run = await processDrive(deps, baseInput, recordingProgress(events), { runId: 'run-off' });

    expect(run.ok).toBe(true);
    expect(run.ok && run.value.faces).toBeUndefined();
    expect(events.some((event) => String(event.step).startsWith('faces_'))).toBe(false);
    expect(deps.faceEngine.loadCalls).toBe(0);
  });

  it('skips the pass with artifacts_missing when the face models are not installed', async () => {
    const deps = makeDeps();
    await enableFaces(deps);
    deps.downloads.downloadedArtifacts.clear();
    addVideo(deps.fs, '/drive/clip.mp4', 'hash-clip');
    const events: JobProgress[] = [];

    const run = await processDrive(deps, baseInput, recordingProgress(events), { runId: 'run-missing-artifacts' });

    expect(run.ok).toBe(true);
    if (!run.ok) throw new Error(run.error.message);
    expect(run.value.filesDone).toBe(1);
    expect(run.value.faces).toMatchObject({ ran: false, skippedReason: 'artifacts_missing', error: null });
    expect(events).toContainEqual(expect.objectContaining({
      step: 'faces_pass_skipped',
      data: expect.objectContaining({ reason: 'artifacts_missing' }),
    }));
  });

  it('skips the pass with the flag reason under --skip-faces', async () => {
    const deps = makeDeps();
    await enableFaces(deps);
    addVideo(deps.fs, '/drive/clip.mp4', 'hash-clip');

    const run = await processDrive(deps, { ...baseInput, skipFaces: true }, undefined, { runId: 'run-skip-flag' });

    expect(run.ok).toBe(true);
    if (!run.ok) throw new Error(run.error.message);
    expect(run.value.faces?.skippedReason).toBe('flag');
    expect(deps.faceEngine.loadCalls).toBe(0);
  });

  it('never fails the drive run when the faces pass itself fails', async () => {
    const deps = makeDeps();
    await enableFaces(deps);
    deps.faceEngine.failLoad = true;
    addVideo(deps.fs, '/drive/clip.mp4', 'hash-clip');
    const events: JobProgress[] = [];

    const run = await processDrive(deps, baseInput, recordingProgress(events), { runId: 'run-pass-fails' });

    expect(run.ok).toBe(true);
    if (!run.ok) throw new Error(run.error.message);
    expect(run.value.filesFailed).toBe(0);
    expect(run.value.faces?.skippedReason).toBe('failed');
    expect(run.value.faces?.error?.code).toBe('provider_error');
    expect(events).toContainEqual(expect.objectContaining({
      step: 'faces_pass_skipped',
      data: expect.objectContaining({ reason: 'failed', message: expect.any(String) }),
    }));
  });

  it('skips the pass entirely when a run aborts on consecutive failures', async () => {
    const analyzer = new InMemoryAnalyzer();
    analyzer.analyzeError = appError('provider_error', 'Analyzer unavailable');
    const deps = { ...makeDeps(), analyzer };
    await enableFaces(deps);
    for (const name of ['one', 'two', 'three', 'four', 'five']) {
      addVideo(deps.fs, `/drive/${name}.mp4`, `hash-${name}`);
    }

    const run = await processDrive(deps, baseInput, undefined, {
      runId: 'run-abort-faces',
      jitter: () => 0,
      sleep: () => Promise.resolve(),
    });

    expect(run).toMatchObject({ ok: false, error: { code: 'drive_run_aborted' } });
    expect(deps.faceEngine.loadCalls).toBe(0);
  });

  it('skips the pass with unavailable when the composition has no face engine or downloads', async () => {
    const fs = new InMemoryFileSystem('/drive');
    const deps = {
      catalogs: new InMemoryCatalogs(),
      config: new InMemoryConfig(),
      fs,
      media: new InMemoryMedia(fs),
      transcriber: new InMemoryTranscriber(fs),
      analyzer: new InMemoryAnalyzer(),
      globalCatalog: new InMemoryGlobalCatalogStore(),
      spendLedger: new InMemorySpendLedger(),
    };
    await enableFaces(deps);
    addVideo(fs, '/drive/clip.mp4', 'hash-clip');

    const run = await processDrive(deps, baseInput, undefined, { runId: 'run-unavailable' });

    expect(run.ok).toBe(true);
    expect(run.ok && run.value.faces?.skippedReason).toBe('unavailable');
  });

  it('reports cancelled when the job is aborted while the pass is starting', async () => {
    const deps = makeDeps();
    await enableFaces(deps);
    addVideo(deps.fs, '/drive/clip.mp4', 'hash-clip');
    const controller = new AbortController();
    deps.faceEngine.abortController = controller;
    const events: JobProgress[] = [];

    const run = await processDrive(deps, baseInput, recordingProgress(events, controller.signal), { runId: 'run-cancelled' });

    expect(run.ok).toBe(true);
    if (!run.ok) throw new Error(run.error.message);
    expect(run.value.faces?.skippedReason).toBe('cancelled');
    expect(events).toContainEqual(expect.objectContaining({
      step: 'faces_pass_skipped',
      data: expect.objectContaining({ reason: 'cancelled' }),
    }));
  });
});
