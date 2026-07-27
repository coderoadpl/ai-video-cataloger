import path from 'node:path';

import { z } from 'zod';

const DESKTOP_EXECUTABLE_PATHS = ['/opt/homebrew/bin', '/usr/local/bin'];
const absolutePathSchema = z.string().refine(path.isAbsolute);

export const buildDesktopPath = (currentPath: string | undefined): string => {
  const entries = currentPath?.split(path.delimiter).filter((entry) => entry.length > 0) ?? [];
  return [...entries, ...DESKTOP_EXECUTABLE_PATHS.filter((entry) => !entries.includes(entry))].join(path.delimiter);
};

export const userDataDirectoryOverride = (
  argv: readonly string[],
  isPackaged: boolean,
  environmentValue: string | undefined = process.env.AI_VIDEO_CATALOGER_USER_DATA_DIR,
): string | null => {
  const environmentOverride = absolutePathSchema.safeParse(environmentValue);
  if (environmentOverride.success) return environmentOverride.data;
  if (isPackaged) return null;
  const value = argv.find((arg) => arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
  const flagOverride = absolutePathSchema.safeParse(value);
  return flagOverride.success ? flagOverride.data : null;
};
