import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

type WriteTarget = fs.PathLike | number | fsp.FileHandle;

const repoRoot = path.join(import.meta.dirname, '..');
const smokeSource = fs.readFileSync(path.join(repoRoot, 'scripts', 'smoke.ts'), 'utf8');
const hostCatalogHome = path.join(userInfo().homedir, '.ai-video-cataloger');
const tempDirectories: string[] = [];

const pathValue = (file: WriteTarget): string | null => {
  if (typeof file === 'number') return null;
  if (file instanceof URL) return fileURLToPath(file);
  if (typeof file === 'string') return file;
  if (Buffer.isBuffer(file)) return file.toString();
  return null;
};

const protectedPath = (file: WriteTarget): boolean => {
  const value = pathValue(file);
  if (value === null) return false;
  const resolved = path.resolve(value);
  return resolved === hostCatalogHome || resolved.startsWith(`${hostCatalogHome}${path.sep}`);
};

const writableFlags = (flags: string | number | undefined): boolean => {
  if (flags === undefined) return false;
  if (typeof flags === 'number') {
    return (flags & fs.constants.O_WRONLY) !== 0
      || (flags & fs.constants.O_RDWR) !== 0
      || (flags & fs.constants.O_CREAT) !== 0
      || (flags & fs.constants.O_TRUNC) !== 0
      || (flags & fs.constants.O_APPEND) !== 0;
  }
  return /[wax+]/.test(flags);
};

const blockHostCatalogWrite = (file: WriteTarget, operation: string): void => {
  if (protectedPath(file)) throw new Error(`Blocked ${operation} under host catalog home`);
};

const guardHostCatalogWrites = (): void => {
  const originalOpenSync = fs.openSync.bind(fs);
  vi.spyOn(fs, 'openSync').mockImplementation((file, flags, mode) => {
    if (writableFlags(flags)) blockHostCatalogWrite(file, 'open');
    return originalOpenSync(file, flags, mode);
  });

  const originalMkdirSync = fs.mkdirSync.bind(fs);
  vi.spyOn(fs, 'mkdirSync').mockImplementation((target, options) => {
    blockHostCatalogWrite(target, 'make directory');
    return originalMkdirSync(target, options);
  });

  const originalWriteFileSync = fs.writeFileSync.bind(fs);
  vi.spyOn(fs, 'writeFileSync').mockImplementation((file, data, options) => {
    blockHostCatalogWrite(file, 'write');
    return originalWriteFileSync(file, data, options);
  });

  const originalAppendFileSync = fs.appendFileSync.bind(fs);
  vi.spyOn(fs, 'appendFileSync').mockImplementation((file, data, options) => {
    blockHostCatalogWrite(file, 'append');
    return originalAppendFileSync(file, data, options);
  });

  const originalCreateWriteStream = fs.createWriteStream.bind(fs);
  vi.spyOn(fs, 'createWriteStream').mockImplementation((file, options) => {
    blockHostCatalogWrite(file, 'write stream');
    return originalCreateWriteStream(file, options);
  });

  const originalTruncateSync = fs.truncateSync.bind(fs);
  vi.spyOn(fs, 'truncateSync').mockImplementation((file, len) => {
    blockHostCatalogWrite(file, 'truncate');
    return originalTruncateSync(file, len);
  });

  const originalCopyFileSync = fs.copyFileSync.bind(fs);
  vi.spyOn(fs, 'copyFileSync').mockImplementation((source, destination, mode) => {
    blockHostCatalogWrite(destination, 'copy');
    return originalCopyFileSync(source, destination, mode);
  });

  const originalRenameSync = fs.renameSync.bind(fs);
  vi.spyOn(fs, 'renameSync').mockImplementation((oldPath, newPath) => {
    blockHostCatalogWrite(newPath, 'rename');
    return originalRenameSync(oldPath, newPath);
  });

  const originalRmSync = fs.rmSync.bind(fs);
  vi.spyOn(fs, 'rmSync').mockImplementation((target, options) => {
    blockHostCatalogWrite(target, 'remove');
    return originalRmSync(target, options);
  });

  const originalOpen = fsp.open.bind(fsp);
  vi.spyOn(fsp, 'open').mockImplementation((file, flags, mode) => {
    if (writableFlags(flags)) blockHostCatalogWrite(file, 'open');
    return originalOpen(file, flags, mode);
  });

  const originalMkdir = fsp.mkdir.bind(fsp);
  vi.spyOn(fsp, 'mkdir').mockImplementation((target, options) => {
    blockHostCatalogWrite(target, 'make directory');
    return originalMkdir(target, options);
  });

  const originalWriteFile = fsp.writeFile.bind(fsp);
  vi.spyOn(fsp, 'writeFile').mockImplementation((file, data, options) => {
    blockHostCatalogWrite(file, 'write');
    return originalWriteFile(file, data, options);
  });

  const originalAppendFile = fsp.appendFile.bind(fsp);
  vi.spyOn(fsp, 'appendFile').mockImplementation((file, data, options) => {
    blockHostCatalogWrite(file, 'append');
    return originalAppendFile(file, data, options);
  });

  const originalTruncate = fsp.truncate.bind(fsp);
  vi.spyOn(fsp, 'truncate').mockImplementation((file, len) => {
    blockHostCatalogWrite(file, 'truncate');
    return originalTruncate(file, len);
  });

  const originalCopyFile = fsp.copyFile.bind(fsp);
  vi.spyOn(fsp, 'copyFile').mockImplementation((source, destination, mode) => {
    blockHostCatalogWrite(destination, 'copy');
    return originalCopyFile(source, destination, mode);
  });

  const originalRename = fsp.rename.bind(fsp);
  vi.spyOn(fsp, 'rename').mockImplementation((oldPath, newPath) => {
    blockHostCatalogWrite(newPath, 'rename');
    return originalRename(oldPath, newPath);
  });

  const originalRm = fsp.rm.bind(fsp);
  vi.spyOn(fsp, 'rm').mockImplementation((target, options) => {
    blockHostCatalogWrite(target, 'remove');
    return originalRm(target, options);
  });

  syncBuiltinESMExports();
};

const smokeBootBody = (): string => {
  const start = smokeSource.indexOf('const bootInProcess = async');
  const end = smokeSource.indexOf('const parseEvents', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return smokeSource.slice(start, end);
};

const bootSmokeLikeApps = async (homeDirectory: string): Promise<void> => {
  const { createApp } = await import('@server/src/create-app.js');
  const { createInMemoryDeps } = await import('@server/src/test-support/in-memory-deps.js');
  const photoRoot = '/smoke/photos';

  const app = createApp({ homeDirectory });
  try {
    const health = await app.honoApp.request('/api/health');
    expect(health.ok).toBe(true);
    const live = await app.honoApp.request('/api/health/live');
    expect(live.ok).toBe(true);
  } finally {
    await app.dispose();
  }

  const ready = createApp({ dbDriver: 'memory', homeDirectory }, createInMemoryDeps);
  try {
    const response = await ready.honoApp.request('/api/health/ready');
    expect(response.ok).toBe(true);
  } finally {
    await ready.dispose();
  }

  const deps = createInMemoryDeps({ workingDirectory: photoRoot });
  const facesApp = createApp({ dbDriver: 'memory', homeDirectory, workingDirectory: photoRoot }, () => deps);
  try {
    const response = await facesApp.honoApp.request('/api/health/live');
    expect(response.ok).toBe(true);
  } finally {
    await facesApp.dispose();
  }
};

afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const directory of tempDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('smoke home isolation', () => {
  it('passes an explicit isolated home to every in-process createApp boot', () => {
    const bootBody = smokeBootBody();
    const createAppCalls = [...bootBody.matchAll(/createApp\([\s\S]*?\);/g)]
      .flatMap((match) => {
        const call = match[0];
        return call === undefined ? [] : [call];
      });

    expect(createAppCalls).toHaveLength(3);
    expect(createAppCalls.filter((call) => !call.includes('homeDirectory'))).toEqual([]);
  });

  it('does not open the host catalog home for write during a smoke-like in-process boot', async () => {
    guardHostCatalogWrites();
    const homeDirectory = fs.mkdtempSync(path.join(tmpdir(), 'avc-smoke-home-guard-'));
    tempDirectories.push(homeDirectory);
    const previousHome = process.env.HOME;
    const previousAvcHome = process.env.AVC_HOME_DIRECTORY;
    process.env.HOME = homeDirectory;
    process.env.AVC_HOME_DIRECTORY = homeDirectory;

    try {
      await bootSmokeLikeApps(homeDirectory);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousAvcHome === undefined) delete process.env.AVC_HOME_DIRECTORY;
      else process.env.AVC_HOME_DIRECTORY = previousAvcHome;
    }
  });
});
