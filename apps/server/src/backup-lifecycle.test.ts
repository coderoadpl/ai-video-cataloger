import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ok } from '@core/domain/index.js';

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
});
