import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

import { appError, ok, type AppError, type Result } from '@core/domain/index.js';
import type { CatalogLockInfo, CatalogLockProcessName } from '@core/server/index.js';

export interface CatalogLockProcessPort {
  pid(): number;
  hostname(): string;
  now(): Date;
  isPidAlive(pid: number): boolean;
  warn(message: string): void;
}

export interface HeldCatalogLock {
  info: CatalogLockInfo;
  release(): void;
}

export const defaultCatalogLockProcessPort: CatalogLockProcessPort = {
  pid: () => process.pid,
  hostname,
  now: () => new Date(),
  isPidAlive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
  warn: (message) => {
    process.emitWarning(message);
  },
};

const lockInfoSchema = z.object({
  pid: z.number().int().positive(),
  processName: z.enum(['gui', 'cli']),
  startedAt: z.string().min(1),
  hostname: z.string().min(1),
});

export const catalogLockedMessage = (info: CatalogLockInfo): string =>
  `Catalog is in use by ${info.processName} (PID ${String(info.pid)}, started ${info.startedAt}). Close it or wait.`;

export const catalogLockPath = (databasePath: string): string =>
  path.join(path.dirname(databasePath), 'catalog.lock');

export const acquireCatalogLock = (
  lockPath: string,
  processName: CatalogLockProcessName,
  port: CatalogLockProcessPort,
): Result<HeldCatalogLock, AppError> => {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const info: CatalogLockInfo = {
    pid: port.pid(),
    processName,
    startedAt: port.now().toISOString(),
    hostname: port.hostname(),
  };
  const created = createLockFile(lockPath, info);
  if (created.ok) return ok(heldLock(lockPath, info));
  if (created.error.code !== 'conflict') return created;

  const existing = readCatalogLock(lockPath);
  if (!existing.ok) return existing;
  if (port.isPidAlive(existing.value.pid)) {
    return { ok: false, error: appError('catalog_locked', catalogLockedMessage(existing.value), existing.value) };
  }

  unlinkSync(lockPath);
  port.warn(`Breaking stale catalog lock for ${existing.value.processName} PID ${String(existing.value.pid)}`);
  const replaced = createLockFile(lockPath, info);
  if (!replaced.ok) return replaced;
  return ok(heldLock(lockPath, info));
};

export const readCatalogLock = (lockPath: string): Result<CatalogLockInfo, AppError> => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(lockPath, 'utf8'));
    const info = lockInfoSchema.safeParse(parsed);
    if (!info.success) return { ok: false, error: appError('internal', `Invalid catalog lock file: ${lockPath}`) };
    return ok(info.data);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : `Could not read catalog lock: ${lockPath}`;
    return { ok: false, error: appError('internal', message, cause) };
  }
};

const createLockFile = (lockPath: string, info: CatalogLockInfo): Result<void, AppError> => {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(lockPath, 'wx');
    writeFileSync(descriptor, JSON.stringify(info, null, 2), 'utf8');
    fsyncSync(descriptor);
    return ok(undefined);
  } catch (cause) {
    if (errorCode(cause) === 'EEXIST') return { ok: false, error: appError('conflict', `Catalog lock exists: ${lockPath}`) };
    const message = cause instanceof Error ? cause.message : `Could not create catalog lock: ${lockPath}`;
    return { ok: false, error: appError('internal', message, cause) };
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
};

const heldLock = (lockPath: string, info: CatalogLockInfo): HeldCatalogLock => ({
  info,
  release: () => {
    if (!existsSync(lockPath)) return;
    const current = readCatalogLock(lockPath);
    if (current.ok && sameLock(current.value, info)) unlinkSync(lockPath);
  },
});

const sameLock = (left: CatalogLockInfo, right: CatalogLockInfo): boolean =>
  left.pid === right.pid
  && left.processName === right.processName
  && left.startedAt === right.startedAt
  && left.hostname === right.hostname;

const errorCode = (cause: unknown): string | null => {
  if (!(cause instanceof Error) || !('code' in cause)) return null;
  return typeof cause.code === 'string' ? cause.code : null;
};
