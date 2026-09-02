import { describe, expect, it } from 'vitest';

import {
  APP_GLOBAL_CONFIG_KEYS,
  backupManifestSchema,
  backupPhaseSchema,
  backupProviderSchema,
  backupTierSchema,
  configSchema,
  remoteBackupSchema,
} from './index.js';

const BACKUP_CONFIG_KEYS = [
  'backup_enabled',
  'backup_provider',
  'backup_include_optional',
  'backup_keep_last',
  'backup_keep_weekly',
  'backup_folder_id',
  'backup_shared_drive_id',
  'backup_service_account_fingerprint',
  'backup_account_email',
] as const;

describe('backup domain', () => {
  it('defines closed provider, tier, and phase vocabularies', () => {
    expect(backupProviderSchema.options).toEqual(['google_oauth', 'service_account']);
    expect(backupTierSchema.options).toEqual(['critical', 'optional']);
    expect(backupPhaseSchema.options).toEqual([
      'idle',
      'fingerprinting',
      'snapshotting',
      'archiving',
      'encrypting',
      'uploading',
      'pruning',
      'verifying',
      'downloading',
      'decrypting',
      'restoring',
    ]);
  });

  it('round-trips every backup config key through persisted strings', () => {
    const persisted = {
      backup_enabled: 'true',
      backup_provider: 'service_account',
      backup_include_optional: 'true',
      backup_keep_last: '14',
      backup_keep_weekly: '12',
      backup_folder_id: 'folder-id',
      backup_shared_drive_id: 'drive-id',
      backup_service_account_fingerprint: 'sha256:0123456789ab',
      backup_account_email: 'backup@example.com',
    };
    const parsed = configSchema.parse(persisted);
    const reparsed = configSchema.parse(Object.fromEntries(
      BACKUP_CONFIG_KEYS.map((key) => [key, String(parsed[key])]),
    ));

    expect(reparsed).toMatchObject(parsed);
    expect(APP_GLOBAL_CONFIG_KEYS).toEqual(expect.arrayContaining([...BACKUP_CONFIG_KEYS]));
  });

  it('rejects an unknown manifest tier', () => {
    expect(backupManifestSchema.safeParse({
      formatVersion: 1,
      tier: 'secret',
      createdAt: '2026-09-02T12:00:00.000Z',
      appVersion: '1.0.0',
      schemaVersions: { globalCatalog: 15, photos: 5 },
      contentFingerprint: 'a'.repeat(64),
      totalBytes: 0,
      files: [],
      folders: [],
    }).success).toBe(false);
  });

  it('parses manifest and remote-backup metadata', () => {
    const common = {
      tier: 'critical',
      createdAt: '2026-09-02T12:00:00.000Z',
      appVersion: '1.0.0',
      schemaVersions: { globalCatalog: 15, photos: 5 },
    } as const;
    expect(backupManifestSchema.parse({
      formatVersion: 1,
      ...common,
      contentFingerprint: 'b'.repeat(64),
      totalBytes: 3,
      files: [{ path: 'catalog.db', sizeBytes: 3, sha256: 'c'.repeat(64) }],
      folders: [{ folderId: 'folder-1', path: '/media/library' }],
    }).formatVersion).toBe(1);
    expect(remoteBackupSchema.parse({
      remoteId: 'remote-1',
      name: 'avc-critical-20260902T120000Z.avcbak',
      ...common,
      sizeBytes: 42,
    }).remoteId).toBe('remote-1');
  });
});
