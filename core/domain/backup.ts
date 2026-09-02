import { z } from 'zod';

import { ERROR_CODES, type ErrorCode } from './errors.js';

export const BACKUP_FOLDER_NAME = 'AI Video Cataloger Backups';
export const BACKUP_ENCRYPTION_KEY_ACCOUNT = 'backup.encryption_key';
export const BACKUP_GOOGLE_REFRESH_TOKEN_ACCOUNT = 'backup.google.refresh_token';
export const BACKUP_SERVICE_ACCOUNT_KEY_ACCOUNT = 'backup.service_account.key';

export const BACKUP_ERROR_CODES = [
  'backup_disabled',
  'backup_auth_required',
  'backup_destination_error',
  'backup_quota_exceeded',
  'backup_encryption_failed',
  'backup_integrity_failed',
  'restore_refused',
  'recovery_key_required',
] as const satisfies readonly ErrorCode[];

export type BackupErrorCode = (typeof BACKUP_ERROR_CODES)[number];

export const isBackupErrorCode = (code: string): code is BackupErrorCode =>
  BACKUP_ERROR_CODES.some((known) => known === code);

export const BACKUP_PROVIDERS = ['google_oauth', 'service_account'] as const;
export const BACKUP_TIERS = ['critical', 'optional'] as const;
export const BACKUP_PHASES = [
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
] as const;
export const BACKUP_INDICATOR_STATES = ['idle', 'running', 'failed', 'disabled'] as const;

export const backupProviderSchema = z.enum(BACKUP_PROVIDERS);
export const backupTierSchema = z.enum(BACKUP_TIERS);
export const backupPhaseSchema = z.enum(BACKUP_PHASES);
export const backupIndicatorStateSchema = z.enum(BACKUP_INDICATOR_STATES);

export type BackupProvider = z.output<typeof backupProviderSchema>;
export type BackupTier = z.output<typeof backupTierSchema>;
export type BackupPhase = z.output<typeof backupPhaseSchema>;
export type BackupIndicatorState = z.output<typeof backupIndicatorStateSchema>;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const backupSchemaVersionsSchema = z.object({
  globalCatalog: z.number().int().nonnegative(),
  photos: z.number().int().nonnegative(),
}).strict();

export type BackupSchemaVersions = z.output<typeof backupSchemaVersionsSchema>;

export const backupManifestSchema = z.object({
  formatVersion: z.literal(1),
  tier: backupTierSchema,
  createdAt: z.iso.datetime(),
  appVersion: z.string().min(1),
  schemaVersions: backupSchemaVersionsSchema,
  contentFingerprint: sha256Schema,
  totalBytes: z.number().int().nonnegative(),
  files: z.array(z.object({
    path: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    sha256: sha256Schema,
  }).strict()),
  folders: z.array(z.object({
    folderId: z.string().min(1),
    path: z.string().min(1),
  }).strict()),
}).strict();

export const remoteBackupSchema = z.object({
  remoteId: z.string().min(1),
  name: z.string().min(1),
  tier: backupTierSchema,
  createdAt: z.iso.datetime(),
  sizeBytes: z.number().int().nonnegative(),
  appVersion: z.string().min(1),
  schemaVersions: backupSchemaVersionsSchema,
}).strict();

export type BackupManifest = z.output<typeof backupManifestSchema>;
export type RemoteBackup = z.output<typeof remoteBackupSchema>;

export const backupStateSchema = z.object({
  lastSuccessAt: z.iso.datetime().nullable(),
  lastFingerprint: sha256Schema.nullable(),
  lastErrorCode: z.enum(ERROR_CODES).nullable(),
  lastArchiveName: z.string().min(1).nullable(),
  lastRestoreAt: z.iso.datetime().nullable(),
}).strict();

export type BackupState = z.output<typeof backupStateSchema>;
