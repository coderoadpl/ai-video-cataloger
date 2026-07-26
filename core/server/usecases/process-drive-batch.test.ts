import { describe, expect, it } from 'vitest';

import {
  appError,
  batchSubmitRejection,
  defaultGeminiNativeProvider,
  geminiUsageAccounting,
  ok,
  type AppError,
  type Result,
} from '@core/domain/index.js';

import type {
  AnalysisOutput,
  AnalyzerBatchPort,
  AnalyzerBatchRequest,
  AnalyzerBatchStatus,
  AnalyzerBatchSubmission,
  JobExecutionContext,
  JobProgress,
} from '../ports.js';
import { processDrive, type ProcessDriveInput } from './process-drive.js';
import {
  InMemoryAnalyzer,
  InMemoryCatalogs,
  InMemoryConfig,
  InMemoryFileSystem,
  InMemoryGlobalCatalogStore,
  InMemoryMedia,
  InMemoryTranscriber,
} from '../../../test/server/usecases/test-fakes.js';

const RESPONSE_TEXT = 'DESCRIPTION: a boat\nFILENAME: wooden-boat\nTAGS: boat\nTRANSCRIPT:\n[00:01] czesc';

const batchInput: ProcessDriveInput = {
  root: '/drive',
  frames: 3,
  skipRename: true,
  skipRenameExplicit: true,
  verbose: false,
  timeout: 120,
  whisper: 'skip',
  whisperExplicit: true,
  whisperModel: 'base',
  geminiBatch: true,
  geminiBatchExplicit: true,
};

const configuredInput: ProcessDriveInput = {
  ...batchInput,
  geminiBatch: undefined,
  geminiBatchExplicit: undefined,
};

const batchAnalysis = (): AnalysisOutput => ({
  rawResponse: RESPONSE_TEXT,
  usage: geminiUsageAccounting(
    { promptTokens: 1000, candidatesTokens: 500, thoughtsTokens: 500 },
    { pricePerMTokensInput: 0.75, pricePerMTokensOutput: 3.75 },
  ),
  transcript: { text: 'czesc', segments: [{ start: 1, end: 2, text: 'czesc' }] },
});

interface FakeBatchOptions {
  statuses?: AnalyzerBatchStatus[];
  submitError?: AppError;
  uploadErrors?: Map<string, AppError>;
  existingJobName?: string | null;
  retainedUploads?: number;
}

class FakeBatchPort implements AnalyzerBatchPort {
  readonly uploads: string[] = [];
  trace: string[] | null = null;
  readonly submissions: { displayName: string; keys: string[] }[] = [];
  readonly lookups: string[] = [];
  readonly polls: string[] = [];
  readonly released: string[] = [];
  private statusIndex = 0;

  constructor(private readonly options: FakeBatchOptions = {}) {}

  uploadForBatch(input: {
    key: string;
    videoPath: string;
    outputLanguage: string;
  }): Promise<Result<AnalyzerBatchRequest, AppError>> {
    this.uploads.push(input.videoPath);
    const failure = this.options.uploadErrors?.get(input.videoPath);
    if (failure !== undefined) return Promise.resolve({ ok: false, error: failure });
    return Promise.resolve(ok({
      key: input.key,
      videoPath: input.videoPath,
      fileName: `files/${input.key}`,
      fileUri: `https://files/${input.key}`,
      outputLanguage: 'auto',
    }));
  }

  submitBatch(input: {
    displayName: string;
    requests: readonly AnalyzerBatchRequest[];
  }): Promise<Result<AnalyzerBatchSubmission, AppError>> {
    this.submissions.push({ displayName: input.displayName, keys: input.requests.map((request) => request.key) });
    this.trace?.push('submit');
    if (this.options.submitError !== undefined) return Promise.resolve({ ok: false, error: this.options.submitError });
    return Promise.resolve(ok({ jobName: 'batches/42', requestCount: input.requests.length }));
  }

  findBatchByDisplayName(input: { displayName: string }): Promise<Result<string | null, AppError>> {
    this.lookups.push(input.displayName);
    return Promise.resolve(ok(this.options.existingJobName ?? null));
  }

  releaseBatchUploads(input: { fileNames: readonly string[] }): Promise<Result<{ retained: number }, AppError>> {
    this.released.push(...input.fileNames);
    return Promise.resolve(ok({ retained: this.options.retainedUploads ?? 0 }));
  }

  batchStatus(input: { jobName: string; requestKeys: readonly string[] }): Promise<Result<AnalyzerBatchStatus, AppError>> {
    this.polls.push(input.jobName);
    const statuses = this.options.statuses ?? [];
    const status = statuses[Math.min(this.statusIndex, statuses.length - 1)];
    this.statusIndex += 1;
    if (status === undefined) {
      return Promise.resolve({ ok: false, error: appError('provider_error', 'no status configured') });
    }
    return Promise.resolve(ok({
      ...status,
      results: status.results === null
        ? null
        : input.requestKeys.map((key) => status.results?.find((result) => result.key === key)
          ?? { key, outcome: ok(batchAnalysis()) }),
    }));
  }
}

const succeeded = (): AnalyzerBatchStatus => ({ state: 'succeeded', message: null, results: [] });

const recordingProgress = (): { progress: JobExecutionContext; events: JobProgress[] } => {
  const events: JobProgress[] = [];
  const controller = new AbortController();
  return {
    events,
    progress: {
      signal: controller.signal,
      reportProgress: (progress: JobProgress) => {
        events.push(progress);
        return Promise.resolve(ok(undefined));
      },
    },
  };
};

const makeDeps = (batch: AnalyzerBatchPort) => {
  const fs = new InMemoryFileSystem('/drive');
  const config = new InMemoryConfig();
  return {
    catalogs: new InMemoryCatalogs(),
    config,
    fs,
    media: new InMemoryMedia(),
    transcriber: new InMemoryTranscriber(fs),
    analyzer: new InMemoryAnalyzer(),
    analyzerBatch: batch,
    globalCatalog: new InMemoryGlobalCatalogStore(),
  };
};

const useGemini = async (deps: ReturnType<typeof makeDeps>): Promise<void> => {
  await deps.config.set({ kind: 'home' }, 'analyzer_provider', JSON.stringify(defaultGeminiNativeProvider()));
};

const addVideo = (fs: InMemoryFileSystem, videoPath: string, hash: string): void => {
  fs.addFile(videoPath, { size: 1024, mtimeMs: new Date('2026-01-01T00:00:00.000Z').getTime(), hash });
};

const runOptions = { sleep: () => Promise.resolve(), batchPollDelayMs: () => 0 };

describe('gemini batch drive runs', () => {
  it('uploads every candidate, submits one job, and lands each answer through the per-file path', async () => {
    const batch = new FakeBatchPort({ statuses: [{ state: 'running', message: null, results: null }, succeeded()] });
    const deps = makeDeps(batch);
    await useGemini(deps);
    addVideo(deps.fs, '/drive/one.mp4', 'hash-one');
    addVideo(deps.fs, '/drive/nested/two.mp4', 'hash-two');
    const { progress, events } = recordingProgress();

    const result = await processDrive(deps, batchInput, progress, { ...runOptions, runId: 'run-1' });

    expect(result).toMatchObject({ ok: true, value: { filesDone: 2, filesFailed: 0, filesSkipped: 0 } });
    expect(batch.uploads).toEqual(['/drive/one.mp4', '/drive/nested/two.mp4']);
    expect(batch.submissions).toEqual([{ displayName: 'avc-drive-run-1', keys: ['r0', 'r1'] }]);
    expect(deps.analyzer.inputs).toHaveLength(0);

    const steps = events.map((event) => event.step);
    expect(steps).toContain('batch_submitted');
    expect(steps).toContain('batch_poll');
    expect(steps).toContain('batch_completed');
    expect(events.find((event) => event.step === 'batch_submitted')?.data).toMatchObject({
      jobName: 'batches/42',
      requestCount: 2,
      reattached: false,
    });
    expect(events.filter((event) => event.step === 'folder-done')).toHaveLength(2);

    const usage = events.find((event) => event.step === 'analyzing_with_claude' && event.data?.usage !== undefined);
    expect(usage?.data).toMatchObject({
      pricingMode: 'batch',
      usage: { estimatedCostUsd: (1000 * 0.75 + 1000 * 3.75) / 1_000_000 },
    });

    const stored = await deps.globalCatalog.getAnalysis('hash-one');
    expect(stored.ok && stored.value?.description).toBe('a boat');
  });

  it('persists the job before submitting and re-attaches after an interruption instead of submitting twice', async () => {
    const interrupted = new FakeBatchPort({
      statuses: [{ state: 'running', message: null, results: null }],
    });
    const deps = makeDeps(interrupted);
    await useGemini(deps);
    addVideo(deps.fs, '/drive/one.mp4', 'hash-one');

    const first = await processDrive(deps, batchInput, undefined, {
      ...runOptions,
      runId: 'run-1',
      sleep: () => Promise.reject(new Error('killed')),
    }).catch((error: unknown) => error);

    expect(first).toBeInstanceOf(Error);
    expect(interrupted.submissions).toHaveLength(1);
    const persisted = await deps.globalCatalog.latestDriveRun();
    expect(persisted.ok && persisted.value?.batch).toMatchObject({
      displayName: 'avc-drive-run-1',
      jobName: 'batches/42',
      state: 'submitted',
      requests: [{ key: 'r0', videoPath: '/drive/one.mp4', fileUri: 'https://files/r0' }],
    });

    const resumed = new FakeBatchPort({ statuses: [succeeded()], existingJobName: 'batches/42' });
    const { progress, events } = recordingProgress();
    const second = await processDrive({ ...deps, analyzerBatch: resumed }, batchInput, progress, {
      ...runOptions,
      runId: 'run-2',
    });

    expect(second).toMatchObject({ ok: true, value: { runId: 'run-1', filesDone: 1, filesFailed: 0 } });
    expect(resumed.submissions).toHaveLength(0);
    expect(resumed.lookups).toEqual([]);
    expect(resumed.uploads).toEqual([]);
    expect(resumed.polls).toEqual(['batches/42']);
    expect(events.find((event) => event.step === 'batch_submitted')?.data).toMatchObject({
      jobName: 'batches/42',
      reattached: true,
    });
  });

  it('flushes the persisted job identity to disk before the submit call', async () => {
    const trace: string[] = [];
    const batch = new FakeBatchPort({ statuses: [succeeded()] });
    batch.trace = trace;
    const deps = makeDeps(batch);
    class TracingCatalog extends InMemoryGlobalCatalogStore {
      override updateDriveRun(run: Parameters<InMemoryGlobalCatalogStore['updateDriveRun']>[0]) {
        trace.push(run.batch === null ? 'persist-no-batch' : `persist-${run.batch.state}`);
        return super.updateDriveRun(run);
      }

      override flush() {
        trace.push('flush');
        return super.flush();
      }
    }
    const traced = { ...deps, globalCatalog: new TracingCatalog() };
    await useGemini(traced);
    addVideo(traced.fs, '/drive/one.mp4', 'hash-one');

    const result = await processDrive(traced, batchInput, undefined, { ...runOptions, runId: 'run-1' });

    expect(result.ok).toBe(true);
    const submitIndex = trace.indexOf('submit');
    const preparedIndex = trace.indexOf('persist-preparing');
    expect(preparedIndex).toBeGreaterThanOrEqual(0);
    expect(preparedIndex).toBeLessThan(submitIndex);
    expect(trace.slice(preparedIndex, submitIndex)).toContain('flush');
    expect(trace.slice(submitIndex).indexOf('flush')).toBeGreaterThanOrEqual(0);
  });

  it('turns an expired job into per-file failures and still finishes the run', async () => {
    const first = new FakeBatchPort({ statuses: [{ state: 'running', message: null, results: null }] });
    const deps = makeDeps(first);
    await useGemini(deps);
    addVideo(deps.fs, '/drive/one.mp4', 'hash-one');
    await processDrive(deps, batchInput, undefined, {
      ...runOptions,
      runId: 'run-1',
      sleep: () => Promise.reject(new Error('killed')),
    }).catch(() => undefined);

    const expired = new FakeBatchPort({
      statuses: [{ state: 'expired', message: 'gone', results: null }],
      existingJobName: 'batches/42',
    });
    const result = await processDrive({ ...deps, analyzerBatch: expired }, batchInput, undefined, {
      ...runOptions,
      runId: 'run-2',
    });

    expect(result).toMatchObject({ ok: true, value: { filesDone: 0, filesFailed: 1 } });
    if (!result.ok) return;
    expect(result.value.failures[0]).toMatchObject({ path: '/drive/one.mp4', scope: 'file', code: 'provider_error' });
    const stored = await deps.globalCatalog.latestDriveRun();
    expect(stored.ok && stored.value?.batch).toBe(null);
  });

  it('fails the run and clears the job name when the batch job itself fails', async () => {
    const batch = new FakeBatchPort({ statuses: [{ state: 'failed', message: 'quota', results: null }] });
    const deps = makeDeps(batch);
    await useGemini(deps);
    addVideo(deps.fs, '/drive/one.mp4', 'hash-one');

    const result = await processDrive(deps, batchInput, undefined, { ...runOptions, runId: 'run-1' });

    expect(result).toMatchObject({ ok: false, error: { code: 'provider_error' } });
    if (result.ok) return;
    expect(result.error.message).toContain('quota');
    const stored = await deps.globalCatalog.latestDriveRun();
    expect(stored.ok && stored.value?.batch).toBe(null);
  });

  it('records an upload failure per file and batches only what uploaded', async () => {
    const batch = new FakeBatchPort({
      statuses: [succeeded()],
      uploadErrors: new Map([['/drive/one.mp4', appError('provider_error', 'upload rejected')]]),
    });
    const deps = makeDeps(batch);
    await useGemini(deps);
    addVideo(deps.fs, '/drive/one.mp4', 'hash-one');
    addVideo(deps.fs, '/drive/two.mp4', 'hash-two');

    const result = await processDrive(deps, batchInput, undefined, { ...runOptions, runId: 'run-1' });

    expect(result).toMatchObject({ ok: true, value: { filesDone: 1, filesFailed: 1 } });
    expect(batch.submissions[0]?.keys).toEqual(['r0']);
  });

  it('recovers a crash between the submit request and the job-name write by matching the display name, never resubmitting', async () => {
    class DiesInsideSubmit extends FakeBatchPort {
      override submitBatch(input: {
        displayName: string;
        requests: readonly AnalyzerBatchRequest[];
      }): Promise<Result<AnalyzerBatchSubmission, AppError>> {
        void super.submitBatch(input);
        return Promise.reject(new Error('process killed while the submit request was in flight'));
      }
    }
    const dying = new DiesInsideSubmit();
    const deps = makeDeps(dying);
    await useGemini(deps);
    addVideo(deps.fs, '/drive/one.mp4', 'hash-one');

    const first = await processDrive(deps, batchInput, undefined, { ...runOptions, runId: 'run-1' })
      .catch((error: unknown) => error);

    expect(first).toBeInstanceOf(Error);
    expect(dying.submissions).toHaveLength(1);
    const persisted = await deps.globalCatalog.latestDriveRun();
    expect(persisted.ok && persisted.value?.batch).toMatchObject({
      displayName: 'avc-drive-run-1',
      jobName: null,
      state: 'preparing',
      requests: [{ key: 'r0', videoPath: '/drive/one.mp4', fileUri: 'https://files/r0' }],
    });

    const resumed = new FakeBatchPort({ statuses: [succeeded()], existingJobName: 'batches/42' });
    const { progress, events } = recordingProgress();
    const second = await processDrive({ ...deps, analyzerBatch: resumed }, batchInput, progress, {
      ...runOptions,
      runId: 'run-2',
    });

    expect(second).toMatchObject({ ok: true, value: { runId: 'run-1', filesDone: 1, filesFailed: 0 } });
    expect(resumed.lookups).toEqual(['avc-drive-run-1']);
    expect(resumed.submissions).toHaveLength(0);
    expect(resumed.uploads).toEqual([]);
    expect(events.find((event) => event.step === 'batch_submitted')?.data).toMatchObject({
      jobName: 'batches/42',
      reattached: true,
    });
    const settled = await deps.globalCatalog.latestDriveRun();
    expect(settled.ok && settled.value?.batch).toMatchObject({ jobName: 'batches/42', state: 'completed' });
  });

  it('refuses batch mode when the resolved analyzer is not gemini-native', async () => {
    const batch = new FakeBatchPort({ statuses: [succeeded()] });
    const deps = makeDeps(batch);
    addVideo(deps.fs, '/drive/one.mp4', 'hash-one');

    const result = await processDrive(deps, batchInput, undefined, { ...runOptions, runId: 'run-1' });

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_config_value' } });
    expect(batch.submissions).toHaveLength(0);
  });

  it('releases the uploaded batch files once the answers are mapped', async () => {
    const batch = new FakeBatchPort({ statuses: [succeeded()] });
    const deps = makeDeps(batch);
    await useGemini(deps);
    addVideo(deps.fs, '/drive/one.mp4', 'hash-one');
    addVideo(deps.fs, '/drive/two.mp4', 'hash-two');

    const result = await processDrive(deps, batchInput, undefined, { ...runOptions, runId: 'run-1' });

    expect(result.ok).toBe(true);
    expect(batch.released).toEqual(['files/r0', 'files/r1']);
  });

  it('warns once for the whole run when uploads could not be released', async () => {
    const batch = new FakeBatchPort({ statuses: [succeeded()], retainedUploads: 2 });
    const deps = makeDeps(batch);
    await useGemini(deps);
    addVideo(deps.fs, '/drive/one.mp4', 'hash-one');
    addVideo(deps.fs, '/drive/two.mp4', 'hash-two');
    const { progress, events } = recordingProgress();

    const result = await processDrive(deps, batchInput, progress, { ...runOptions, runId: 'run-1' });

    expect(result.ok).toBe(true);
    const warnings = events.filter((event) => event.step === 'batch_uploads_retained');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.data).toMatchObject({ jobName: 'batches/42', retained: 2 });
  });

  it('stays silent about released uploads when every delete succeeded', async () => {
    const batch = new FakeBatchPort({ statuses: [succeeded()] });
    const deps = makeDeps(batch);
    await useGemini(deps);
    addVideo(deps.fs, '/drive/one.mp4', 'hash-one');
    const { progress, events } = recordingProgress();

    await processDrive(deps, batchInput, progress, { ...runOptions, runId: 'run-1' });

    expect(events.filter((event) => event.step === 'batch_uploads_retained')).toHaveLength(0);
  });

  it('stops polling the moment the run is cancelled instead of waiting out the backoff', async () => {
    const batch = new FakeBatchPort({ statuses: [{ state: 'running', message: null, results: null }] });
    const deps = makeDeps(batch);
    await useGemini(deps);
    addVideo(deps.fs, '/drive/one.mp4', 'hash-one');
    const controller = new AbortController();
    const progress = {
      signal: controller.signal,
      reportProgress: (event: JobProgress): Promise<Result<void, AppError>> => {
        if (event.step === 'batch_poll') controller.abort();
        return Promise.resolve(ok(undefined));
      },
    };

    const result = await processDrive(deps, batchInput, progress, {
      ...runOptions,
      runId: 'run-1',
      sleep: () => new Promise(() => undefined),
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'processing_error' } });
  }, 2000);

  it('keeps the display name after an uncertain submit failure so recovery can find the job', async () => {
    const batch = new FakeBatchPort({ submitError: appError('provider_error', 'fetch failed') });
    const deps = makeDeps(batch);
    await useGemini(deps);
    addVideo(deps.fs, '/drive/one.mp4', 'hash-one');

    const result = await processDrive(deps, batchInput, undefined, { ...runOptions, runId: 'run-1' });

    expect(result).toMatchObject({ ok: false, error: { code: 'provider_error' } });
    const stored = await deps.globalCatalog.latestDriveRun();
    expect(stored.ok && stored.value?.batch).toMatchObject({
      displayName: 'avc-drive-run-1',
      jobName: null,
      state: 'preparing',
    });
  });

  it('clears the batch state when the API definitively rejected the submit', async () => {
    const batch = new FakeBatchPort({
      submitError: batchSubmitRejection(appError('provider_error', 'Gemini batch API returned HTTP 400')),
    });
    const deps = makeDeps(batch);
    await useGemini(deps);
    addVideo(deps.fs, '/drive/one.mp4', 'hash-one');

    const result = await processDrive(deps, batchInput, undefined, { ...runOptions, runId: 'run-1' });

    expect(result).toMatchObject({ ok: false, error: { code: 'provider_error' } });
    const stored = await deps.globalCatalog.latestDriveRun();
    expect(stored.ok && stored.value?.batch).toBe(null);
  });

  it('re-attaches the root it interrupted even after another root ran in between', async () => {
    const interrupted = new FakeBatchPort({ statuses: [{ state: 'running', message: null, results: null }] });
    const deps = makeDeps(interrupted);
    await useGemini(deps);
    addVideo(deps.fs, '/drive/one.mp4', 'hash-one');
    addVideo(deps.fs, '/other/two.mp4', 'hash-two');

    await processDrive(deps, batchInput, undefined, {
      ...runOptions,
      runId: 'run-a',
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      sleep: () => Promise.reject(new Error('killed')),
    }).catch(() => undefined);
    expect(interrupted.submissions).toHaveLength(1);

    const otherRoot = new FakeBatchPort({ statuses: [succeeded()] });
    const between = await processDrive({ ...deps, analyzerBatch: otherRoot }, { ...batchInput, root: '/other' }, undefined, {
      ...runOptions,
      runId: 'run-b',
      now: () => new Date('2026-01-01T01:00:00.000Z'),
    });
    expect(between.ok).toBe(true);

    const resumed = new FakeBatchPort({ statuses: [succeeded()], existingJobName: 'batches/42' });
    const second = await processDrive({ ...deps, analyzerBatch: resumed }, batchInput, undefined, {
      ...runOptions,
      runId: 'run-c',
      now: () => new Date('2026-01-01T02:00:00.000Z'),
    });

    expect(second).toMatchObject({ ok: true, value: { runId: 'run-a', filesDone: 1, filesFailed: 0 } });
    expect(resumed.submissions).toHaveLength(0);
    expect(resumed.uploads).toEqual([]);
    expect(resumed.polls).toEqual(['batches/42']);
  });

  it('re-attaches the unfinished run that holds the job, not merely the newest one', async () => {
    const interrupted = new FakeBatchPort({ statuses: [{ state: 'running', message: null, results: null }] });
    const deps = makeDeps(interrupted);
    await useGemini(deps);
    addVideo(deps.fs, '/drive/one.mp4', 'hash-one');

    await processDrive(deps, batchInput, undefined, {
      ...runOptions,
      runId: 'run-a',
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      sleep: () => Promise.reject(new Error('killed')),
    }).catch(() => undefined);
    expect(interrupted.submissions).toHaveLength(1);

    await deps.globalCatalog.startDriveRun({
      runId: 'run-interactive',
      root: '/drive',
      startedAt: '2026-01-01T01:00:00.000Z',
      finishedAt: null,
      foldersTotal: 1,
      foldersDone: 0,
      filesDone: 0,
      filesSkipped: 0,
      filesFailed: 0,
      lastActivityAt: '2026-01-01T01:00:00.000Z',
      batch: null,
    });

    const resumed = new FakeBatchPort({ statuses: [succeeded()], existingJobName: 'batches/42' });
    const second = await processDrive({ ...deps, analyzerBatch: resumed }, batchInput, undefined, {
      ...runOptions,
      runId: 'run-c',
      now: () => new Date('2026-01-01T02:00:00.000Z'),
    });

    expect(second).toMatchObject({ ok: true, value: { runId: 'run-a', filesDone: 1, filesFailed: 0 } });
    expect(resumed.submissions).toHaveLength(0);
    expect(resumed.uploads).toEqual([]);
    expect(resumed.polls).toEqual(['batches/42']);
  });

  it('honours a folder that opts out of the batch root', async () => {
    const batch = new FakeBatchPort({ statuses: [succeeded()] });
    const deps = makeDeps(batch);
    await useGemini(deps);
    await deps.config.set({ kind: 'home' }, 'gemini_batch_mode', 'true');
    await deps.config.set({ kind: 'folder', folder: '/drive/interactive' }, 'gemini_batch_mode', 'false');
    addVideo(deps.fs, '/drive/one.mp4', 'hash-one');
    addVideo(deps.fs, '/drive/interactive/two.mp4', 'hash-two');

    const result = await processDrive(deps, configuredInput, undefined, { ...runOptions, runId: 'run-1' });

    expect(result).toMatchObject({ ok: true, value: { filesDone: 2, filesFailed: 0 } });
    expect(batch.uploads).toEqual(['/drive/one.mp4']);
    expect(batch.submissions[0]?.keys).toEqual(['r0']);
    expect(deps.analyzer.inputs.map((entry) => entry.videoPath)).toEqual(['/drive/interactive/two.mp4']);
  });

  it('honours a folder that opts into batch mode under an interactive root', async () => {
    const batch = new FakeBatchPort({ statuses: [succeeded()] });
    const deps = makeDeps(batch);
    await useGemini(deps);
    await deps.config.set({ kind: 'folder', folder: '/drive/batched' }, 'gemini_batch_mode', 'true');
    addVideo(deps.fs, '/drive/one.mp4', 'hash-one');
    addVideo(deps.fs, '/drive/batched/two.mp4', 'hash-two');

    const result = await processDrive(deps, configuredInput, undefined, { ...runOptions, runId: 'run-1' });

    expect(result).toMatchObject({ ok: true, value: { filesDone: 2, filesFailed: 0 } });
    expect(batch.uploads).toEqual(['/drive/batched/two.mp4']);
    expect(batch.submissions[0]?.keys).toEqual(['r0']);
    expect(deps.analyzer.inputs.map((entry) => entry.videoPath)).toEqual(['/drive/one.mp4']);
  });

  it('keeps a folder with a different api key reference out of the root batch', async () => {
    const batch = new FakeBatchPort({ statuses: [succeeded()] });
    const deps = makeDeps(batch);
    await useGemini(deps);
    await deps.config.set(
      { kind: 'folder', folder: '/drive/other-account' },
      'analyzer_provider',
      JSON.stringify({ ...defaultGeminiNativeProvider(), apiKeyRef: 'gemini-work' }),
    );
    addVideo(deps.fs, '/drive/one.mp4', 'hash-one');
    addVideo(deps.fs, '/drive/other-account/two.mp4', 'hash-two');

    const result = await processDrive(deps, batchInput, undefined, { ...runOptions, runId: 'run-1' });

    expect(result).toMatchObject({ ok: true, value: { filesDone: 2, filesFailed: 0 } });
    expect(batch.uploads).toEqual(['/drive/one.mp4']);
    expect(deps.analyzer.inputs.map((entry) => entry.videoPath)).toEqual(['/drive/other-account/two.mp4']);
  });

  it('keeps a folder with a different output language out of the root batch', async () => {
    const batch = new FakeBatchPort({ statuses: [succeeded()] });
    const deps = makeDeps(batch);
    await useGemini(deps);
    await deps.config.set({ kind: 'folder', folder: '/drive/polish' }, 'output_language', 'pl');
    addVideo(deps.fs, '/drive/one.mp4', 'hash-one');
    addVideo(deps.fs, '/drive/polish/two.mp4', 'hash-two');

    const result = await processDrive(deps, batchInput, undefined, { ...runOptions, runId: 'run-1' });

    expect(result).toMatchObject({ ok: true, value: { filesDone: 2, filesFailed: 0 } });
    expect(batch.uploads).toEqual(['/drive/one.mp4']);
    expect(deps.analyzer.inputs.map((entry) => entry.videoPath)).toEqual(['/drive/polish/two.mp4']);
  });

  it('lets the explicit flag override every folder key', async () => {
    const batch = new FakeBatchPort({ statuses: [succeeded()] });
    const deps = makeDeps(batch);
    await useGemini(deps);
    await deps.config.set({ kind: 'folder', folder: '/drive/interactive' }, 'gemini_batch_mode', 'false');
    addVideo(deps.fs, '/drive/one.mp4', 'hash-one');
    addVideo(deps.fs, '/drive/interactive/two.mp4', 'hash-two');

    const result = await processDrive(deps, batchInput, undefined, { ...runOptions, runId: 'run-1' });

    expect(result).toMatchObject({ ok: true, value: { filesDone: 2, filesFailed: 0 } });
    expect(batch.uploads).toEqual(['/drive/one.mp4', '/drive/interactive/two.mp4']);
    expect(deps.analyzer.inputs).toHaveLength(0);
  });

  it('leaves interactive runs untouched when batch mode is off', async () => {
    const batch = new FakeBatchPort({ statuses: [succeeded()] });
    const deps = makeDeps(batch);
    await useGemini(deps);
    addVideo(deps.fs, '/drive/one.mp4', 'hash-one');

    const result = await processDrive(deps, { ...batchInput, geminiBatch: false }, undefined, {
      ...runOptions,
      runId: 'run-1',
    });

    expect(result).toMatchObject({ ok: true, value: { filesDone: 1 } });
    expect(batch.submissions).toHaveLength(0);
    expect(deps.analyzer.inputs).toHaveLength(1);
  });
});
