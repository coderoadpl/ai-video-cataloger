import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  appError,
  backupStateSchema,
  ok,
  type AppError,
  type BackupState,
  type Result,
} from '@core/domain/index.js';

export interface BackupStateFileOptions {
  homeDirectory: string;
}

export class BackupStateFile {
  readonly filePath: string;

  constructor(options: BackupStateFileOptions) {
    this.filePath = path.join(options.homeDirectory, '.ai-video-cataloger', 'backup-state.json');
  }

  async read(): Promise<Result<BackupState | null, AppError>> {
    let text: string;
    try {
      text = await readFile(this.filePath, 'utf8');
    } catch (cause) {
      if (nodeErrorCode(cause) === 'ENOENT') return ok(null);
      return { ok: false, error: appError('read_error', 'Could not read backup state') };
    }
    try {
      const decoded: unknown = JSON.parse(text);
      const parsed = backupStateSchema.safeParse(decoded);
      return ok(parsed.success ? parsed.data : null);
    } catch {
      return ok(null);
    }
  }

  async write(state: BackupState): Promise<Result<void, AppError>> {
    const parsed = backupStateSchema.safeParse(state);
    if (!parsed.success) return { ok: false, error: appError('validation', 'Invalid backup state') };
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    try {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await writeFile(tempPath, `${JSON.stringify(parsed.data, null, 2)}\n`, { mode: 0o600 });
      await chmod(tempPath, 0o600);
      await rename(tempPath, this.filePath);
      await chmod(this.filePath, 0o600);
      return ok(undefined);
    } catch {
      return { ok: false, error: appError('internal', 'Could not persist backup state') };
    }
  }
}

const nodeErrorCode = (cause: unknown): string | null => {
  if (!(cause instanceof Error) || !('code' in cause)) return null;
  return typeof cause.code === 'string' ? cause.code : null;
};
