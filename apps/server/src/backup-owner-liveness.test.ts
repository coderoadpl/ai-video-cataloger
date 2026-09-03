import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBackupOwnerLiveness, readProcessStartedAt } from './backup-owner-liveness.js';

const LOCAL_HOST = 'qa-mac.local';
const C_LOCALE_START_TIME = /^\w{3} \w{3} [ \d]\d \d\d:\d\d:\d\d \d{4}$/;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('backup owner liveness', () => {
  it('treats a reused pid whose process started later as dead', () => {
    const isAlive = createBackupOwnerLiveness({
      processStartedAt: (pid) => (pid === process.pid ? 'Tue Sep  1 10:00:00 2026' : 'Tue Sep  1 12:00:00 2026'),
    });

    expect(isAlive({ pid: 4242, hostname: LOCAL_HOST, startedAt: 'Tue Sep  1 09:00:00 2026' })).toBe(false);
  });

  it('treats the owner as alive when its pid still carries the recorded start time', () => {
    const isAlive = createBackupOwnerLiveness({
      processStartedAt: () => 'Tue Sep  1 09:00:00 2026',
    });

    expect(isAlive({ pid: 4242, hostname: LOCAL_HOST, startedAt: 'Tue Sep  1 09:00:00 2026' })).toBe(true);
  });

  it('keeps a running owner alive after the hostname changed', () => {
    const isAlive = createBackupOwnerLiveness({
      processStartedAt: () => 'Tue Sep  1 09:00:00 2026',
      isProcessAlive: () => true,
    });

    expect(isAlive({ pid: 4242, hostname: 'other-mac.local', startedAt: 'Tue Sep  1 09:00:00 2026' })).toBe(true);
  });

  it('treats a pid that no longer exists as dead', () => {
    const isAlive = createBackupOwnerLiveness({
      processStartedAt: (pid) => (pid === process.pid ? 'Tue Sep  1 10:00:00 2026' : null),
    });

    expect(isAlive({ pid: 4242, hostname: LOCAL_HOST, startedAt: 'Tue Sep  1 09:00:00 2026' })).toBe(false);
  });

  it('falls back to pid liveness for an owner written without a start time', () => {
    const alivePids = new Set([4242]);
    const isAlive = createBackupOwnerLiveness({
      processStartedAt: () => 'Tue Sep  1 10:00:00 2026',
      isProcessAlive: (pid) => alivePids.has(pid),
    });

    expect(isAlive({ pid: 4242, hostname: LOCAL_HOST })).toBe(true);
    expect(isAlive({ pid: 4243, hostname: LOCAL_HOST })).toBe(false);
  });

  it('falls back to pid liveness when start times cannot be read at all', () => {
    const isAlive = createBackupOwnerLiveness({
      processStartedAt: () => null,
      isProcessAlive: () => true,
    });

    expect(isAlive({ pid: 4242, hostname: LOCAL_HOST, startedAt: 'Tue Sep  1 09:00:00 2026' })).toBe(true);
  });

  it('reads a stable start time for the running process and none for a pid that cannot exist', () => {
    expect(readProcessStartedAt(process.pid)).toBe(readProcessStartedAt(process.pid));
    expect(readProcessStartedAt(999_999_999)).toBeNull();
  });

  it('reads the start time in the C locale whatever the caller locale and timezone are', () => {
    vi.stubEnv('LANG', 'pl_PL.UTF-8');
    vi.stubEnv('LC_TIME', 'pl_PL.UTF-8');
    vi.stubEnv('TZ', 'Europe/Warsaw');
    const polish = readProcessStartedAt(process.pid);

    vi.stubEnv('LANG', '');
    vi.stubEnv('LC_TIME', '');
    vi.stubEnv('TZ', 'America/Los_Angeles');
    const neutral = readProcessStartedAt(process.pid);

    expect(polish).toMatch(C_LOCALE_START_TIME);
    expect(neutral).toBe(polish);
  });
});
