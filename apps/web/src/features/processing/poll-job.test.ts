import { describe, expect, it, vi } from 'vitest';

import type { JobOutput } from '@core/client/index.js';

import { isTerminalJobStatus } from '@core/client/index.js';

import { pollJobUntilTerminal, sleep } from '../../lib/poll-job.js';

const job = (status: JobOutput['status']): JobOutput => ({
  jobId: 'j',
  kind: 'process',
  status,
  progress: null,
  progressEvents: [],
  error: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const resolvedDelay = () => Promise.resolve();

describe('pollJobUntilTerminal', () => {
  it('returns immediately when the first snapshot is already terminal', async () => {
    const fetchJob = vi.fn().mockResolvedValue(job('completed'));
    const delay = vi.fn().mockImplementation(resolvedDelay);

    const final = await pollJobUntilTerminal<JobOutput>('j', {
      fetchJob,
      delay,
      intervalMs: 1,
      isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
    });

    expect(final.status).toBe('completed');
    expect(fetchJob).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it('polls across non-terminal snapshots and stops on the terminal one', async () => {
    const fetchJob = vi
      .fn()
      .mockResolvedValueOnce(job('queued'))
      .mockResolvedValueOnce(job('running'))
      .mockResolvedValue(job('completed'));
    const delay = vi.fn().mockImplementation(resolvedDelay);
    const seen: string[] = [];

    const final = await pollJobUntilTerminal<JobOutput>('j', {
      fetchJob,
      delay,
      intervalMs: 5,
      isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
      onSnapshot: (snapshot) => seen.push(snapshot.status),
    });

    expect(final.status).toBe('completed');
    expect(fetchJob).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenCalledTimes(2);
    expect(seen).toEqual(['queued', 'running', 'completed']);
  });

  it('stops early when shouldStop turns true between polls', async () => {
    const fetchJob = vi.fn().mockResolvedValue(job('running'));
    const delay = vi.fn().mockImplementation(resolvedDelay);

    const final = await pollJobUntilTerminal<JobOutput>('j', {
      fetchJob,
      delay,
      isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
      shouldStop: () => true,
    });

    expect(final.status).toBe('running');
    expect(fetchJob).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it('does not fetch again when teardown happens during the pending delay', async () => {
    let cancelled = false;
    const fetchJob = vi.fn().mockResolvedValue(job('running'));
    const delay = vi.fn().mockImplementation(async () => {
      cancelled = true;
    });

    await pollJobUntilTerminal<JobOutput>('j', {
      fetchJob,
      delay,
      isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
      shouldStop: () => cancelled,
    });

    expect(fetchJob).toHaveBeenCalledTimes(1);
  });

  it('does not start a fetch when its signal was cancelled before polling begins', async () => {
    const controller = new AbortController();
    const fetchJob = vi.fn().mockResolvedValue(job('running'));
    controller.abort();

    await expect(pollJobUntilTerminal<JobOutput>('j', {
      fetchJob,
      delay: resolvedDelay,
      isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });

    expect(fetchJob).not.toHaveBeenCalled();
  });

  it('cancels a pending delay without starting another fetch', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchJob = vi.fn().mockResolvedValue(job('running'));
    const polling = pollJobUntilTerminal<JobOutput>('j', {
      fetchJob,
      delay: sleep,
      isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(0);

    controller.abort();

    await expect(polling).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchJob).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('forwards cancellation to a pending fetch and produces no snapshots after abort', async () => {
    const controller = new AbortController();
    const seen: JobOutput[] = [];
    const fetchJob = vi.fn((_jobId: string, signal?: AbortSignal) => new Promise<JobOutput>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('Request aborted', 'AbortError')), { once: true });
    }));
    const polling = pollJobUntilTerminal<JobOutput>('j', {
      fetchJob,
      delay: resolvedDelay,
      isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
      onSnapshot: (snapshot) => seen.push(snapshot),
      signal: controller.signal,
    });

    controller.abort();

    await expect(polling).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchJob).toHaveBeenCalledWith('j', controller.signal);
    expect(seen).toEqual([]);
  });
});
