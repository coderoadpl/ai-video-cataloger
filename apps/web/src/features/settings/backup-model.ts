import { ApiError, type BackupListOutput, type BackupStatusOutput } from '@core/client/index.js';
import { isBackupErrorCode, type BackupErrorCode } from '@core/domain/index.js';

export type RemoteBackupView = BackupListOutput['backups'][number];
export type BackupSchemaVersions = BackupStatusOutput['supportedSchemaVersions'];

export const backupErrorMessage = (
  error: unknown,
  messages: Record<BackupErrorCode, string>,
): string | null => {
  if (!(error instanceof ApiError)) return null;
  const { code } = error.appError;
  return isBackupErrorCode(code) ? messages[code] : null;
};

export const isRestorable = (backup: RemoteBackupView, supported: BackupSchemaVersions): boolean =>
  backup.schemaVersions.globalCatalog <= supported.globalCatalog
  && backup.schemaVersions.photos <= supported.photos;

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export const formatArchiveSize = (bytes: number): string => {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? String(Math.round(value)) : value.toFixed(1)} ${BYTE_UNITS[unit] ?? 'B'}`;
};

export const retentionInput = (raw: string, min: number, max: number, fallback: number): number => {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};
