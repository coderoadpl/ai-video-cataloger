import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { API_ROUTES, looseEnvelopeSchema } from '@core/contract/index.js';
import { appError, ok } from '@core/domain/index.js';
import type { AppError, Result } from '@core/domain/index.js';

import { createApp } from './create-app.js';
import { createInMemoryDeps } from './test-support/in-memory-deps.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('backup application lifecycle', () => {
  it('cleans crash-left staging before the launch evaluation', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'avc-backup-launch-'));
    const staging = path.join(home, '.ai-video-cataloger', 'backup-staging', 'crashed-job');
    await mkdir(staging, { recursive: true });
    await writeFile(path.join(staging, 'partial.avcbak'), 'partial');
    const app = createApp({ homeDirectory: home, workingDirectory: home, processName: 'gui' });

    for (let attempt = 0; attempt < 100 && existsSync(staging); attempt += 1) await new Promise<void>((resolve) => setTimeout(resolve, 2));

    expect(existsSync(staging)).toBe(false);
    await app.dispose();
  });

  it('runs the composed evaluator only on launch and hourly ticks', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const app = createApp({ dbDriver: 'memory', processName: 'gui' }, (config) => ({
      ...createInMemoryDeps(config),
      cleanupBackupStaging: () => {
        calls.push('cleanup');
        return Promise.resolve(ok(undefined));
      },
      evaluateScheduledBackup: () => {
        calls.push('evaluate');
        return Promise.resolve(ok(undefined));
      },
    }));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(['cleanup', 'evaluate']);

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(calls).toEqual(['cleanup', 'evaluate', 'evaluate']);
    await app.dispose();
  });

  it('runs backup cleanup during CLI startup before commands can use stores', async () => {
    const calls: string[] = [];
    let resolveCleanup: (result: Result<void, AppError>) => void = () => undefined;
    const cleanupResult = new Promise<Result<void, AppError>>((resolve) => {
      resolveCleanup = resolve;
    });
    const app = createApp({ dbDriver: 'memory', processName: 'cli' }, (config) => ({
      ...createInMemoryDeps(config),
      cleanupBackupStaging: () => {
        calls.push('cleanup');
        return cleanupResult;
      },
    }));

    let settled = false;
    const responsePromise = Promise.resolve(app.honoApp.request(API_ROUTES.health.path)).then((response) => {
      settled = true;
      return response;
    });
    await Promise.resolve();

    expect(calls).toEqual(['cleanup']);
    expect(settled).toBe(false);
    resolveCleanup(ok(undefined));
    expect((await responsePromise).status).toBe(200);
    await app.dispose();
  });

  it('returns startup recovery failure from app requests', async () => {
    const app = createApp({ dbDriver: 'memory', processName: 'cli' }, (config) => ({
      ...createInMemoryDeps(config),
      cleanupBackupStaging: () => Promise.resolve({ ok: false, error: appError('restore_incomplete', 'Restore recovery failed') }),
    }));

    const response = await app.honoApp.request(API_ROUTES.health.path);
    const body = looseEnvelopeSchema.safeParse(await response.json());

    expect(response.status).toBe(500);
    expect(body.success && !body.data.ok ? body.data.error : null).toMatchObject({ code: 'restore_incomplete' });
    await app.dispose();
  });

  it('does not evaluate scheduled backups when startup restore recovery fails', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const app = createApp({ dbDriver: 'memory', processName: 'gui' }, (config) => ({
      ...createInMemoryDeps(config),
      cleanupBackupStaging: () => {
        calls.push('cleanup');
        return Promise.resolve({ ok: false, error: appError('restore_incomplete', 'Restore recovery failed') });
      },
      evaluateScheduledBackup: () => {
        calls.push('evaluate');
        return Promise.resolve(ok(undefined));
      },
    }));

    await vi.advanceTimersByTimeAsync(0);

    expect(calls).toEqual(['cleanup']);
    await app.dispose();
  });

  it('does not evaluate backup scheduling when an analysis job completes', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const app = createApp({ dbDriver: 'memory', processName: 'gui' }, (config) => ({
      ...createInMemoryDeps(config),
      cleanupBackupStaging: () => {
        calls.push('cleanup');
        return Promise.resolve(ok(undefined));
      },
      evaluateScheduledBackup: () => {
        calls.push('evaluate');
        return Promise.resolve(ok(undefined));
      },
    }));
    await vi.advanceTimersByTimeAsync(0);
    const enqueued = await app.jobs.enqueue({
      kind: 'process',
      payload: {},
      run: () => Promise.resolve(ok({ processed: true })),
    });
    expect(enqueued).toMatchObject({ ok: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(calls).toEqual(['cleanup', 'evaluate']);
    await app.dispose();
  });
});
