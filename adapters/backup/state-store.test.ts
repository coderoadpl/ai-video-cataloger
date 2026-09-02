import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { BackupStateFile } from './state-store.js';

describe('backup state persistence', () => {
  it('persists state outside config.json with owner-only mode', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'avc-backup-state-'));
    const store = new BackupStateFile({ homeDirectory: home });
    const state = {
      lastSuccessAt: '2026-09-02T12:00:00.000Z',
      lastFingerprint: 'a'.repeat(64),
      lastErrorCode: null,
      lastArchiveName: 'avc-critical-20260902T120000Z.avcbak',
      lastRestoreAt: null,
    } as const;

    expect(await store.write(state)).toEqual({ ok: true, value: undefined });
    expect(await store.read()).toEqual({ ok: true, value: state });
    expect(statSync(path.join(home, '.ai-video-cataloger', 'backup-state.json')).mode & 0o777).toBe(0o600);
  });

  it('treats a corrupt state file as never backed up', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'avc-backup-state-corrupt-'));
    const store = new BackupStateFile({ homeDirectory: home });
    const filePath = path.join(home, '.ai-video-cataloger', 'backup-state.json');
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, '{ broken', { mode: 0o600 });

    expect(await store.read()).toEqual({ ok: true, value: null });
    expect(readFileSync(filePath, 'utf8')).toBe('{ broken');
  });
});
