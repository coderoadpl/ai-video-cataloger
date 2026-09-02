import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll } from 'vitest';

const hostHome = userInfo().homedir;
const protectedRoots = [
  path.join(hostHome, '.ai-video-cataloger', 'models', 'face-detector'),
  path.join(hostHome, '.ai-video-cataloger', 'models', 'face-embedder'),
];
const testHome = fs.mkdtempSync(path.join(tmpdir(), 'avc-vitest-home-'));

process.env.HOME = testHome;
process.env.AVC_HOME_DIRECTORY = testHome;

const pathValue = (file) => {
  if (file instanceof globalThis.URL) return fileURLToPath(file);
  if (typeof file === 'string') return file;
  return null;
};

const protectedPath = (file) => {
  const value = pathValue(file);
  if (value === null) return false;
  const resolved = path.resolve(value);
  return protectedRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
};

const writableFlags = (flags) => {
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

const block = (file, operation) => {
  if (protectedPath(file)) throw new Error(`Blocked ${operation} under the host face model cache`);
};

const originalOpenSync = fs.openSync.bind(fs);
fs.openSync = (file, flags, mode) => {
  if (writableFlags(flags)) block(file, 'open');
  return originalOpenSync(file, flags, mode);
};

const originalWriteFileSync = fs.writeFileSync.bind(fs);
fs.writeFileSync = (file, data, options) => {
  block(file, 'write');
  return originalWriteFileSync(file, data, options);
};

const originalCreateWriteStream = fs.createWriteStream.bind(fs);
fs.createWriteStream = (file, options) => {
  block(file, 'write stream');
  return originalCreateWriteStream(file, options);
};

const originalTruncateSync = fs.truncateSync.bind(fs);
fs.truncateSync = (file, len) => {
  block(file, 'truncate');
  return originalTruncateSync(file, len);
};

const originalCopyFileSync = fs.copyFileSync.bind(fs);
fs.copyFileSync = (source, destination, mode) => {
  block(destination, 'copy');
  return originalCopyFileSync(source, destination, mode);
};

const originalRenameSync = fs.renameSync.bind(fs);
fs.renameSync = (oldPath, newPath) => {
  block(newPath, 'rename');
  return originalRenameSync(oldPath, newPath);
};

const originalOpen = fsp.open.bind(fsp);
fsp.open = (file, flags, mode) => {
  if (writableFlags(flags)) block(file, 'open');
  return originalOpen(file, flags, mode);
};

const originalWriteFile = fsp.writeFile.bind(fsp);
fsp.writeFile = (file, data, options) => {
  block(file, 'write');
  return originalWriteFile(file, data, options);
};

const originalTruncate = fsp.truncate.bind(fsp);
fsp.truncate = (file, len) => {
  block(file, 'truncate');
  return originalTruncate(file, len);
};

const originalCopyFile = fsp.copyFile.bind(fsp);
fsp.copyFile = (source, destination, mode) => {
  block(destination, 'copy');
  return originalCopyFile(source, destination, mode);
};

const originalRename = fsp.rename.bind(fsp);
fsp.rename = (oldPath, newPath) => {
  block(newPath, 'rename');
  return originalRename(oldPath, newPath);
};

syncBuiltinESMExports();

afterAll(() => {
  fs.rmSync(testHome, { recursive: true, force: true });
});
