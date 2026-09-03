import { z } from 'zod';

import { ok, type AppError, type Result } from '@core/domain/index.js';

import type { FileSystemPort } from '../ports.js';

export const backupOwnerSchema = z.object({
  pid: z.number().int().positive(),
  hostname: z.string().min(1),
  startedAt: z.string().min(1).optional(),
}).strict();

export type BackupOwner = z.output<typeof backupOwnerSchema>;

export type BackupOwnerLiveness = (owner: BackupOwner) => boolean;

export const BACKUP_STAGING_OWNER_SUFFIX = '.owner.json';

export const backupStagingRoot = (fs: FileSystemPort, homeDirectory: string): string =>
  fs.join(homeDirectory, '.ai-video-cataloger', 'backup-staging');

export const backupStagingOwnerPath = (stagingDirectory: string): string =>
  `${stagingDirectory}${BACKUP_STAGING_OWNER_SUFFIX}`;

// The marker is a sibling of the staging directory and is written first: a cleanup that runs
// between the two writes must never see a staging directory without an owner.
export const claimBackupStaging = async (
  fs: FileSystemPort,
  stagingDirectory: string,
  owner: BackupOwner,
): Promise<Result<void, AppError>> => {
  const root = await fs.ensureDirectory(fs.dirname(stagingDirectory));
  if (!root.ok) return root;
  const marked = await fs.writeTextFile(backupStagingOwnerPath(stagingDirectory), `${JSON.stringify(owner)}\n`);
  if (!marked.ok) return marked;
  return fs.ensureDirectory(stagingDirectory);
};

export const releaseBackupStaging = async (
  fs: FileSystemPort,
  stagingDirectory: string,
): Promise<Result<void, AppError>> => {
  const removed = await fs.deletePath(stagingDirectory);
  if (!removed.ok) return removed;
  return fs.deleteFile(backupStagingOwnerPath(stagingDirectory));
};

export const readBackupStagingOwner = async (
  fs: FileSystemPort,
  stagingDirectory: string,
): Promise<Result<BackupOwner | null, AppError>> => {
  const text = await fs.readTextFile(backupStagingOwnerPath(stagingDirectory));
  if (!text.ok) return text;
  if (text.value === null) return ok(null);
  let decoded: unknown;
  try {
    decoded = JSON.parse(text.value);
  } catch {
    return ok(null);
  }
  const parsed = backupOwnerSchema.safeParse(decoded);
  return ok(parsed.success ? parsed.data : null);
};
