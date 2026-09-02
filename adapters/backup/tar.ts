import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { constants, createZstdCompress, createZstdDecompress } from 'node:zlib';

import { appError, ok, type AppError, type Result } from '@core/domain/index.js';

const BLOCK_SIZE = 512;
const FILE_MODE = 0o644;
const DIRECTORY_MODE = 0o755;
const COPY_BUFFER_SIZE = 1024 * 1024;

export interface TarSourceEntry {
  archivePath: string;
  sourcePath: string;
  kind: 'file' | 'directory';
}

export interface TarWriteOptions {
  signal?: AbortSignal | undefined;
  allowUnsafeArchivePath?: boolean | undefined;
  streamFactory?: ((sourcePath: string, signal?: AbortSignal | undefined) => Readable) | undefined;
}

interface ValidatedEntry {
  archivePath: string;
  kind: 'file' | 'directory';
  sizeBytes: number;
  dataOffset: number;
}

export const writeTarZstd = async (
  entries: readonly TarSourceEntry[],
  destinationPath: string,
  createdAt: string,
  options: TarWriteOptions = {},
): Promise<Result<{ sizeBytes: number }, AppError>> => {
  const compressorFactory = createZstdCompress;
  if (typeof compressorFactory !== 'function') {
    return { ok: false, error: appError('internal', 'Native zstd compression is unavailable') };
  }
  const tempPath = `${destinationPath}.tmp`;
  try {
    mkdirSync(path.dirname(destinationPath), { recursive: true });
    const sorted = [...entries].sort((left, right) => Buffer.compare(
      Buffer.from(left.archivePath),
      Buffer.from(right.archivePath),
    ));
    if (options.allowUnsafeArchivePath !== true) {
      for (const entry of sorted) validateArchivePath(entry.archivePath);
    }
    const source = Readable.from(tarChunks(sorted, createdAt, options.signal, options.streamFactory));
    const compressor = compressorFactory({
      params: { [constants.ZSTD_c_compressionLevel]: 10 },
    });
    const output = createWriteStream(tempPath, { mode: 0o600 });
    if (options.signal === undefined) await pipeline(source, compressor, output);
    else await pipeline(source, compressor, output, { signal: options.signal });
    renameSync(tempPath, destinationPath);
    return ok({ sizeBytes: statSync(destinationPath).size });
  } catch (cause) {
    removeIfPresent(tempPath);
    if (cause instanceof BackupArchiveIntegrityError) {
      return { ok: false, error: appError('backup_integrity_failed', cause.message) };
    }
    return { ok: false, error: appError('internal', `Could not create backup archive: ${errorMessage(cause)}`) };
  }
};

export const extractTarZstd = async (
  archivePath: string,
  destinationDirectory: string,
  signal?: AbortSignal | undefined,
): Promise<Result<{ files: string[] }, AppError>> => {
  const decompressorFactory = createZstdDecompress;
  if (typeof decompressorFactory !== 'function') {
    return { ok: false, error: appError('internal', 'Native zstd decompression is unavailable') };
  }
  const rawPath = `${archivePath}.${process.pid}.tar.tmp`;
  try {
    const source = createReadStream(archivePath);
    const decompressor = decompressorFactory();
    const output = createWriteStream(rawPath, { mode: 0o600 });
    if (signal === undefined) await pipeline(source, decompressor, output);
    else await pipeline(source, decompressor, output, { signal });
    const entries = validateTar(rawPath, signal);
    extractValidatedTar(rawPath, destinationDirectory, entries, signal);
    removeIfPresent(rawPath);
    return ok({ files: entries.filter((entry) => entry.kind === 'file').map((entry) => entry.archivePath) });
  } catch (cause) {
    removeIfPresent(rawPath);
    return {
      ok: false,
      error: appError('backup_integrity_failed', `Backup archive integrity check failed: ${errorMessage(cause)}`),
    };
  }
};

const tarChunks = async function* (
  entries: readonly TarSourceEntry[],
  createdAt: string,
  signal?: AbortSignal | undefined,
  streamFactory?: ((sourcePath: string, signal?: AbortSignal | undefined) => Readable) | undefined,
): AsyncGenerator<Buffer> {
  const mtime = Math.floor(new Date(createdAt).getTime() / 1000);
  if (!Number.isFinite(mtime)) throw new Error('Invalid archive creation time');
  for (const entry of entries) {
    throwIfAborted(signal);
    const size = entry.kind === 'file' ? statSync(entry.sourcePath).size : 0;
    yield createHeader(entry.archivePath, entry.kind, size, mtime);
    if (entry.kind === 'file') {
      let written = 0;
      const stream = streamFactory?.(entry.sourcePath, signal) ?? createReadStream(entry.sourcePath, { signal });
      for await (const chunk of stream) {
        if (!Buffer.isBuffer(chunk)) throw new Error('File stream returned a non-buffer chunk');
        if (written + chunk.length > size) {
          throw new BackupArchiveIntegrityError(`Archive entry changed while reading: ${entry.archivePath}`);
        }
        written += chunk.length;
        yield chunk;
      }
      if (written !== size) {
        throw new BackupArchiveIntegrityError(`Archive entry changed while reading: ${entry.archivePath}`);
      }
      const padding = paddingFor(size);
      if (padding > 0) yield Buffer.alloc(padding);
    }
  }
  yield Buffer.alloc(BLOCK_SIZE * 2);
};

class BackupArchiveIntegrityError extends Error {}

const createHeader = (archivePath: string, kind: TarSourceEntry['kind'], size: number, mtime: number): Buffer => {
  const normalized = kind === 'directory' && !archivePath.endsWith('/') ? `${archivePath}/` : archivePath;
  const split = splitUstarPath(normalized);
  const header = Buffer.alloc(BLOCK_SIZE);
  writeString(header, split.name, 0, 100);
  writeOctal(header, kind === 'file' ? FILE_MODE : DIRECTORY_MODE, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, mtime, 136, 12);
  header.fill(0x20, 148, 156);
  header[156] = kind === 'file' ? 0x30 : 0x35;
  writeString(header, 'ustar\0', 257, 6);
  writeString(header, '00', 263, 2);
  writeString(header, split.prefix, 345, 155);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeChecksum(header, checksum);
  return header;
};

const splitUstarPath = (archivePath: string): { name: string; prefix: string } => {
  if (Buffer.byteLength(archivePath) <= 100) return { name: archivePath, prefix: '' };
  const separators: number[] = [];
  for (let index = 0; index < archivePath.length; index += 1) {
    if (archivePath[index] === '/') separators.push(index);
  }
  for (let index = separators.length - 1; index >= 0; index -= 1) {
    const separator = separators[index];
    if (separator === undefined) continue;
    const prefix = archivePath.slice(0, separator);
    const name = archivePath.slice(separator + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix };
  }
  throw new Error(`Archive path exceeds ustar limits: ${archivePath}`);
};

const writeString = (target: Buffer, value: string, offset: number, length: number): void => {
  const bytes = Buffer.from(value);
  if (bytes.length > length) throw new Error(`ustar field exceeds ${String(length)} bytes`);
  bytes.copy(target, offset);
};

const writeOctal = (target: Buffer, value: number, offset: number, length: number): void => {
  const encoded = Math.trunc(value).toString(8).padStart(length - 1, '0');
  if (encoded.length >= length) throw new Error('Numeric value exceeds ustar field');
  writeString(target, `${encoded}\0`, offset, length);
};

const writeChecksum = (target: Buffer, value: number): void => {
  const encoded = value.toString(8).padStart(6, '0');
  if (encoded.length > 6) throw new Error('Header checksum exceeds ustar field');
  writeString(target, `${encoded}\0 `, 148, 8);
};

const validateTar = (tarPath: string, signal?: AbortSignal | undefined): ValidatedEntry[] => {
  const descriptor = openSync(tarPath, 'r');
  try {
    const totalSize = fstatSync(descriptor).size;
    const entries: ValidatedEntry[] = [];
    const header = Buffer.alloc(BLOCK_SIZE);
    let offset = 0;
    let terminated = false;
    while (offset < totalSize) {
      throwIfAborted(signal);
      readExactly(descriptor, header, offset);
      if (header.every((byte) => byte === 0)) {
        const second = Buffer.alloc(BLOCK_SIZE);
        readExactly(descriptor, second, offset + BLOCK_SIZE);
        if (!second.every((byte) => byte === 0)) throw new Error('Tar archive has an incomplete terminator');
        terminated = true;
        break;
      }
      validateChecksum(header);
      if (header.subarray(257, 263).toString('utf8') !== 'ustar\0') throw new Error('Tar header is not ustar');
      const name = readString(header, 0, 100);
      const prefix = readString(header, 345, 155);
      const archivePath = prefix.length === 0 ? name : `${prefix}/${name}`;
      validateArchivePath(archivePath);
      const type = header[156];
      if (type !== 0 && type !== 0x30 && type !== 0x35) throw new Error('Unsupported tar entry type');
      const kind = type === 0x35 ? 'directory' : 'file';
      const sizeBytes = parseOctal(header, 124, 12);
      const dataOffset = offset + BLOCK_SIZE;
      const nextOffset = dataOffset + sizeBytes + paddingFor(sizeBytes);
      if (nextOffset > totalSize) throw new Error('Tar archive is truncated');
      entries.push({ archivePath: stripDirectorySlash(archivePath), kind, sizeBytes, dataOffset });
      offset = nextOffset;
    }
    if (!terminated) throw new Error('Tar archive is missing its terminator');
    return entries;
  } finally {
    closeSync(descriptor);
  }
};

const extractValidatedTar = (
  tarPath: string,
  destinationDirectory: string,
  entries: readonly ValidatedEntry[],
  signal?: AbortSignal | undefined,
): void => {
  mkdirSync(destinationDirectory, { recursive: true, mode: DIRECTORY_MODE });
  const descriptor = openSync(tarPath, 'r');
  const buffer = Buffer.alloc(COPY_BUFFER_SIZE);
  try {
    for (const entry of entries) {
      throwIfAborted(signal);
      const targetPath = path.join(destinationDirectory, entry.archivePath);
      if (entry.kind === 'directory') {
        mkdirSync(targetPath, { recursive: true, mode: DIRECTORY_MODE });
        continue;
      }
      mkdirSync(path.dirname(targetPath), { recursive: true, mode: DIRECTORY_MODE });
      const output = openSync(targetPath, 'w', FILE_MODE);
      try {
        let remaining = entry.sizeBytes;
        let position = entry.dataOffset;
        while (remaining > 0) {
          throwIfAborted(signal);
          const length = Math.min(buffer.length, remaining);
          const bytesRead = readSync(descriptor, buffer, 0, length, position);
          if (bytesRead !== length) throw new Error('Tar archive is truncated');
          writeSync(output, buffer, 0, bytesRead);
          remaining -= bytesRead;
          position += bytesRead;
        }
      } finally {
        closeSync(output);
      }
    }
  } finally {
    closeSync(descriptor);
  }
};

const validateArchivePath = (archivePath: string): void => {
  if (archivePath.startsWith('/') || archivePath.includes('//') || archivePath.includes('\\')) throw new Error('Unsafe archive path');
  const segments = archivePath.split('/');
  if (segments.some((segment) => segment === '..') || segments[0] === '') throw new Error('Unsafe archive path');
};

const validateChecksum = (header: Buffer): void => {
  const expected = parseOctal(header, 148, 8);
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index] ?? 0;
  }
  if (actual !== expected) throw new Error('Tar header checksum mismatch');
};

const parseOctal = (source: Buffer, offset: number, length: number): number => {
  const value = source.subarray(offset, offset + length).toString('ascii').replaceAll('\0', '').trim();
  if (!/^[0-7]+$/.test(value)) throw new Error('Invalid ustar numeric field');
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('Invalid ustar numeric value');
  return parsed;
};

const readString = (source: Buffer, offset: number, length: number): string => {
  const bytes = source.subarray(offset, offset + length);
  const terminator = bytes.indexOf(0);
  return bytes.subarray(0, terminator === -1 ? bytes.length : terminator).toString('utf8');
};

const readExactly = (descriptor: number, target: Buffer, position: number): void => {
  if (readSync(descriptor, target, 0, target.length, position) !== target.length) throw new Error('Tar archive is truncated');
};

const paddingFor = (size: number): number => (BLOCK_SIZE - (size % BLOCK_SIZE)) % BLOCK_SIZE;
const stripDirectorySlash = (value: string): string => value.endsWith('/') ? value.slice(0, -1) : value;
const throwIfAborted = (signal?: AbortSignal | undefined): void => {
  if (signal?.aborted === true) throw signal.reason instanceof Error ? signal.reason : new Error('Operation aborted');
};
const removeIfPresent = (targetPath: string): void => {
  if (existsSync(targetPath)) unlinkSync(targetPath);
};
const errorMessage = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);
