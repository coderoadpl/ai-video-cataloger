import { appError, ok, type AppError, type Result } from '@core/domain/index.js';

import type { FileSystemPort } from '../ports.js';

export interface CheckDeps {
  fs: FileSystemPort;
}

export interface CheckOutput {
  hasNestedDatabases: boolean;
  nestedPaths: string[];
  basePath: string;
  scannedDirectories: number;
}

export const checkNestedDatabases = async (
  deps: CheckDeps,
  input: { folder: string },
): Promise<Result<CheckOutput, AppError>> => {
  const basePath = deps.fs.resolve(input.folder);
  const exists = await deps.fs.exists(basePath);
  if (!exists.ok) return exists;
  if (!exists.value) return { ok: false, error: appError('folder_not_found', `Folder not found: ${basePath}`) };

  const directory = await deps.fs.isDirectory(basePath);
  if (!directory.ok) return directory;
  if (!directory.value) return { ok: false, error: appError('not_a_directory', `Not a directory: ${basePath}`) };

  const accumulator: CheckOutput = {
    hasNestedDatabases: false,
    nestedPaths: [],
    basePath,
    scannedDirectories: 0,
  };
  const scanned = await scanDirectory(deps.fs, basePath, true, accumulator);
  if (!scanned.ok) return scanned;
  accumulator.hasNestedDatabases = accumulator.nestedPaths.length > 0;
  return ok(accumulator);
};

const scanDirectory = async (
  fs: FileSystemPort,
  currentPath: string,
  isRoot: boolean,
  accumulator: CheckOutput,
): Promise<Result<undefined, AppError>> => {
  const entries = await fs.listDirectory(currentPath);
  if (!entries.ok) return ok(undefined);

  for (const entry of entries.value) {
    if (entry.kind !== 'directory') continue;
    if (entry.name === '.ai-video-cataloger') {
      if (!isRoot) accumulator.nestedPaths.push(entry.path);
      continue;
    }
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules' || entry.name === '__pycache__') continue;

    accumulator.scannedDirectories += 1;
    const child = await scanDirectory(fs, entry.path, false, accumulator);
    if (!child.ok) return child;
  }

  return ok(undefined);
};
