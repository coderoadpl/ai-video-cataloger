import { describe, expect, it, vi } from 'vitest';

import { appError, ok, type AppError, type Result } from '@core/domain/index.js';

import type { FolderWatchHandle, FolderWatcherPort, JobKind, JobRecord, JobStatus, JobsPort } from '../ports.js';
import { watchCatalogFolder, type WatchScheduler } from './folder-watch.js';

const jobRecord = (kind: JobKind, status: JobStatus): JobRecord => ({
  jobId: `${kind}-${status}`,
  kind,
  status,
  progress: null,
  progressEvents: [],
  error: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const jobsListing = (records: JobRecord[]): Pick<JobsPort, 'list'> => ({
  list: () => Promise.resolve(ok(records)),
});

const failingJobs: Pick<JobsPort, 'list'> = {
  list: () => Promise.resolve<Result<JobRecord[], AppError>>({ ok: false, error: appError('internal', 'boom') }),
};

interface FakeWatcher {
  port: FolderWatcherPort;
  change: () => void;
  fail: (error: AppError) => void;
  closed: () => number;
}

const fakeWatcher = (): FakeWatcher => {
  let notify: () => void = () => undefined;
  let notifyFailure: (error: AppError) => void = () => undefined;
  let closed = 0;
  return {
    port: {
      watch: (_root, onChange, onFailure): Promise<Result<FolderWatchHandle, AppError>> => {
        notify = onChange;
        if (onFailure !== undefined) notifyFailure = onFailure;
        return Promise.resolve(
          ok({
            close: () => {
              closed += 1;
            },
          }),
        );
      },
    },
    change: () => notify(),
    fail: (error) => notifyFailure(error),
    closed: () => closed,
  };
};

interface ManualClock {
  schedule: WatchScheduler;
  pending: () => number;
  tick: () => Promise<void>;
}

const manualClock = (): ManualClock => {
  let callbacks: Array<() => void> = [];
  return {
    schedule: (callback) => {
      callbacks.push(callback);
      return () => {
        callbacks = callbacks.filter((candidate) => candidate !== callback);
      };
    },
    pending: () => callbacks.length,
    tick: async () => {
      const due = callbacks;
      callbacks = [];
      for (const callback of due) callback();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('watchCatalogFolder', () => {
  it('refreshes on a folder change when no run is active', async () => {
    const watcher = fakeWatcher();
    const onRefresh = vi.fn();

    const session = await watchCatalogFolder(
      { watcher: watcher.port, jobs: jobsListing([jobRecord('process', 'completed')]) },
      '/drive',
      onRefresh,
    );

    expect(session.ok).toBe(true);
    watcher.change();
    await flush();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('stops the session and reports the error when the watcher dies', async () => {
    const watcher = fakeWatcher();
    const onRefresh = vi.fn();
    const onStopped = vi.fn();

    await watchCatalogFolder(
      { watcher: watcher.port, jobs: jobsListing([]) },
      '/drive',
      onRefresh,
      { onStopped },
    );

    watcher.fail(appError('read_error', 'Stopped watching folder: /drive'));
    watcher.change();
    await flush();

    expect(onStopped).toHaveBeenCalledTimes(1);
    expect(onStopped.mock.calls[0]?.[0]).toMatchObject({ code: 'read_error' });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('holds the refresh while a drive run is active and fires once it settles', async () => {
    const watcher = fakeWatcher();
    const clock = manualClock();
    const records = [jobRecord('process_drive', 'running')];
    const onRefresh = vi.fn();

    await watchCatalogFolder(
      { watcher: watcher.port, jobs: jobsListing(records) },
      '/drive',
      onRefresh,
      { schedule: clock.schedule },
    );

    watcher.change();
    await flush();
    expect(onRefresh).not.toHaveBeenCalled();
    expect(clock.pending()).toBe(1);

    await clock.tick();
    expect(onRefresh).not.toHaveBeenCalled();

    records[0] = jobRecord('process_drive', 'completed');
    await clock.tick();
    await flush();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('coalesces changes that arrive while the refresh is held', async () => {
    const watcher = fakeWatcher();
    const clock = manualClock();
    const records = [jobRecord('process', 'running')];
    const onRefresh = vi.fn();

    await watchCatalogFolder(
      { watcher: watcher.port, jobs: jobsListing(records) },
      '/drive',
      onRefresh,
      { schedule: clock.schedule },
    );

    watcher.change();
    await flush();
    watcher.change();
    watcher.change();
    await flush();
    expect(clock.pending()).toBe(1);

    records[0] = jobRecord('process', 'cancelled');
    await clock.tick();
    await flush();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('ignores background jobs that are not analysis runs', async () => {
    const watcher = fakeWatcher();
    const onRefresh = vi.fn();

    await watchCatalogFolder(
      { watcher: watcher.port, jobs: jobsListing([jobRecord('whisper_download', 'running')]) },
      '/drive',
      onRefresh,
    );

    watcher.change();
    await flush();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes when the job listing cannot be read', async () => {
    const watcher = fakeWatcher();
    const onRefresh = vi.fn();

    await watchCatalogFolder({ watcher: watcher.port, jobs: failingJobs }, '/drive', onRefresh);

    watcher.change();
    await flush();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('stopping closes the watcher and abandons a held refresh', async () => {
    const watcher = fakeWatcher();
    const clock = manualClock();
    const onRefresh = vi.fn();

    const session = await watchCatalogFolder(
      { watcher: watcher.port, jobs: jobsListing([jobRecord('process_drive', 'queued')]) },
      '/drive',
      onRefresh,
      { schedule: clock.schedule },
    );
    if (!session.ok) throw new Error('watch failed');

    watcher.change();
    await flush();
    session.value.stop();
    await flush();

    expect(onRefresh).not.toHaveBeenCalled();
    expect(watcher.closed()).toBe(1);

    watcher.change();
    await flush();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('propagates a watcher failure', async () => {
    const failing: FolderWatcherPort = {
      watch: () => Promise.resolve<Result<FolderWatchHandle, AppError>>({ ok: false, error: appError('read_error', 'nope') }),
    };

    const session = await watchCatalogFolder({ watcher: failing, jobs: jobsListing([]) }, '/drive', () => undefined);

    expect(session.ok).toBe(false);
    expect(session.ok ? null : session.error.code).toBe('read_error');
  });
});
