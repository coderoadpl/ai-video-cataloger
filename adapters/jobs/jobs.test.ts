import { describe, expect, it } from 'vitest';

import { appError, ok } from '@core/domain/index.js';
import type { JobRecord } from '@core/server/index.js';

import { InProcessJobsPort } from './index.js';

describe('InProcessJobsPort', () => {
  it('atomically rejects duplicate active resource keys', async () => {
    const jobs = new InProcessJobsPort();
    let release: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = await jobs.enqueue({
      kind: 'process',
      payload: { videoPath: '/work/clip.mp4' },
      resourceKey: '/work/clip.mp4',
      run: async () => {
        await waiting;
        return ok({});
      },
    });
    const second = await jobs.enqueue({
      kind: 'process',
      payload: { videoPath: '/work/clip.mp4' },
      resourceKey: '/work/clip.mp4',
      run: () => Promise.resolve(ok({})),
    });
    release?.();

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });

  it('records typed progress sequence from an async in-process job', async () => {
    const jobs = new InProcessJobsPort({ nowIso: tickingClock() });

    const enqueued = await jobs.enqueue({
      kind: 'process',
      payload: { videoPath: '/work/clip.mp4' },
      run: async (context) => {
        const first = await context.reportProgress({
          step: 'extracting_frames',
          percentage: 20,
          current: 1,
          total: 1,
          stepNumber: 1,
          totalSteps: 5,
          data: { video: '/work/clip.mp4' },
        });
        if (!first.ok) return first;
        const second = await context.reportProgress({
          step: 'extracting_audio',
          percentage: 40,
          current: 1,
          total: 1,
          stepNumber: 2,
          totalSteps: 5,
        });
        if (!second.ok) return second;
        return ok({ video: 'clip.mp4', path: '/work/clip.mp4', status: 'completed' });
      },
    });
    if (!enqueued.ok) throw new Error(enqueued.error.message);

    const completed = await waitForJob(jobs, enqueued.value.jobId, (record) => record.status === 'completed');
    const listed = await jobs.list();

    expect(completed).toMatchObject({
      jobId: 'job-1',
      kind: 'process',
      status: 'completed',
      progress: { step: 'extracting_audio', percentage: 40, stepNumber: 2, totalSteps: 5 },
      result: { video: 'clip.mp4', path: '/work/clip.mp4', status: 'completed' },
      error: null,
    });
    expect(completed.progressEvents).toEqual([
      { sequence: 1, progress: expect.objectContaining({ step: 'extracting_frames' }) },
      { sequence: 2, progress: expect.objectContaining({ step: 'extracting_audio' }) },
    ]);
    expect(listed).toMatchObject({ ok: true, value: [expect.objectContaining({ jobId: 'job-1' })] });
  });

  it('cancels a running job at the next progress boundary', async () => {
    const jobs = new InProcessJobsPort({ nowIso: tickingClock() });
    const gate = deferred();

    const enqueued = await jobs.enqueue({
      kind: 'process',
      payload: { videoPath: '/work/clip.mp4' },
      run: async (context) => {
        const first = await context.reportProgress({ step: 'extracting_frames', percentage: 20 });
        if (!first.ok) return first;
        await gate.promise;
        return context.reportProgress({ step: 'extracting_audio', percentage: 40 });
      },
    });
    if (!enqueued.ok) throw new Error(enqueued.error.message);
    await waitForJob(jobs, enqueued.value.jobId, (record) => record.progress?.step === 'extracting_frames');

    const cancelled = await jobs.cancel(enqueued.value.jobId);
    const settling = await readJob(jobs, enqueued.value.jobId);
    gate.resolve();
    const terminal = await waitForJob(jobs, enqueued.value.jobId, (record) => record.status === 'cancelled');

    expect(cancelled).toEqual(ok({ jobId: 'job-1', cancelled: true }));
    expect(settling.status).toBe('running');
    expect(terminal).toMatchObject({
      status: 'cancelled',
      progress: { step: 'extracting_frames', percentage: 20 },
      error: null,
    });
  });

  it('keeps terminal statuses queryable', async () => {
    const jobs = new InProcessJobsPort({ nowIso: tickingClock() });
    const completed = await jobs.enqueue({
      kind: 'whisper_download',
      payload: { modelName: 'base' },
      run: () => Promise.resolve(ok({ model: 'base', downloaded: true })),
    });
    const failed = await jobs.enqueue({
      kind: 'local_ai_pull',
      payload: { tag: 'missing:model' },
      run: () => Promise.resolve({ ok: false, error: appError('ollama_unavailable', 'Ollama unavailable') }),
    });
    if (!completed.ok) throw new Error(completed.error.message);
    if (!failed.ok) throw new Error(failed.error.message);

    const completedRecord = await waitForJob(jobs, completed.value.jobId, (record) => record.status === 'completed');
    const failedRecord = await waitForJob(jobs, failed.value.jobId, (record) => record.status === 'failed');
    const completedCancel = await jobs.cancel(completed.value.jobId);

    expect(completedRecord).toMatchObject({ jobId: 'job-1', status: 'completed', result: { model: 'base', downloaded: true } });
    expect(failedRecord).toMatchObject({
      jobId: 'job-2',
      status: 'failed',
      error: { code: 'ollama_unavailable', message: 'Ollama unavailable' },
    });
    expect(completedCancel).toEqual(ok({ jobId: 'job-1', cancelled: false }));
  });

  it('isolates concurrent jobs', async () => {
    const jobs = new InProcessJobsPort({ nowIso: tickingClock() });
    const firstGate = deferred();
    const secondGate = deferred();

    const first = await jobs.enqueue({
      kind: 'process',
      payload: { videoPath: '/work/one.mp4' },
      run: async (context) => {
        const progress = await context.reportProgress({ step: 'extracting_frames', percentage: 20, data: { video: '/work/one.mp4' } });
        if (!progress.ok) return progress;
        await firstGate.promise;
        return ok({ path: '/work/one.mp4' });
      },
    });
    const second = await jobs.enqueue({
      kind: 'process',
      payload: { videoPath: '/work/two.mp4' },
      run: async (context) => {
        const progress = await context.reportProgress({ step: 'transcribing_audio', percentage: 60, data: { video: '/work/two.mp4' } });
        if (!progress.ok) return progress;
        await secondGate.promise;
        return ok({ path: '/work/two.mp4' });
      },
    });
    if (!first.ok) throw new Error(first.error.message);
    if (!second.ok) throw new Error(second.error.message);

    await waitForJob(jobs, first.value.jobId, (record) => record.progress?.step === 'extracting_frames');
    await waitForJob(jobs, second.value.jobId, (record) => record.progress?.step === 'transcribing_audio');
    firstGate.resolve();
    const firstDone = await waitForJob(jobs, first.value.jobId, (record) => record.status === 'completed');
    const secondStillRunning = await readJob(jobs, second.value.jobId);
    secondGate.resolve();
    const secondDone = await waitForJob(jobs, second.value.jobId, (record) => record.status === 'completed');

    expect(firstDone).toMatchObject({ status: 'completed', progress: { data: { video: '/work/one.mp4' } } });
    expect(secondStillRunning).toMatchObject({ status: 'running', progress: { data: { video: '/work/two.mp4' } } });
    expect(secondDone).toMatchObject({ status: 'completed', progress: { step: 'transcribing_audio' } });
  });

  it('rejects jobs without a run function instead of leaving them queued', async () => {
    const jobs = new InProcessJobsPort();

    const result = await jobs.enqueue({ kind: 'process', payload: {} });
    const listed = await jobs.list();

    expect(result).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(listed).toEqual(ok([]));
  });

  it('retains only the newest 200 terminal records', async () => {
    const jobs = new InProcessJobsPort();
    let newestId = '';
    for (let index = 0; index < 205; index += 1) {
      const enqueued = await jobs.enqueue({
        kind: 'process',
        payload: { index },
        run: () => Promise.resolve(ok({ index })),
      });
      if (!enqueued.ok) throw new Error(enqueued.error.message);
      newestId = enqueued.value.jobId;
    }
    await waitForJob(jobs, newestId, (record) => record.status === 'completed');

    const listed = await jobs.list();
    const oldest = await jobs.get('job-1');
    const newest = await jobs.get(newestId);

    expect(listed).toMatchObject({ ok: true, value: expect.any(Array) });
    if (!listed.ok) throw new Error(listed.error.message);
    expect(listed.value).toHaveLength(200);
    expect(oldest).toEqual(ok(null));
    expect(newest).toMatchObject({ ok: true, value: { status: 'completed' } });
  });
});

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
}

const deferred = (): Deferred => {
  let resolveValue: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolveValue = resolve;
  });
  if (resolveValue === undefined) throw new Error('Deferred promise did not initialize');
  return { promise, resolve: resolveValue };
};

const tickingClock = (): (() => string) => {
  let tick = 0;
  return () => {
    const value = `2026-01-01T00:00:${String(tick).padStart(2, '0')}.000Z`;
    tick += 1;
    return value;
  };
};

const waitForJob = async (
  jobs: InProcessJobsPort,
  jobId: string,
  matches: (record: JobRecord) => boolean,
): Promise<JobRecord> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const record = await readJob(jobs, jobId);
    if (matches(record)) return record;
    await sleep(5);
  }
  throw new Error(`Timed out waiting for ${jobId}`);
};

const readJob = async (jobs: InProcessJobsPort, jobId: string): Promise<JobRecord> => {
  const record = await jobs.get(jobId);
  if (!record.ok) throw new Error(record.error.message);
  if (record.value === null) throw new Error(`Job not found: ${jobId}`);
  return record.value;
};

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
