import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, copyFile, link, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import {
  appError,
  ok,
  type AppError,
  type Result,
} from '@core/domain/index.js';
import type {
  DirectoryEntry,
  FileStat,
  FileSystemPort,
} from '@core/server/index.js';
import { z } from 'zod';

const PARTIAL_HASH_CHUNK_SIZE = 1024 * 1024;
const READ_ONLY_ERRNO_CODES: ReadonlySet<string> = new Set(['EACCES', 'EROFS', 'EPERM']);

export interface NodeFileSystemPortOptions {
  workingDirectory?: string | undefined;
  tempDirectory?: string | undefined;
  homeDirectory?: string | undefined;
}

export class NodeFileSystemPort implements FileSystemPort {
  private readonly workingDirectory: string;
  private readonly tempRoot: string;
  private readonly homeRoot: string;

  constructor(options: NodeFileSystemPortOptions = {}) {
    this.workingDirectory = options.workingDirectory ?? process.cwd();
    this.tempRoot = options.tempDirectory ?? tmpdir();
    this.homeRoot = options.homeDirectory ?? homedir();
  }

  cwd(): string {
    return this.workingDirectory;
  }

  resolve(value: string): string {
    return path.resolve(this.workingDirectory, value);
  }

  dirname(value: string): string {
    return path.dirname(value);
  }

  basename(value: string): string {
    return path.basename(value);
  }

  basenameWithoutExtension(value: string): string {
    return path.basename(value, path.extname(value));
  }

  extname(value: string): string {
    return path.extname(value);
  }

  join(...segments: string[]): string {
    return path.join(...segments);
  }

  async isDirectory(value: string): Promise<Result<boolean, AppError>> {
    try {
      const stats = await stat(value);
      return ok(stats.isDirectory());
    } catch (cause) {
      if (isMissing(cause)) return ok(false);
      return failure('read_error', cause, `Failed to stat: ${value}`);
    }
  }

  async isFile(value: string): Promise<Result<boolean, AppError>> {
    try {
      const stats = await stat(value);
      return ok(stats.isFile());
    } catch (cause) {
      if (isMissing(cause)) return ok(false);
      return failure('read_error', cause, `Failed to stat: ${value}`);
    }
  }

  async exists(value: string): Promise<Result<boolean, AppError>> {
    try {
      await access(value);
      return ok(true);
    } catch (cause) {
      if (isMissing(cause)) return ok(false);
      return failure('read_error', cause, `Failed to access: ${value}`);
    }
  }

  async listDirectory(value: string): Promise<Result<DirectoryEntry[], AppError>> {
    try {
      const entries = await readdir(value, { withFileTypes: true });
      return ok(entries.map((entry) => ({
        name: entry.name,
        path: path.join(value, entry.name),
        kind: directoryEntryKind(entry),
      })));
    } catch (cause) {
      if (isMissing(cause)) return ok([]);
      return failure('read_error', cause, `Failed to list directory: ${value}`);
    }
  }

  async stat(value: string): Promise<Result<FileStat, AppError>> {
    try {
      const stats = await stat(value);
      return ok({ size: stats.size, mtimeMs: stats.mtimeMs });
    } catch (cause) {
      if (isMissing(cause)) return { ok: false, error: appError('file_not_found', `File not found: ${value}`) };
      return failure('read_error', cause, `Failed to stat: ${value}`);
    }
  }

  async readTextFile(value: string): Promise<Result<string | null, AppError>> {
    try {
      return ok(await readFile(value, 'utf8'));
    } catch (cause) {
      if (isMissing(cause)) return ok(null);
      return failure('read_error', cause, `Failed to read file: ${value}`);
    }
  }

  async writeTextFile(value: string, content: string): Promise<Result<void, AppError>> {
    try {
      await writeFile(value, content, 'utf8');
      return ok(undefined);
    } catch (cause) {
      return failure('internal', cause, `Failed to write file: ${value}`);
    }
  }

  async ensureDirectory(value: string): Promise<Result<void, AppError>> {
    try {
      await mkdir(value, { recursive: true });
      return ok(undefined);
    } catch (cause) {
      return failure('internal', await unmaskedCause(value, cause), `Failed to create directory: ${value}`);
    }
  }

  async linkFile(from: string, to: string): Promise<Result<void, AppError>> {
    try {
      await link(from, to);
      return ok(undefined);
    } catch (cause) {
      return failure('internal', cause, `Failed to link ${from} to ${to}`);
    }
  }

  async copyFile(from: string, to: string): Promise<Result<void, AppError>> {
    try {
      await copyFile(from, to);
      return ok(undefined);
    } catch (cause) {
      return failure('internal', cause, `Failed to copy ${from} to ${to}`);
    }
  }

  async renamePath(from: string, to: string): Promise<Result<void, AppError>> {
    try {
      await rename(from, to);
      return ok(undefined);
    } catch (cause) {
      return failure('internal', cause, `Failed to rename ${from} to ${to}`);
    }
  }

  async deleteFile(value: string): Promise<Result<void, AppError>> {
    try {
      await rm(value, { force: true });
      return ok(undefined);
    } catch (cause) {
      return failure('internal', cause, `Failed to delete file: ${value}`);
    }
  }

  async deletePath(value: string): Promise<Result<void, AppError>> {
    try {
      await rm(value, { force: true, recursive: true });
      return ok(undefined);
    } catch (cause) {
      return failure('internal', cause, `Failed to delete path: ${value}`);
    }
  }

  async partialContentHash(value: string): Promise<Result<string | null, AppError>> {
    try {
      const stats = await stat(value);
      const hash = createHash('sha256');
      hash.update(Buffer.from(stats.size.toString()));
      const handle = await open(value, 'r');
      try {
        const firstChunk = Buffer.alloc(Math.min(PARTIAL_HASH_CHUNK_SIZE, stats.size));
        await handle.read(firstChunk, 0, firstChunk.length, 0);
        hash.update(firstChunk);
        if (stats.size > PARTIAL_HASH_CHUNK_SIZE) {
          const lastChunkSize = Math.min(PARTIAL_HASH_CHUNK_SIZE, stats.size - PARTIAL_HASH_CHUNK_SIZE);
          const lastChunk = Buffer.alloc(lastChunkSize);
          await handle.read(lastChunk, 0, lastChunkSize, stats.size - lastChunkSize);
          hash.update(lastChunk);
        }
      } finally {
        await handle.close();
      }
      return ok(hash.digest('hex').substring(0, 16));
    } catch {
      return ok(null);
    }
  }

  tempDirectory(): string {
    return this.tempRoot;
  }

  homeDirectory(): string {
    return this.homeRoot;
  }
}

const isMissing = (cause: unknown): boolean =>
  cause instanceof Error && 'code' in cause && cause.code === 'ENOENT';

const directoryEntryKind = (entry: { isDirectory(): boolean; isSymbolicLink(): boolean }): DirectoryEntry['kind'] => {
  if (entry.isSymbolicLink()) return 'symlink';
  if (entry.isDirectory()) return 'directory';
  return 'file';
};

const errnoCodeSchema = z.object({ code: z.string() });

const nearestExistingAncestor = async (target: string): Promise<string> => {
  let current = target;
  while (current !== path.dirname(current)) {
    try {
      await access(current);
      return current;
    } catch {
      current = path.dirname(current);
    }
  }
  return current;
};

// node 22 recursive mkdir reports EROFS as ENOENT on read-only exFAT/fskit mounts
const unmaskedCause = async (target: string, cause: unknown): Promise<unknown> => {
  const parsed = errnoCodeSchema.safeParse(cause);
  if (!parsed.success || parsed.data.code !== 'ENOENT') return cause;
  try {
    await access(await nearestExistingAncestor(target), constants.W_OK);
    return cause;
  } catch (denial) {
    const parsedDenial = errnoCodeSchema.safeParse(denial);
    return parsedDenial.success && READ_ONLY_ERRNO_CODES.has(parsedDenial.data.code) ? denial : cause;
  }
};

const failure = <T>(code: 'read_error' | 'internal', cause: unknown, fallbackMessage: string): Result<T, AppError> => ({
  ok: false,
  error: appError(code, cause instanceof Error ? cause.message : fallbackMessage, cause),
});
