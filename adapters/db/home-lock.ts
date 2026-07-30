import {
  closeSync,
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

import { appError, type AppError } from '@core/domain/index.js';
import type { CatalogLockInfo, CatalogLockProcessName, CatalogLockSnapshot } from '@core/server/index.js';

const LOCK_ACQUIRE_ATTEMPTS = 5;

export interface CatalogLockFs {
  mkdirSync: (dir: string, options: { recursive: true }) => void;
  openSync: (file: string, flags: string) => number;
  writeFileSync: (fd: number, data: string, encoding: 'utf8') => void;
  fsyncSync: (fd: number) => void;
  closeSync: (fd: number) => void;
  readFileSync: (file: string, encoding: 'utf8') => string;
  unlinkSync: (file: string) => void;
}

export const defaultLockFs: CatalogLockFs = {
  mkdirSync: (dir, options) => {
    mkdirSync(dir, options);
  },
  openSync: (file, flags) => openSync(file, flags),
  writeFileSync: (fd, data, encoding) => {
    writeFileSync(fd, data, encoding);
  },
  fsyncSync: (fd) => {
    fsyncSync(fd);
  },
  closeSync: (fd) => {
    closeSync(fd);
  },
  readFileSync: (file, encoding) => readFileSync(file, encoding),
  unlinkSync: (file) => {
    unlinkSync(file);
  },
};

export class CatalogAppError extends Error {
  constructor(readonly appError: AppError) {
    super(appError.message);
  }
}

export interface HomeLockOptions {
  homeDirectory: string;
  processName: CatalogLockProcessName;
  lockMode: 'none' | 'lazy' | 'eager';
  isProcessAlive?: ((pid: number) => boolean) | undefined;
  lockFs?: CatalogLockFs | undefined;
}

export class HomeLock {
  private readonly lockPath: string;
  private readonly processName: CatalogLockProcessName;
  private readonly lockMode: 'none' | 'lazy' | 'eager';
  private readonly isProcessAlive: (pid: number) => boolean;
  private readonly lockFs: CatalogLockFs;
  private leaseCount = 0;
  private heldLock: CatalogLockInfo | null = null;
  private exitHandlerRegistered = false;
  private readonly releaseOnExit = (): void => {
    this.forceRelease();
  };

  constructor(options: HomeLockOptions) {
    this.lockPath = path.join(options.homeDirectory, '.ai-video-cataloger', 'catalog.lock');
    this.processName = options.processName;
    this.lockMode = options.lockMode;
    this.isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
    this.lockFs = options.lockFs ?? defaultLockFs;
  }

  acquireLease(): void {
    this.takeWriteLock();
    this.leaseCount += 1;
  }

  releaseLease(): void {
    if (this.leaseCount > 0) this.leaseCount -= 1;
  }

  releaseIfIdle(): void {
    if (this.leaseCount === 0) this.forceRelease();
  }

  forceRelease(): void {
    if (this.heldLock === null) return;
    const existing = readLockInfo(this.lockPath, this.lockFs);
    if (
      existing !== null
      && existing.pid === this.heldLock.pid
      && existing.processName === this.heldLock.processName
      && existing.startedAt === this.heldLock.startedAt
    ) {
      try {
        this.lockFs.unlinkSync(this.lockPath);
      } catch (cause) {
        if (!isNodeErrorCode(cause, 'ENOENT')) throw cause;
      }
    }
    this.heldLock = null;
    if (this.exitHandlerRegistered) {
      process.removeListener('exit', this.releaseOnExit);
      this.exitHandlerRegistered = false;
    }
  }

  takeWriteLock(): string[] {
    if (this.lockMode === 'none') return [];
    if (this.heldLock !== null) return [];
    const warnings: string[] = [];
    this.lockFs.mkdirSync(path.dirname(this.lockPath), { recursive: true });
    const info: CatalogLockInfo = {
      pid: process.pid,
      processName: this.processName,
      startedAt: new Date().toISOString(),
      hostname: hostname(),
    };
    for (let attempt = 0; attempt < LOCK_ACQUIRE_ATTEMPTS; attempt += 1) {
      try {
        const descriptor = this.lockFs.openSync(this.lockPath, 'wx');
        try {
          this.lockFs.writeFileSync(descriptor, `${JSON.stringify(info)}\n`, 'utf8');
          this.lockFs.fsyncSync(descriptor);
        } finally {
          this.lockFs.closeSync(descriptor);
        }
        const confirmed = readLockInfo(this.lockPath, this.lockFs);
        if (confirmed !== null && confirmed.pid === process.pid && confirmed.startedAt === info.startedAt) {
          this.heldLock = info;
          this.registerExitHandler();
          return warnings;
        }
        continue;
      } catch (cause) {
        if (!isNodeErrorCode(cause, 'EEXIST')) throw cause;
        const existing = readLockInfo(this.lockPath, this.lockFs);
        if (existing !== null && existing.pid === process.pid && existing.hostname === hostname()) {
          this.heldLock = existing;
          this.registerExitHandler();
          return warnings;
        }
        if (existing !== null && existing.hostname !== hostname()) throw new CatalogAppError(catalogLockedError(existing));
        if (existing !== null && this.isProcessAlive(existing.pid)) throw new CatalogAppError(catalogLockedError(existing));
        if (existing !== null) {
          const warning = `Taking over stale catalog lock from ${existing.processName} PID ${String(existing.pid)}`;
          warnings.push(warning);
          process.emitWarning(warning);
        }
        const beforeUnlink = readLockInfo(this.lockPath, this.lockFs);
        if (!sameLock(beforeUnlink, existing)) continue;
        try {
          this.lockFs.unlinkSync(this.lockPath);
        } catch (unlinkCause) {
          if (!isNodeErrorCode(unlinkCause, 'ENOENT')) throw unlinkCause;
        }
      }
    }
    const existing = readLockInfo(this.lockPath, this.lockFs);
    if (existing !== null) throw new CatalogAppError(catalogLockedError(existing));
    throw new Error('Could not acquire catalog lock');
  }

  snapshot(warnings: string[]): CatalogLockSnapshot {
    if (this.lockMode === 'none') return { writable: true, owner: null, blockedBy: null, warnings };
    if (this.heldLock !== null) {
      return { writable: true, owner: this.heldLock, blockedBy: null, warnings };
    }
    const existing = readLockInfo(this.lockPath, this.lockFs);
    if (existing === null) return { writable: true, owner: null, blockedBy: null, warnings };
    if (existing.hostname !== hostname()) {
      return { writable: false, owner: null, blockedBy: existing, warnings };
    }
    if (!this.isProcessAlive(existing.pid)) {
      return { writable: true, owner: null, blockedBy: null, warnings: [...warnings, `Stale catalog lock from ${existing.processName} PID ${String(existing.pid)}`] };
    }
    return { writable: false, owner: null, blockedBy: existing, warnings };
  }

  private registerExitHandler(): void {
    if (this.exitHandlerRegistered) return;
    process.once('exit', this.releaseOnExit);
    this.exitHandlerRegistered = true;
  }
}

const catalogLockedError = (info: CatalogLockInfo): AppError =>
  appError(
    'catalog_locked',
    `Catalog is in use by ${info.processName} (PID ${String(info.pid)} on ${info.hostname}, started ${info.startedAt}). Close it or wait.`,
    info,
  );

const lockInfoSchema = z.object({
  pid: z.number().int().positive(),
  processName: z.enum(['gui', 'cli']),
  startedAt: z.string().min(1),
  hostname: z.string().min(1),
});

const readLockInfo = (lockPath: string, fs: CatalogLockFs): CatalogLockInfo | null => {
  let raw: string;
  try {
    raw = fs.readFileSync(lockPath, 'utf8');
  } catch (cause) {
    if (isNodeErrorCode(cause, 'ENOENT')) return null;
    throw cause;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const lockInfo = lockInfoSchema.safeParse(parsed);
    return lockInfo.success ? lockInfo.data : null;
  } catch {
    return null;
  }
};

const sameLock = (left: CatalogLockInfo | null, right: CatalogLockInfo | null): boolean => {
  if (left === null || right === null) return left === right;
  return left.pid === right.pid
    && left.processName === right.processName
    && left.startedAt === right.startedAt
    && left.hostname === right.hostname;
};

const defaultIsProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    if (isNodeErrorCode(cause, 'ESRCH')) return false;
    return true;
  }
};

const isNodeErrorCode = (cause: unknown, code: string): boolean =>
  cause instanceof Error && 'code' in cause && cause.code === code;
