import { describe, expect, it } from 'vitest';

import { createBackupOwnerLiveness, readProcessStartedAt } from './backup-owner-liveness.js';

const LOCAL_HOST = 'qa-mac.local';

describe('backup owner liveness', () => {
  it('treats a reused pid whose process started later as dead', () => {
    const isAlive = createBackupOwnerLiveness({
      localHostname: () => LOCAL_HOST,
      processStartedAt: (pid) => (pid === process.pid ? 'Tue Sep  1 10:00:00 2026' : 'Tue Sep  1 12:00:00 2026'),
    });

    expect(isAlive({ pid: 4242, hostname: LOCAL_HOST, startedAt: 'Tue Sep  1 09:00:00 2026' })).toBe(false);
  });

  it('treats the owner as alive when its pid still carries the recorded start time', () => {
    const isAlive = createBackupOwnerLiveness({
      localHostname: () => LOCAL_HOST,
      processStartedAt: () => 'Tue Sep  1 09:00:00 2026',
    });

    expect(isAlive({ pid: 4242, hostname: LOCAL_HOST, startedAt: 'Tue Sep  1 09:00:00 2026' })).toBe(true);
  });

  it('treats an owner recorded under another hostname as dead', () => {
    const isAlive = createBackupOwnerLiveness({
      localHostname: () => LOCAL_HOST,
      processStartedAt: () => 'Tue Sep  1 09:00:00 2026',
      isProcessAlive: () => true,
    });

    expect(isAlive({ pid: 4242, hostname: 'other-mac.local', startedAt: 'Tue Sep  1 09:00:00 2026' })).toBe(false);
  });

  it('treats a pid that no longer exists as dead', () => {
    const isAlive = createBackupOwnerLiveness({
      localHostname: () => LOCAL_HOST,
      processStartedAt: (pid) => (pid === process.pid ? 'Tue Sep  1 10:00:00 2026' : null),
    });

    expect(isAlive({ pid: 4242, hostname: LOCAL_HOST, startedAt: 'Tue Sep  1 09:00:00 2026' })).toBe(false);
  });

  it('falls back to pid liveness for an owner written without a start time', () => {
    const alivePids = new Set([4242]);
    const isAlive = createBackupOwnerLiveness({
      localHostname: () => LOCAL_HOST,
      processStartedAt: () => 'Tue Sep  1 10:00:00 2026',
      isProcessAlive: (pid) => alivePids.has(pid),
    });

    expect(isAlive({ pid: 4242, hostname: LOCAL_HOST })).toBe(true);
    expect(isAlive({ pid: 4243, hostname: LOCAL_HOST })).toBe(false);
  });

  it('falls back to pid liveness when start times cannot be read at all', () => {
    const isAlive = createBackupOwnerLiveness({
      localHostname: () => LOCAL_HOST,
      processStartedAt: () => null,
      isProcessAlive: () => true,
    });

    expect(isAlive({ pid: 4242, hostname: LOCAL_HOST, startedAt: 'Tue Sep  1 09:00:00 2026' })).toBe(true);
  });

  it('reads a stable start time for the running process and none for a pid that cannot exist', () => {
    expect(readProcessStartedAt(process.pid)).toBe(readProcessStartedAt(process.pid));
    expect(readProcessStartedAt(999_999_999)).toBeNull();
  });
});
