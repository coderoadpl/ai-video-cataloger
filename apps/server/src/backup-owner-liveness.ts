import { spawnSync } from 'node:child_process';
import { hostname } from 'node:os';

import { z } from 'zod';

import type { BackupOwner, BackupOwnerLiveness } from '@core/server/index.js';

const PS_COMMAND_PATH = '/bin/ps';
const psResultSchema = z.object({ status: z.number().nullable(), stdout: z.string() });

// /bin/ps renders lstart with strftime in the caller's LC_TIME and TZ, so a marker a
// Finder-launched GUI writes under the C locale would never match the string a Terminal CLI
// reads under LANG=pl_PL.UTF-8, and a live owner would be judged dead.
const psEnvironment = (): NodeJS.ProcessEnv => ({ ...process.env, LC_ALL: 'C', TZ: 'UTC' });

export const readProcessStartedAt = (pid: number): string | null => {
  const parsed = psResultSchema.safeParse(
    spawnSync(PS_COMMAND_PATH, ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      env: psEnvironment(),
    }),
  );
  if (!parsed.success || parsed.data.status !== 0) return null;
  const startedAt = parsed.data.stdout.trim();
  return startedAt.length === 0 ? null : startedAt;
};

const defaultIsProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return !(cause instanceof Error && 'code' in cause && cause.code === 'ESRCH');
  }
};

export interface BackupOwnerLivenessOptions {
  processStartedAt?: ((pid: number) => string | null) | undefined;
  isProcessAlive?: ((pid: number) => boolean) | undefined;
}

export const createBackupOwnerLiveness = (
  options: BackupOwnerLivenessOptions = {},
): BackupOwnerLiveness => {
  const startedAt = options.processStartedAt ?? readProcessStartedAt;
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  return (owner) => {
    if (owner.startedAt === undefined || startedAt(process.pid) === null) return isProcessAlive(owner.pid);
    return startedAt(owner.pid) === owner.startedAt;
  };
};

export const currentBackupOwner = (): BackupOwner => {
  const startedAt = readProcessStartedAt(process.pid);
  return {
    pid: process.pid,
    hostname: hostname(),
    ...(startedAt === null ? {} : { startedAt }),
  };
};
