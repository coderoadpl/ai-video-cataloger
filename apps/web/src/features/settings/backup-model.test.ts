import { describe, expect, it } from 'vitest';

import { ApiError } from '@core/client/index.js';

import { BACKUP_ERROR_CODES, type BackupErrorCode } from '@core/domain/index.js';

import {
  backupErrorMessage,
  formatArchiveSize,
  isRestorable,
  retentionInput,
  type RemoteBackupView,
} from './backup-model.js';

const messages: Record<BackupErrorCode, string> = {
  backup_disabled: 'message for backup_disabled',
  backup_auth_required: 'message for backup_auth_required',
  backup_destination_error: 'message for backup_destination_error',
  backup_quota_exceeded: 'message for backup_quota_exceeded',
  backup_encryption_failed: 'message for backup_encryption_failed',
  backup_integrity_failed: 'message for backup_integrity_failed',
  restore_incomplete: 'message for restore_incomplete',
  restore_refused: 'message for restore_refused',
  recovery_key_required: 'message for recovery_key_required',
  recovery_key_mismatch: 'message for recovery_key_mismatch',
  recovery_key_conflict: 'message for recovery_key_conflict',
};

const remote = (globalCatalog: number, photos: number): RemoteBackupView => ({
  remoteId: 'remote-1',
  name: 'avc-critical-20260902T120000Z.avcbak',
  tier: 'critical',
  createdAt: '2026-09-02T12:00:00.000Z',
  sizeBytes: 1024,
  appVersion: '0.7.0',
  schemaVersions: { globalCatalog, photos },
  keyFingerprint: null,
});

describe('backup error messages', () => {
  it('maps every backup error code to its own message', () => {
    for (const code of BACKUP_ERROR_CODES) {
      const error = new ApiError({ code, message: 'raw message' });
      expect(backupErrorMessage(error, messages)).toBe(`message for ${code}`);
    }
  });

  it('leaves unrelated failures to the generic formatter', () => {
    expect(backupErrorMessage(new ApiError({ code: 'internal', message: 'boom' }), messages)).toBeNull();
    expect(backupErrorMessage(new Error('boom'), messages)).toBeNull();
  });
});

describe('restorable backups', () => {
  it('accepts an archive at or below the supported schema versions', () => {
    expect(isRestorable(remote(7, 3), { globalCatalog: 7, photos: 3 })).toBe(true);
    expect(isRestorable(remote(6, 2), { globalCatalog: 7, photos: 3 })).toBe(true);
  });

  it('refuses an archive written by a newer app', () => {
    expect(isRestorable(remote(8, 3), { globalCatalog: 7, photos: 3 })).toBe(false);
    expect(isRestorable(remote(7, 4), { globalCatalog: 7, photos: 3 })).toBe(false);
  });
});

describe('archive size', () => {
  it.each([
    [512, '512 B'],
    [2048, '2.0 KB'],
    [5 * 1024 * 1024, '5.0 MB'],
    [3 * 1024 * 1024 * 1024, '3.0 GB'],
  ])('formats %i bytes as %s', (bytes, expected) => {
    expect(formatArchiveSize(bytes)).toBe(expected);
  });
});

describe('retention input', () => {
  it.each([
    ['14', 14],
    ['0', 1],
    ['900', 90],
    ['', 7],
    ['abc', 7],
  ])('clamps %s to %i', (raw, expected) => {
    expect(retentionInput(raw, 1, 90, 7)).toBe(expected);
  });
});
