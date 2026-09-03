import { execFile } from 'node:child_process';

import { appError, ok, type AppError, type Result } from '@core/domain/index.js';
import type { TrashPort } from '@core/server/index.js';

export type FinderTrashRunner = (file: string, args: readonly string[]) => Promise<{ code: number; stderr: string }>;

export class FinderTrashPort implements TrashPort {
  constructor(private readonly runner: FinderTrashRunner = defaultRunner) {}

  async moveToTrash(absolutePath: string): Promise<Result<void, AppError>> {
    if (process.platform !== 'darwin') {
      return { ok: false, error: appError('unavailable', 'The macOS Trash is not available on this host') };
    }
    const result = await this.runner('osascript', finderTrashArguments(absolutePath));
    if (result.code !== 0) {
      return { ok: false, error: appError('delete_error', result.stderr.length > 0 ? result.stderr : 'Finder refused to move the file to Trash') };
    }
    return ok(undefined);
  }
}

export const finderTrashArguments = (absolutePath: string): readonly string[] => [
  '-e',
  'on run argv',
  '-e',
  'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)',
  '-e',
  'end run',
  '--',
  absolutePath,
];

const defaultRunner: FinderTrashRunner = (file, args) =>
  new Promise((resolve) => {
    execFile(file, [...args], (error, _stdout, stderr) => {
      const code = typeof error?.code === 'number' ? error.code : error === null ? 0 : 1;
      resolve({ code, stderr });
    });
  });
