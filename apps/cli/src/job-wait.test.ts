import { describe, expect, it, vi } from 'vitest';

import type { JobOutput } from '@core/client/index.js';
import { ok } from '@core/domain/index.js';

import { waitForJob } from './job-wait.js';

const steps = [
  'extracting_frames',
  'extracting_audio',
  'transcribing_audio',
  'analyzing_with_claude',
  'renaming_video',
] as const;

const job = (overrides: Partial<JobOutput> = {}): JobOutput => ({
  jobId: 'job-1',
  kind: 'process',
  status: 'running',
  progress: null,
  progressEvents: [],
  error: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('waitForJob', () => {
  it('drains every sequenced progress event exactly once in NDJSON order', async () => {
    const lines: string[] = [];
    const progressEvents = steps.map((step, index) => ({
      sequence: index + 1,
      progress: { step, percentage: (index + 1) * 20 },
    }));

    await waitForJob('job-1', {
      fetchJob: () => Promise.resolve(ok(job({ status: 'completed', progressEvents }))),
      onProgress: (progress) => lines.push(JSON.stringify({ type: 'progress', step: progress.step })),
      onCompleted: () => undefined,
      onError: (error) => {
        throw new Error(error.message);
      },
    });

    expect(lines).toEqual(steps.map((step) => JSON.stringify({ type: 'progress', step })));
  });

  it('allows jobs longer than ten minutes while updatedAt keeps changing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const completed = vi.fn();
    const failed = vi.fn();
    const waiting = waitForJob('job-1', {
      fetchJob: () => {
        const elapsed = Date.now();
        return Promise.resolve(ok(job({
          status: elapsed >= 18 * 60 * 1000 ? 'completed' : 'running',
          updatedAt: `progress-${String(Math.floor(elapsed / (9 * 60 * 1000)))}`,
        })));
      },
      onProgress: () => undefined,
      onCompleted: completed,
      onError: failed,
      pollIntervalMs: 60 * 1000,
    });

    await vi.advanceTimersByTimeAsync(19 * 60 * 1000);
    await waiting;
    vi.useRealTimers();

    expect(completed).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  });

  it('allows process steps longer than ten minutes without progress updates', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const completed = vi.fn();
    const failed = vi.fn();
    const waiting = waitForJob('job-1', {
      fetchJob: () => Promise.resolve(ok(job({
        status: Date.now() >= 12 * 60 * 1000 ? 'completed' : 'running',
      }))),
      onProgress: () => undefined,
      onCompleted: completed,
      onError: failed,
      pollIntervalMs: 60 * 1000,
    });

    await vi.advanceTimersByTimeAsync(13 * 60 * 1000);
    await waiting;
    vi.useRealTimers();

    expect(completed).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  });

  it('retains the inactivity watchdog for download jobs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const failed = vi.fn();
    const waiting = waitForJob('job-1', {
      fetchJob: () => Promise.resolve(ok(job({ kind: 'whisper_download' }))),
      onProgress: () => undefined,
      onCompleted: () => undefined,
      onError: failed,
      pollIntervalMs: 60 * 1000,
      inactivityMs: 2 * 60 * 1000,
    });

    await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
    await waiting;
    vi.useRealTimers();

    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ code: 'internal' }));
  });
});
