import { ok, type AppError, type Result } from '@core/domain/index.js';

import type { FileSystemPort } from '../ports.js';

export const deleteLibraryTrashArtifacts = async (
  fs: FileSystemPort,
  paths: readonly string[],
): Promise<Result<number, AppError>> => {
  let deleted = 0;
  for (const path of [...new Set(paths)]) {
    const removed = path.endsWith('/') ? await fs.deletePath(path.slice(0, -1)) : await fs.deleteFile(path);
    if (!removed.ok) return removed;
    deleted += 1;
  }
  return ok(deleted);
};
