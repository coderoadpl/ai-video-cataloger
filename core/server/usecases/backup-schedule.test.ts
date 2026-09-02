import { describe, expect, it, vi } from 'vitest';

import { appError, ok, type AppError, type Result } from '@core/domain/index.js';

import { decideBackup, evaluateScheduledBackup, startBackupSchedule } from './backup-schedule.js';

const now = new Date('2026-09-02T12:00:00.000Z');

describe('backup schedule', () => {
  it.each([
    [{ enabled: false, fingerprint: 'new', lastSuccessFingerprint: null, lastSuccessAt: null, blockedByJob: false }, 'not-enabled'],
    [{ enabled: true, fingerprint: 'same', lastSuccessFingerprint: 'same', lastSuccessAt: '2026-01-01T00:00:00.000Z', blockedByJob: true }, 'no-change'],
    [{ enabled: true, fingerprint: 'new', lastSuccessFingerprint: 'old', lastSuccessAt: '2026-09-02T00:00:00.000Z', blockedByJob: false }, 'too-soon'],
    [{ enabled: true, fingerprint: 'new', lastSuccessFingerprint: 'old', lastSuccessAt: '2026-09-01T12:00:00.000Z', blockedByJob: false }, 'due'],
    [{ enabled: true, fingerprint: 'new', lastSuccessFingerprint: 'old', lastSuccessAt: '2026-08-30T11:59:59.000Z', blockedByJob: false }, 'catch-up'],
    [{ enabled: true, fingerprint: 'new', lastSuccessFingerprint: 'old', lastSuccessAt: null, blockedByJob: false }, 'due'],
    [{ enabled: true, fingerprint: 'new', lastSuccessFingerprint: 'old', lastSuccessAt: '2026-08-01T00:00:00.000Z', blockedByJob: true }, 'blocked-by-job'],
  ] as const)('decides %s as %s', (state, reason) => {
    expect(decideBackup(state, now)).toEqual({
      action: reason === 'due' || reason === 'catch-up' ? 'run' : 'skip',
      reason,
    });
  });

  it('evaluates on launch and hourly timer ticks only', async () => {
    vi.useFakeTimers();
    const evaluate = vi.fn(() => Promise.resolve());
    const schedule = startBackupSchedule(evaluate);
    await vi.advanceTimersByTimeAsync(0);
    expect(evaluate).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(evaluate).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(evaluate).toHaveBeenCalledTimes(2);
    schedule.stop();
    vi.useRealTimers();
  });

  it('does no work while disabled and enqueues one due backup', async () => {
    const fingerprint = vi.fn(() => Promise.resolve(ok('new')));
    const enqueue = vi.fn(() => Promise.resolve(ok({ jobId: 'backup-1' })));
    const readState = vi.fn(() => Promise.resolve(ok({
      lastSuccessAt: '2026-09-01T12:00:00.000Z',
      lastFingerprint: 'old',
      lastErrorCode: null,
      lastArchiveName: null,
      lastRestoreAt: null,
    })));
    const common = {
      fingerprint,
      enqueue,
      readState,
      listJobs: () => Promise.resolve(ok([])),
      now: () => now,
    };

    expect(await evaluateScheduledBackup({ ...common, enabled: () => Promise.resolve(ok(false)) })).toEqual(ok({
      action: 'skip',
      reason: 'not-enabled',
    }));
    expect(fingerprint).not.toHaveBeenCalled();
    expect(readState).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();

    expect(await evaluateScheduledBackup({ ...common, enabled: () => Promise.resolve(ok(true)) })).toEqual(ok({
      action: 'run',
      reason: 'due',
    }));
    expect(fingerprint).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('defers a scheduled backup while a conflicting job is active', async () => {
    const fingerprint = vi.fn(() => Promise.resolve(ok('new')));
    const enqueue = vi.fn(() => Promise.resolve({
      ok: false,
      error: appError('conflict', 'blocked'),
    } satisfies Result<{ jobId: string }, AppError>));
    const result = await evaluateScheduledBackup({
      enabled: () => Promise.resolve(ok(true)),
      fingerprint,
      enqueue,
      readState: () => Promise.resolve(ok(null)),
      listJobs: () => Promise.resolve(ok([{
        jobId: 'process-1',
        kind: 'process',
        status: 'running',
        progress: null,
        progressEvents: [],
        error: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      }])),
      now: () => now,
    });

    expect(result).toEqual(ok({ action: 'skip', reason: 'blocked-by-job' }));
    expect(fingerprint).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
