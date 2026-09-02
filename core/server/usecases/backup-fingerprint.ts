import { sha256Hex } from '@core/domain/sha256.js';
import { appError, compareUtf8Bytes, ok, type AppError, type Result } from '@core/domain/index.js';

import type { FileSystemPort } from '../ports.js';
import type { BackupScopeEntry } from './backup-scope.js';

const DATABASE_PATHS = new Set(['catalog.db', 'photos.db']);

export const computeBackupFingerprint = async (
  fs: FileSystemPort,
  entries: readonly BackupScopeEntry[],
): Promise<Result<string, AppError>> => {
  const components: string[] = [];
  const sorted = [...entries].sort((left, right) => compareUtf8Bytes(left.archivePath, right.archivePath));
  for (const entry of sorted) {
    if (DATABASE_PATHS.has(entry.archivePath)) {
      const digest = await fs.fullContentHash(entry.sourcePath);
      if (!digest.ok) return digest;
      if (digest.value === null) {
        return { ok: false, error: appError('backup_integrity_failed', `Could not hash ${entry.archivePath}`) };
      }
      components.push(digest.value);
      continue;
    }
    const stats = await fs.stat(entry.sourcePath);
    if (!stats.ok) return stats;
    components.push(`${entry.archivePath}|${String(stats.value.size)}|${String(stats.value.mtimeMs)}`);
  }
  return ok(sha256Hex(components.join('\n')));
};
