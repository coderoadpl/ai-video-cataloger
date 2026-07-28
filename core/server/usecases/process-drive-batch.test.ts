import { describe, expect, it } from 'vitest';

import {
  appError,
  batchSubmitRejection,
  defaultGeminiNativeProvider,
  geminiUsageAccounting,
  ok,
  type AppError,
  type DriveRunBatchState,
  type Result,
} from '@core/domain/index.js';

import type {
  AnalysisOutput,
  AnalyzerBatchPort,
  AnalyzerBatchRequest,
  AnalyzerBatchStatus,
  AnalyzerBatchSubmission,
  DriveRunRecord,
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
  InMemorySpendLedger,
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

const batchAnalysis = (model: string): AnalysisOutput => ({
  rawResponse: RESPONSE_TEXT,
  usage: geminiUsageAccounting(
    { promptTokens: 1000, candidatesTokens: 500, thoughtsTokens: 500 },
    model,
    'batch',
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
  readonly pollModels: string[] = [];
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

  batchStatus(input: { jobName: string; requestKeys: readonly string[]; model: string }): Promise<Result<AnalyzerBatchStatus, AppError>> {
    this.polls.push(input.jobName);
    this.pollModels.push(input.model);
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
          ?? { key, outcome: ok(batchAnalysis(input.model)) }),
    }));
  }
}

class DiesInsideSubmit extends FakeBatchPort {
  override submitBatch(input: {
    displayName: string;
    requests: readonly AnalyzerBatchRequest[];
  }): Promise<Result<AnalyzerBatchSubmission, AppError>> {
    void super.submitBatch(input);
    return Promise.reject(new Error('process killed while the submit request was in flight'));
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
    spendLedger: new InMemorySpendLedger(),
  };
};

const useGemini = async (deps: ReturnType<typeof makeDeps>): Promise<void> => {
  await deps.config.set({ kind: 'home' }, 'analyzer_provider', JSON.stringify(defaultGeminiNativeProvider()));
};

const addVideo = (fs: InMemoryFileSystem, videoPath: string, hash: string): void => {
  fs.addFile(videoPath, { size: 1024, mtimeMs: new Date('2026-01-01T00:00:00.000Z').getTime(), hash });
};

const runOptions = { sleep: () => Promise.resolve(), batchPollDelayMs: () => 0 };

const unfinishedBatchRun = (runId: string, startedAt: string, batch: DriveRunBatchState): DriveRunRecord => ({
  runId,
  root: '/drive',
  startedAt,
  finishedAt: null,
  foldersTotal: 1,
  foldersDone: 0,
  filesDone: 0,
  filesSkipped: 0,
  filesFailed: 0,
  lastActivityAt: startedAt,
  batch,
});

describe('gemini batch drive runs', () => {
  it('uploads every candidate, submits one job, and lands each answer through the per-file path', async () => {
    const batch = new FakeBatchPort({ statuses: [{ state: 'running', message: null, results: null }, succeeded()] });
    const deps = makeDeps(batch);
    await useGemini(deps);
    addVideo(deps.fs, '/drive/one.mp4', 'hash-one');
    addVideo(deps.fs, '/drive/nested/two.mp4', 'hash-two');
    const { progress, events } = recordingProgress();

    const result = await processDrive(deps, batchInput, progress, { ...runOptions, runId: 'run-1' });

    expect(result).toMatchObject({
      ok: true,
      value: {
        filesDone: 2,
        filesFailed: 0,
        filesSkipped: 0,
        costEstimate: { kind: 'estimate', files: 2, estimatedCostUsd: 0.009 },
      },
    });
    expect(deps.spendLedger.entries).toHaveLength(2);
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

  it('names the paid-for jobs of the other unfinished runs it is not adopting', async () => {
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
    await deps.globalCatalog.startDriveRun(unfinishedBatchRun('run-b', '2026-01-01T01:00:00.000Z', {
      displayName: 'avc-drive-run-b',
      jobName: 'batches/99',
      state: 'submitted',
      model: 'gemini-2.5-flash',
      requests: [{ key: 'r0', videoPath: '/drive/one.mp4', fileName: 'files/r0', fileUri: 'https://files/r0' }],
    }));

    const resumed = new FakeBatchPort({ statuses: [succeeded()] });
    const { progress, events } = recordingProgress();
    const second = await processDrive({ ...deps, analyzerBatch: resumed }, batchInput, progress, {
      ...runOptions,
      runId: 'run-c',
      now: () => new Date('2026-01-01T02:00:00.000Z'),
    });

    expect(second).toMatchObject({ ok: true, value: { runId: 'run-b', filesDone: 1 } });
    expect(resumed.polls).toEqual(['batches/99']);
    expect(resumed.submissions).toHaveLength(0);
    const orphans = events.filter((event) => event.step === 'batch_orphan_jobs');
    expect(orphans).toHaveLength(1);
    expect(orphans[0]?.data).toEqual({ adoptedJobName: 'batches/99', jobNames: ['batches/42'] });
  });

  it('stays silent about orphaned jobs when the adopted run is the only one holding a job', async () => {
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

    const resumed = new FakeBatchPort({ statuses: [succeeded()] });
    const { progress, events } = recordingProgress();
    await processDrive({ ...deps, analyzerBatch: resumed }, batchInput, progress, {
      ...runOptions,
      runId: 'run-c',
      now: () => new Date('2026-01-01T02:00:00.000Z'),
    });

    expect(events.filter((event) => event.step === 'batch_orphan_jobs')).toHaveLength(0);
  });

  it('warns when the resolved model no longer matches the job it re-attaches to, and keeps the job', async () => {
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
    const submitted = await deps.globalCatalog.latestDriveRun();
    const submittedModel = submitted.ok ? submitted.value?.batch?.model : null;
    await deps.config.set(
      { kind: 'home' },
      'analyzer_provider',
      JSON.stringify({ ...defaultGeminiNativeProvider(), model: 'gemini-3.0-pro' }),
    );

    const resumed = new FakeBatchPort({ statuses: [succeeded()] });
    const { progress, events } = recordingProgress();
    const second = await processDrive({ ...deps, analyzerBatch: resumed }, batchInput, progress, {
      ...runOptions,
      runId: 'run-c',
      now: () => new Date('2026-01-01T02:00:00.000Z'),
    });

    expect(second).toMatchObject({ ok: true, value: { runId: 'run-a', filesDone: 1, filesFailed: 0 } });
    expect(resumed.polls).toEqual(['batches/42']);
    expect(resumed.submissions).toHaveLength(0);
    const changed = events.filter((event) => event.step === 'batch_model_changed');
    expect(changed).toHaveLength(1);
    expect(changed[0]?.data).toEqual({
      jobName: 'batches/42',
      jobModel: submittedModel,
      resolvedModel: 'gemini-3.0-pro',
    });
    const stored = await deps.globalCatalog.latestDriveRun();
    expect(stored.ok && stored.value?.batch?.model).toBe(submittedModel);
  });

  it('stamps and prices a re-attached answer with the job model, not the one that replaced it', async () => {
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
    const submitted = await deps.globalCatalog.latestDriveRun();
    expect(submitted.ok && submitted.value?.batch?.model).toBe('gemini-3.6-flash');
    await deps.config.set(
      { kind: 'home' },
      'analyzer_provider',
      JSON.stringify(defaultGeminiNativeProvider('gemini-flash-lite-latest')),
    );

    const resumed = new FakeBatchPort({ statuses: [succeeded()] });
    const { progress, events } = recordingProgress();
    const second = await processDrive({ ...deps, analyzerBatch: resumed }, batchInput, progress, {
      ...runOptions,
      runId: 'run-c',
      now: () => new Date('2026-01-01T02:00:00.000Z'),
    });

    expect(second).toMatchObject({ ok: true, value: { filesDone: 1, filesFailed: 0 } });
    expect(resumed.pollModels).toEqual(['gemini-3.6-flash']);
    const file = await deps.globalCatalog.getFile('hash-one');
    expect(file.ok && file.value?.model).toBe('gemini-3.6-flash');
    const usage = events.find((event) => event.step === 'analyzing_with_claude' && event.data?.usage !== undefined);
    expect(usage?.data).toMatchObject({
      model: 'gemini-3.6-flash',
      pricingMode: 'batch',
      usage: { estimatedCostUsd: (1000 * 0.75 + 1000 * 3.75) / 1_000_000 },
    });
  });

  it('keeps the submitted identity when language and prompt version change before re-attachment', async () => {
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
    const submitted = await deps.globalCatalog.latestDriveRun();
    const submittedIdentity = submitted.ok ? submitted.value?.batch?.configIdentity : undefined;
    await deps.config.set({ kind: 'home' }, 'output_language', 'pl');
    deps.analyzer.analysisPromptVersion = 2;
    const interactive = await processDrive(deps, { ...batchInput, geminiBatch: false }, undefined, {
      ...runOptions,
      runId: 'run-b',
      now: () => new Date('2026-01-01T01:00:00.000Z'),
    });

    const resumed = new FakeBatchPort({ statuses: [succeeded()], existingJobName: 'batches/42' });
    const completed = await processDrive({ ...deps, analyzerBatch: resumed }, batchInput, undefined, {
      ...runOptions,
      runId: 'run-c',
      now: () => new Date('2026-01-01T02:00:00.000Z'),
    });
    const variants = await deps.globalCatalog.listVariants('hash-one');
    const selectedConfigId = await deps.globalCatalog.getSelectedConfigId('hash-one');
    const currentConfigId = variants.ok
      ? variants.value.find((variant) => (
        variant.descriptor?.output_language === 'pl' && variant.descriptor.promptVersion === 2
      ))?.configId
      : undefined;

    expect(submittedIdentity).toMatchObject({
      configId: expect.stringMatching(/^cfg_/),
      descriptor: { output_language: 'auto', promptVersion: 1 },
    });
    expect(interactive).toMatchObject({ ok: true, value: { filesDone: 1 } });
    expect(completed).toMatchObject({ ok: true, value: { runId: 'run-a', filesDone: 1, filesSkipped: 0 } });
    expect(variants.ok && variants.value).toHaveLength(2);
    expect(variants.ok && variants.value.map((variant) => variant.descriptor)).toEqual(expect.arrayContaining([
      expect.objectContaining({ output_language: 'auto', promptVersion: 1 }),
      expect.objectContaining({ output_language: 'pl', promptVersion: 2 }),
    ]));
    expect(currentConfigId).toBeDefined();
    expect(selectedConfigId).toEqual({ ok: true, value: currentConfigId });
  });

  it('stamps a display-name re-attach with the model the interrupted submit used', async () => {
    const dying = new DiesInsideSubmit();
    const deps = makeDeps(dying);
    await useGemini(deps);
    addVideo(deps.fs, '/drive/one.mp4', 'hash-one');

    await processDrive(deps, batchInput, undefined, { ...runOptions, runId: 'run-1' }).catch(() => undefined);
    const persisted = await deps.globalCatalog.latestDriveRun();
    expect(persisted.ok && persisted.value?.batch).toMatchObject({
      jobName: null,
      state: 'preparing',
      model: 'gemini-3.6-flash',
    });
    await deps.config.set(
      { kind: 'home' },
      'analyzer_provider',
      JSON.stringify(defaultGeminiNativeProvider('gemini-flash-lite-latest')),
    );

    const resumed = new FakeBatchPort({ statuses: [succeeded()], existingJobName: 'batches/42' });
    const { progress, events } = recordingProgress();
    const second = await processDrive({ ...deps, analyzerBatch: resumed }, batchInput, progress, {
      ...runOptions,
      runId: 'run-2',
    });

    expect(second).toMatchObject({ ok: true, value: { filesDone: 1, filesFailed: 0 } });
    expect(resumed.submissions).toHaveLength(0);
    expect(resumed.pollModels).toEqual(['gemini-3.6-flash']);
    const file = await deps.globalCatalog.getFile('hash-one');
    expect(file.ok && file.value?.model).toBe('gemini-3.6-flash');
    const usage = events.find((event) => event.step === 'analyzing_with_claude' && event.data?.usage !== undefined);
    expect(usage?.data).toMatchObject({
      model: 'gemini-3.6-flash',
      pricingMode: 'batch',
      usage: { estimatedCostUsd: (1000 * 0.75 + 1000 * 3.75) / 1_000_000 },
    });
    const changed = events.filter((event) => event.step === 'batch_model_changed');
    expect(changed).toHaveLength(1);
    expect(changed[0]?.data).toEqual({
      jobName: 'batches/42',
      jobModel: 'gemini-3.6-flash',
      resolvedModel: 'gemini-flash-lite-latest',
    });
    const stored = await deps.globalCatalog.latestDriveRun();
    expect(stored.ok && stored.value?.batch?.model).toBe('gemini-3.6-flash');
  });

  it('releases the uploads of an adopted job whose files another run already processed', async () => {
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

    const interactive = await processDrive(deps, { ...batchInput, geminiBatch: false }, undefined, {
      ...runOptions,
      runId: 'run-b',
      now: () => new Date('2026-01-01T01:00:00.000Z'),
    });
    expect(interactive).toMatchObject({ ok: true, value: { filesDone: 1 } });

    const resumed = new FakeBatchPort({ statuses: [succeeded()] });
    const { progress, events } = recordingProgress();
    const third = await processDrive({ ...deps, analyzerBatch: resumed }, batchInput, progress, {
      ...runOptions,
      runId: 'run-c',
      now: () => new Date('2026-01-01T02:00:00.000Z'),
    });

    expect(third).toMatchObject({ ok: true, value: { runId: 'run-a', filesSkipped: 1 } });
    expect(resumed.polls).toEqual([]);
    expect(resumed.released).toEqual(['files/r0']);
    expect(events.filter((event) => event.step === 'batch_uploads_retained')).toHaveLength(0);
    const adopted = deps.globalCatalog.driveRuns.get('run-a');
    expect(adopted?.batch).toBe(null);
    expect(adopted?.finishedAt).not.toBe(null);
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
