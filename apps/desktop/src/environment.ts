import path from 'node:path';

const DESKTOP_EXECUTABLE_PATHS = ['/opt/homebrew/bin', '/usr/local/bin'];

export const buildDesktopPath = (currentPath: string | undefined): string => {
  const entries = currentPath?.split(path.delimiter).filter((entry) => entry.length > 0) ?? [];
  return [...entries, ...DESKTOP_EXECUTABLE_PATHS.filter((entry) => !entries.includes(entry))].join(path.delimiter);
};

export const userDataDirectoryOverride = (
  argv: readonly string[],
  isPackaged: boolean,
): string | null => {
  if (isPackaged) return null;
  const value = argv.find((arg) => arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
  return value !== undefined && path.isAbsolute(value) ? value : null;
};
