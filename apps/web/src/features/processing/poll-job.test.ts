import { describe, expect, it, vi } from 'vitest';

import type { JobOutput } from '@core/client/index.js';

import { pollJobUntilTerminal } from './poll-job.js';

const job = (status: JobOutput['status']): JobOutput => ({
  jobId: 'j',
  kind: 'process',
  status,
  progress: null,
  error: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const resolvedDelay = () => Promise.resolve();

describe('pollJobUntilTerminal', () => {
  it('returns immediately when the first snapshot is already terminal', async () => {
    const fetchJob = vi.fn().mockResolvedValue(job('completed'));
    const delay = vi.fn().mockImplementation(resolvedDelay);

    const final = await pollJobUntilTerminal('j', { fetchJob, delay, intervalMs: 1 });

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

    const final = await pollJobUntilTerminal('j', {
      fetchJob,
      delay,
      intervalMs: 5,
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

    const final = await pollJobUntilTerminal('j', { fetchJob, delay, shouldStop: () => true });

    expect(final.status).toBe('running');
    expect(fetchJob).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });
});
