import { z } from 'zod';

import {
  appError,
  configValueSchema,
  ok,
  type AppError,
  type BackupProvider,
  type Result,
} from '@core/domain/index.js';

import type { ConfigStore } from '../ports.js';

export interface BackupSettings {
  enabled: boolean;
  provider: BackupProvider;
  includeOptional: boolean;
  keepLast: number;
  keepWeekly: number;
  folderId: string;
  sharedDriveId: string;
  serviceAccountFingerprint: string;
  accountEmail: string;
}

const backupSettingsSchema = z.object({
  enabled: configValueSchema.shape.backup_enabled,
  provider: configValueSchema.shape.backup_provider,
  includeOptional: configValueSchema.shape.backup_include_optional,
  keepLast: configValueSchema.shape.backup_keep_last,
  keepWeekly: configValueSchema.shape.backup_keep_weekly,
  folderId: configValueSchema.shape.backup_folder_id,
  sharedDriveId: configValueSchema.shape.backup_shared_drive_id,
  serviceAccountFingerprint: configValueSchema.shape.backup_service_account_fingerprint,
  accountEmail: configValueSchema.shape.backup_account_email,
});

export const readBackupSettings = async (config: ConfigStore): Promise<Result<BackupSettings, AppError>> => {
  const stored = await config.getAll({ kind: 'home' });
  if (!stored.ok) return stored;
  const parsed = backupSettingsSchema.safeParse({
    enabled: stored.value.backup_enabled,
    provider: stored.value.backup_provider,
    includeOptional: stored.value.backup_include_optional,
    keepLast: stored.value.backup_keep_last,
    keepWeekly: stored.value.backup_keep_weekly,
    folderId: stored.value.backup_folder_id,
    sharedDriveId: stored.value.backup_shared_drive_id,
    serviceAccountFingerprint: stored.value.backup_service_account_fingerprint,
    accountEmail: stored.value.backup_account_email,
  });
  return parsed.success
    ? ok(parsed.data)
    : { ok: false, error: appError('invalid_config_value', 'Invalid backup configuration') };
};
