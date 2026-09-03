import { z } from 'zod';

import { ok, type AppError, type Result } from '@core/domain/index.js';

import type { FileSystemPort } from '../ports.js';

export const backupOwnerSchema = z.object({
  pid: z.number().int().positive(),
  hostname: z.string().min(1),
}).strict();

export type BackupOwner = z.output<typeof backupOwnerSchema>;

export type BackupOwnerLiveness = (owner: BackupOwner) => boolean;

const OWNER_FILE_NAME = 'owner.json';

export const backupStagingRoot = (fs: FileSystemPort, homeDirectory: string): string =>
  fs.join(homeDirectory, '.ai-video-cataloger', 'backup-staging');

export const writeBackupStagingOwner = (
  fs: FileSystemPort,
  stagingDirectory: string,
  owner: BackupOwner,
): Promise<Result<void, AppError>> =>
  fs.writeTextFile(fs.join(stagingDirectory, OWNER_FILE_NAME), `${JSON.stringify(owner)}\n`);

export const readBackupStagingOwner = async (
  fs: FileSystemPort,
  stagingDirectory: string,
): Promise<Result<BackupOwner | null, AppError>> => {
  const text = await fs.readTextFile(fs.join(stagingDirectory, OWNER_FILE_NAME));
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
