import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { appError, ok, type AppError, type PhotoExtension, type Result } from '@core/domain/index.js';
import type { PhotoMediaPort, PhotoProxyOutcome } from '@core/server/index.js';

const MAX_IFD_COUNT = 32;
const MAX_ENTRIES_PER_IFD = 4096;
const JPEG_INTERCHANGE_FORMAT_TAG = 0x0201;
const JPEG_INTERCHANGE_FORMAT_LENGTH_TAG = 0x0202;
const SUB_IFDS_TAG = 0x014a;
const SOI_MARKER = [0xff, 0xd8];

interface JpegCandidate {
  offset: number;
  length: number;
}

export const findEmbeddedJpegPreview = (bytes: Uint8Array): JpegCandidate | null => {
  try {
    return findEmbeddedJpegPreviewUnsafe(bytes);
  } catch {
    return null;
  }
};

const findEmbeddedJpegPreviewUnsafe = (bytes: Uint8Array): JpegCandidate | null => {
  if (bytes.length < 8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const littleEndian = detectByteOrder(view);
  if (littleEndian === null) return null;
  const firstIfdOffset = view.getUint32(4, littleEndian);

  const visited = new Set<number>();
  const queue: number[] = [firstIfdOffset];
  const candidates: JpegCandidate[] = [];
  let ifdsRead = 0;

  while (queue.length > 0 && ifdsRead < MAX_IFD_COUNT) {
    const offset = queue.shift();
    if (offset === undefined || offset === 0 || visited.has(offset)) continue;
    visited.add(offset);
    ifdsRead += 1;

    const ifd = readIfd(view, offset, littleEndian, bytes.length);
    if (ifd === null) continue;

    const jpegOffset = readSingleEntryValue(ifd.entries.get(JPEG_INTERCHANGE_FORMAT_TAG), view, littleEndian);
    const jpegLength = readSingleEntryValue(ifd.entries.get(JPEG_INTERCHANGE_FORMAT_LENGTH_TAG), view, littleEndian);
    if (jpegOffset !== null && jpegLength !== null && isValidJpegRegion(bytes, jpegOffset, jpegLength)) {
      candidates.push({ offset: jpegOffset, length: jpegLength });
    }

    const subIfdEntry = ifd.entries.get(SUB_IFDS_TAG);
    if (subIfdEntry !== undefined) {
      for (const subOffset of readEntryValues(subIfdEntry, view, littleEndian)) queue.push(subOffset);
    }
    if (ifd.nextIfdOffset !== 0) queue.push(ifd.nextIfdOffset);
  }

  if (candidates.length === 0) return null;
  candidates.sort((left, right) => right.length - left.length);
  return candidates[0] ?? null;
};

const detectByteOrder = (view: DataView): boolean | null => {
  const marker = view.getUint16(0, false);
  if (marker === 0x4949 && view.getUint16(2, true) === 42) return true;
  if (marker === 0x4d4d && view.getUint16(2, false) === 42) return false;
  return null;
};

interface IfdEntry {
  type: number;
  count: number;
  valueOffset: number;
}

interface Ifd {
  entries: Map<number, IfdEntry>;
  nextIfdOffset: number;
}

const TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

const readIfd = (view: DataView, offset: number, littleEndian: boolean, dataLength: number): Ifd | null => {
  if (offset + 2 > dataLength) return null;
  const entryCount = view.getUint16(offset, littleEndian);
  if (entryCount > MAX_ENTRIES_PER_IFD) return null;
  const entriesEnd = offset + 2 + entryCount * 12;
  if (entriesEnd + 4 > dataLength) return null;
  const entries = new Map<number, IfdEntry>();
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = offset + 2 + index * 12;
    const tag = view.getUint16(entryOffset, littleEndian);
    const type = view.getUint16(entryOffset + 2, littleEndian);
    const count = view.getUint32(entryOffset + 4, littleEndian);
    entries.set(tag, { type, count, valueOffset: entryOffset + 8 });
  }
  const nextIfdOffset = view.getUint32(entriesEnd, littleEndian);
  return { entries, nextIfdOffset };
};

const readEntryValues = (entry: IfdEntry, view: DataView, littleEndian: boolean): number[] => {
  const typeSize = TYPE_SIZES[entry.type] ?? 4;
  const totalSize = typeSize * entry.count;
  const dataOffset = totalSize > 4 ? safeUint32(view, entry.valueOffset, littleEndian) : entry.valueOffset;
  if (dataOffset === null) return [];
  const values: number[] = [];
  for (let index = 0; index < entry.count; index += 1) {
    const at = dataOffset + index * typeSize;
    const value = readTypedValue(view, at, entry.type, littleEndian);
    if (value !== null) values.push(value);
  }
  return values;
};

const readSingleEntryValue = (entry: IfdEntry | undefined, view: DataView, littleEndian: boolean): number | null => {
  if (entry === undefined) return null;
  const values = readEntryValues(entry, view, littleEndian);
  return values[0] ?? null;
};

const readTypedValue = (view: DataView, offset: number, type: number, littleEndian: boolean): number | null => {
  try {
    switch (type) {
      case 1:
      case 2:
      case 6:
      case 7:
        return view.getUint8(offset);
      case 3:
      case 8:
        return view.getUint16(offset, littleEndian);
      case 4:
      case 9:
        return view.getUint32(offset, littleEndian);
      default:
        return view.getUint32(offset, littleEndian);
    }
  } catch {
    return null;
  }
};

const safeUint32 = (view: DataView, offset: number, littleEndian: boolean): number | null => {
  try {
    return view.getUint32(offset, littleEndian);
  } catch {
    return null;
  }
};

const isValidJpegRegion = (bytes: Uint8Array, offset: number, length: number): boolean => {
  if (offset < 0 || length <= 0 || offset + length > bytes.length) return false;
  return bytes[offset] === SOI_MARKER[0] && bytes[offset + 1] === SOI_MARKER[1];
};

export interface RunCommandOutput {
  stdout: string;
  stderr: string;
  code: number;
}

export type RunCommand = (command: string, args: readonly string[]) => Promise<RunCommandOutput>;

const defaultRunCommand: RunCommand = (command, args) =>
  new Promise((resolve) => {
    execFile(command, [...args], { maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error === null) {
        resolve({ stdout, stderr, code: 0 });
        return;
      }
      const code = typeof error.code === 'number' ? error.code : 1;
      resolve({ stdout, stderr, code });
    });
  });

interface Dimensions {
  width: number;
  height: number;
}

export interface SipsPhotoMediaAdapterOptions {
  sipsPath?: string | undefined;
  runCommand?: RunCommand | undefined;
}

export class SipsPhotoMediaAdapter implements PhotoMediaPort {
  private readonly sipsPath: string;
  private readonly runCommand: RunCommand;

  constructor(options: SipsPhotoMediaAdapterOptions = {}) {
    this.sipsPath = options.sipsPath ?? '/usr/bin/sips';
    this.runCommand = options.runCommand ?? defaultRunCommand;
  }

  async createProxy(input: {
    sourcePath: string;
    ext: PhotoExtension;
    proxyPath: string;
    thumbPath: string;
  }): Promise<Result<PhotoProxyOutcome, AppError>> {
    try {
      await stat(input.sourcePath);
    } catch (cause) {
      return { ok: false, error: appError('read_error', `Photo source not readable: ${input.sourcePath}`, cause) };
    }

    await mkdir(dirname(input.proxyPath), { recursive: true });
    await mkdir(dirname(input.thumbPath), { recursive: true });

    let stagingDir: string;
    try {
      stagingDir = await mkdtemp(join(tmpdir(), 'avc-photo-'));
    } catch (cause) {
      return { ok: false, error: appError('read_error', 'Failed to create photo proxy staging directory', cause) };
    }

    try {
      const isRaw = input.ext === 'arw' || input.ext === 'dng';
      let source: PhotoProxyOutcome['source'];
      let proxyDims: Dimensions;
      const stagingProxyPath = join(stagingDir, 'proxy.jpg');

      if (isRaw) {
        const embedded = await this.tryEmbeddedPreview(input.sourcePath, stagingDir, stagingProxyPath);
        if (embedded !== null) {
          if (!embedded.ok) return embedded;
          source = 'embedded_preview';
          proxyDims = embedded.value;
        } else {
          const fullDecode = await this.downscaleToTarget(input.sourcePath, stagingProxyPath, 1280);
          if (!fullDecode.ok) return fullDecode;
          source = 'full_decode';
          proxyDims = fullDecode.value;
        }
      } else {
        const downscaled = await this.downscaleToTarget(input.sourcePath, stagingProxyPath, 1280);
        if (!downscaled.ok) return downscaled;
        source = 'downscale';
        proxyDims = downscaled.value;
      }

      const stagingThumbPath = join(stagingDir, 'thumb.jpg');
      const thumbResult = await this.downscaleToTarget(stagingProxyPath, stagingThumbPath, 320);

      await rename(stagingProxyPath, input.proxyPath);
      let thumbWidth: number | null = null;
      let thumbHeight: number | null = null;
      if (thumbResult.ok) {
        await rename(stagingThumbPath, input.thumbPath);
        thumbWidth = thumbResult.value.width;
        thumbHeight = thumbResult.value.height;
      }

      return ok({
        proxyWidth: proxyDims.width,
        proxyHeight: proxyDims.height,
        thumbWidth,
        thumbHeight,
        source,
      });
    } finally {
      await rm(stagingDir, { recursive: true, force: true });
    }
  }

  private async tryEmbeddedPreview(
    sourcePath: string,
    stagingDir: string,
    stagingProxyPath: string,
  ): Promise<Result<Dimensions, AppError> | null> {
    let bytes: Buffer;
    try {
      bytes = await readFile(sourcePath);
    } catch (cause) {
      return { ok: false, error: appError('read_error', `Failed to read RAW file: ${sourcePath}`, cause) };
    }
    const preview = findEmbeddedJpegPreview(bytes);
    if (preview === null) return null;
    const previewPath = join(stagingDir, 'preview.jpg');
    try {
      await writeFile(previewPath, bytes.subarray(preview.offset, preview.offset + preview.length));
    } catch (cause) {
      return { ok: false, error: appError('read_error', `Failed to stage embedded preview: ${sourcePath}`, cause) };
    }
    const result = await this.downscaleToTarget(previewPath, stagingProxyPath, 1280);
    return result.ok ? result : null;
  }

  private async queryDimensions(filePath: string): Promise<Result<Dimensions, AppError>> {
    const result = await this.runCommand(this.sipsPath, ['-g', 'pixelWidth', '-g', 'pixelHeight', filePath]);
    if (result.code !== 0) {
      return { ok: false, error: appError('thumbnail_error', `sips dimension query failed for ${filePath}: ${result.stderr || result.stdout}`) };
    }
    const width = /pixelWidth:\s*(\d+)/.exec(result.stdout)?.[1];
    const height = /pixelHeight:\s*(\d+)/.exec(result.stdout)?.[1];
    if (width === undefined || height === undefined) {
      return { ok: false, error: appError('thumbnail_error', `sips dimension query returned no dimensions for ${filePath}`) };
    }
    return ok({ width: Number(width), height: Number(height) });
  }

  private async downscaleToTarget(sourcePath: string, outPath: string, maxEdge: number): Promise<Result<Dimensions, AppError>> {
    const sourceDims = await this.queryDimensions(sourcePath);
    if (!sourceDims.ok) return sourceDims;
    const target = Math.min(maxEdge, Math.max(sourceDims.value.width, sourceDims.value.height));
    const converted = await this.runCommand(this.sipsPath, [
      '-s', 'format', 'jpeg',
      '-s', 'formatOptions', '82',
      '-Z', String(target),
      sourcePath,
      '--out', outPath,
    ]);
    if (converted.code !== 0) {
      return { ok: false, error: appError('thumbnail_error', `sips convert failed for ${sourcePath}: ${converted.stderr || converted.stdout}`) };
    }
    try {
      const outStat = await stat(outPath);
      if (outStat.size <= 0) {
        return { ok: false, error: appError('thumbnail_error', `sips produced an empty file: ${outPath}`) };
      }
    } catch (cause) {
      return { ok: false, error: appError('thumbnail_error', `sips output missing: ${outPath}`, cause) };
    }
    return this.queryDimensions(outPath);
  }
}
