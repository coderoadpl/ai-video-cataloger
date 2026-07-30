import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findEmbeddedJpegPreview, SipsPhotoMediaAdapter, type RunCommandOutput } from './index.js';

const TIFF_HEADER_SIZE = 8;
const LONG_TYPE = 4;

const jpegBytes = (length: number): Buffer => {
  const buffer = Buffer.alloc(length, 0xaa);
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  return buffer;
};

interface LongEntry {
  tag: number;
  value: number;
}

const buildTwoIfdTiff = (
  littleEndian: boolean,
  options: { ifd0JpegLength: number; ifd1JpegLength: number; ifd0JpegOffsetOverride?: number; ifd0SoiOverride?: number; selfReferenceIfd0?: boolean },
): { buffer: Buffer; ifd0JpegOffset: number; ifd1JpegOffset: number } => {
  const ifd0Offset = TIFF_HEADER_SIZE;
  const ifdSize = 2 + 2 * 12 + 4;
  const ifd1Offset = ifd0Offset + ifdSize;
  const ifd0JpegOffset = ifd1Offset + ifdSize;
  const ifd1JpegOffset = ifd0JpegOffset + options.ifd0JpegLength;
  const totalSize = ifd1JpegOffset + options.ifd1JpegLength;

  const buffer = Buffer.alloc(totalSize);
  buffer.write(littleEndian ? 'II' : 'MM', 0, 'ascii');
  writeUint16(buffer, 2, 42, littleEndian);
  writeUint32(buffer, 4, ifd0Offset, littleEndian);

  const writeIfd = (offset: number, entries: LongEntry[], nextOffset: number): void => {
    let cursor = offset;
    writeUint16(buffer, cursor, entries.length, littleEndian);
    cursor += 2;
    for (const entry of entries) {
      writeUint16(buffer, cursor, entry.tag, littleEndian);
      writeUint16(buffer, cursor + 2, LONG_TYPE, littleEndian);
      writeUint32(buffer, cursor + 4, 1, littleEndian);
      writeUint32(buffer, cursor + 8, entry.value, littleEndian);
      cursor += 12;
    }
    writeUint32(buffer, cursor, nextOffset, littleEndian);
  };

  const jpegOffsetForIfd0 = options.ifd0JpegOffsetOverride ?? ifd0JpegOffset;
  writeIfd(ifd0Offset, [
    { tag: 0x0201, value: jpegOffsetForIfd0 },
    { tag: 0x0202, value: options.ifd0JpegLength },
  ], options.selfReferenceIfd0 === true ? ifd0Offset : ifd1Offset);
  writeIfd(ifd1Offset, [
    { tag: 0x0201, value: ifd1JpegOffset },
    { tag: 0x0202, value: options.ifd1JpegLength },
  ], 0);

  jpegBytes(options.ifd0JpegLength).copy(buffer, ifd0JpegOffset);
  jpegBytes(options.ifd1JpegLength).copy(buffer, ifd1JpegOffset);
  if (options.ifd0SoiOverride !== undefined) buffer[ifd0JpegOffset] = options.ifd0SoiOverride;

  return { buffer, ifd0JpegOffset, ifd1JpegOffset };
};

const writeUint16 = (buffer: Buffer, offset: number, value: number, littleEndian: boolean): void => {
  if (littleEndian) buffer.writeUInt16LE(value, offset);
  else buffer.writeUInt16BE(value, offset);
};

const writeUint32 = (buffer: Buffer, offset: number, value: number, littleEndian: boolean): void => {
  if (littleEndian) buffer.writeUInt32LE(value, offset);
  else buffer.writeUInt32BE(value, offset);
};

describe('findEmbeddedJpegPreview', () => {
  it.each([true, false])('returns the largest valid candidate across the IFD chain (littleEndian=%s)', (littleEndian) => {
    const { buffer, ifd0JpegOffset } = buildTwoIfdTiff(littleEndian, { ifd0JpegLength: 2000, ifd1JpegLength: 200 });
    expect(findEmbeddedJpegPreview(buffer)).toEqual({ offset: ifd0JpegOffset, length: 2000 });
  });

  it('skips a candidate whose offset lies past EOF and returns the remaining one', () => {
    const { buffer, ifd1JpegOffset } = buildTwoIfdTiff(true, {
      ifd0JpegLength: 2000,
      ifd1JpegLength: 200,
      ifd0JpegOffsetOverride: 10_000_000,
    });
    expect(findEmbeddedJpegPreview(buffer)).toEqual({ offset: ifd1JpegOffset, length: 200 });
  });

  it('skips a candidate whose bytes at offset are not the SOI marker', () => {
    const { buffer, ifd1JpegOffset } = buildTwoIfdTiff(true, {
      ifd0JpegLength: 2000,
      ifd1JpegLength: 200,
      ifd0SoiOverride: 0x00,
    });
    expect(findEmbeddedJpegPreview(buffer)).toEqual({ offset: ifd1JpegOffset, length: 200 });
  });

  it('returns null for a non-TIFF header', () => {
    expect(findEmbeddedJpegPreview(Buffer.from('not a tiff file at all'))).toBeNull();
  });

  it('terminates on a self-referencing next-IFD pointer instead of looping forever', () => {
    const { buffer, ifd0JpegOffset } = buildTwoIfdTiff(true, {
      ifd0JpegLength: 2000,
      ifd1JpegLength: 200,
      selfReferenceIfd0: true,
    });
    expect(findEmbeddedJpegPreview(buffer)).toEqual({ offset: ifd0JpegOffset, length: 2000 });
  });

  it('returns null when the buffer is too short to hold a header', () => {
    expect(findEmbeddedJpegPreview(Buffer.from([0x49, 0x49]))).toBeNull();
  });
});

describe('SipsPhotoMediaAdapter', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'avc-photo-media-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const dimensionsOutput = (width: number, height: number): RunCommandOutput => ({
    stdout: `/x:\n  pixelWidth: ${String(width)}\n  pixelHeight: ${String(height)}\n`,
    stderr: '',
    code: 0,
  });

  it('downscales a jpg source directly and reports source "downscale"', async () => {
    const sourcePath = path.join(dir, 'source.jpg');
    const { writeFileSync, mkdirSync } = await import('node:fs');
    writeFileSync(sourcePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const proxyPath = path.join(dir, 'proxies', 'fp.jpg');
    const thumbPath = path.join(dir, 'thumbs', 'fp.jpg');
    mkdirSync(path.dirname(proxyPath), { recursive: true });
    mkdirSync(path.dirname(thumbPath), { recursive: true });

    const runCommand = vi.fn(async (command: string, args: readonly string[]): Promise<RunCommandOutput> => {
      if (args.includes('--out')) {
        const outIndex = args.indexOf('--out');
        const outPath = args[outIndex + 1];
        if (outPath !== undefined) {
          const { writeFileSync: write } = await import('node:fs');
          write(outPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        }
        return { stdout: '', stderr: '', code: 0 };
      }
      return dimensionsOutput(800, 600);
    });

    const adapter = new SipsPhotoMediaAdapter({ runCommand });
    const result = await adapter.createProxy({ sourcePath, ext: 'jpg', proxyPath, thumbPath });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe('downscale');
    expect(result.value.proxyWidth).toBe(800);
    expect(result.value.thumbWidth).toBe(800);

    const { existsSync } = await import('node:fs');
    expect(existsSync(proxyPath)).toBe(true);
    expect(existsSync(thumbPath)).toBe(true);
    expect(existsSync(dir)).toBe(true);
  });

  it('never requests an upscale beyond the source longest edge', async () => {
    const sourcePath = path.join(dir, 'small.jpg');
    const { writeFileSync, mkdirSync } = await import('node:fs');
    writeFileSync(sourcePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const proxyPath = path.join(dir, 'proxies', 'fp.jpg');
    const thumbPath = path.join(dir, 'thumbs', 'fp.jpg');
    mkdirSync(path.dirname(proxyPath), { recursive: true });
    mkdirSync(path.dirname(thumbPath), { recursive: true });

    const zArgs: string[] = [];
    const runCommand = vi.fn(async (_command: string, args: readonly string[]): Promise<RunCommandOutput> => {
      if (args.includes('-Z')) zArgs.push(args[args.indexOf('-Z') + 1] ?? '');
      if (args.includes('--out')) {
        const outPath = args[args.indexOf('--out') + 1];
        if (outPath !== undefined) {
          const { writeFileSync: write } = await import('node:fs');
          write(outPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        }
        return { stdout: '', stderr: '', code: 0 };
      }
      return dimensionsOutput(400, 300);
    });

    const adapter = new SipsPhotoMediaAdapter({ runCommand });
    await adapter.createProxy({ sourcePath, ext: 'jpg', proxyPath, thumbPath });
    expect(zArgs).toContain('400');
    expect(zArgs).not.toContain('1280');
  });

  it('returns thumbnail_error with sips stderr when the proxy conversion fails', async () => {
    const sourcePath = path.join(dir, 'source.jpg');
    const { writeFileSync, mkdirSync } = await import('node:fs');
    writeFileSync(sourcePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const proxyPath = path.join(dir, 'proxies', 'fp.jpg');
    const thumbPath = path.join(dir, 'thumbs', 'fp.jpg');
    mkdirSync(path.dirname(proxyPath), { recursive: true });
    mkdirSync(path.dirname(thumbPath), { recursive: true });

    const runCommand = vi.fn(async (_command: string, args: readonly string[]): Promise<RunCommandOutput> => {
      if (args.includes('--out')) return { stdout: '', stderr: 'sips: corrupt image', code: 1 };
      return dimensionsOutput(800, 600);
    });

    const adapter = new SipsPhotoMediaAdapter({ runCommand });
    const result = await adapter.createProxy({ sourcePath, ext: 'jpg', proxyPath, thumbPath });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('thumbnail_error');
    expect(result.error.message).toContain('corrupt image');
  });

  it('returns ok with null thumb dimensions when only the thumb step fails', async () => {
    const sourcePath = path.join(dir, 'source.jpg');
    const { writeFileSync, mkdirSync } = await import('node:fs');
    writeFileSync(sourcePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const proxyPath = path.join(dir, 'proxies', 'fp.jpg');
    const thumbPath = path.join(dir, 'thumbs', 'fp.jpg');
    mkdirSync(path.dirname(proxyPath), { recursive: true });
    mkdirSync(path.dirname(thumbPath), { recursive: true });

    let outCalls = 0;
    const runCommand = vi.fn(async (_command: string, args: readonly string[]): Promise<RunCommandOutput> => {
      if (args.includes('--out')) {
        outCalls += 1;
        if (outCalls === 1) {
          const outPath = args[args.indexOf('--out') + 1];
          if (outPath !== undefined) {
            const { writeFileSync: write } = await import('node:fs');
            write(outPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
          }
          return { stdout: '', stderr: '', code: 0 };
        }
        return { stdout: '', stderr: 'sips: thumb failed', code: 1 };
      }
      return dimensionsOutput(800, 600);
    });

    const adapter = new SipsPhotoMediaAdapter({ runCommand });
    const result = await adapter.createProxy({ sourcePath, ext: 'jpg', proxyPath, thumbPath });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.thumbWidth).toBeNull();
    expect(result.value.thumbHeight).toBeNull();

    const { existsSync } = await import('node:fs');
    expect(existsSync(proxyPath)).toBe(true);
    expect(existsSync(thumbPath)).toBe(false);
  });

  it('returns read_error when the source file does not exist', async () => {
    const adapter = new SipsPhotoMediaAdapter({ runCommand: vi.fn() });
    const result = await adapter.createProxy({
      sourcePath: path.join(dir, 'missing.jpg'),
      ext: 'jpg',
      proxyPath: path.join(dir, 'proxies', 'fp.jpg'),
      thumbPath: path.join(dir, 'thumbs', 'fp.jpg'),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('read_error');
  });

  it('for a RAW file, extracts the embedded preview and downscales it, reporting source "embedded_preview"', async () => {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { buffer } = buildTwoIfdTiff(true, { ifd0JpegLength: 2000, ifd1JpegLength: 200 });
    const sourcePath = path.join(dir, 'source.arw');
    writeFileSync(sourcePath, buffer);
    const proxyPath = path.join(dir, 'proxies', 'fp.jpg');
    const thumbPath = path.join(dir, 'thumbs', 'fp.jpg');
    mkdirSync(path.dirname(proxyPath), { recursive: true });
    mkdirSync(path.dirname(thumbPath), { recursive: true });

    const runCommand = vi.fn(async (_command: string, args: readonly string[]): Promise<RunCommandOutput> => {
      if (args.includes('--out')) {
        const outPath = args[args.indexOf('--out') + 1];
        if (outPath !== undefined) {
          const { writeFileSync: write } = await import('node:fs');
          write(outPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        }
        return { stdout: '', stderr: '', code: 0 };
      }
      return dimensionsOutput(1616, 1080);
    });

    const adapter = new SipsPhotoMediaAdapter({ runCommand });
    const result = await adapter.createProxy({ sourcePath, ext: 'arw', proxyPath, thumbPath });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe('embedded_preview');
  });

  it('falls back to full decode when no embedded preview is found in a RAW file', async () => {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const sourcePath = path.join(dir, 'source.dng');
    writeFileSync(sourcePath, Buffer.from('not a tiff'));
    const proxyPath = path.join(dir, 'proxies', 'fp.jpg');
    const thumbPath = path.join(dir, 'thumbs', 'fp.jpg');
    mkdirSync(path.dirname(proxyPath), { recursive: true });
    mkdirSync(path.dirname(thumbPath), { recursive: true });

    const runCommand = vi.fn(async (_command: string, args: readonly string[]): Promise<RunCommandOutput> => {
      if (args.includes('--out')) {
        const outPath = args[args.indexOf('--out') + 1];
        if (outPath !== undefined) {
          const { writeFileSync: write } = await import('node:fs');
          write(outPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        }
        return { stdout: '', stderr: '', code: 0 };
      }
      return dimensionsOutput(1616, 1080);
    });

    const adapter = new SipsPhotoMediaAdapter({ runCommand });
    const result = await adapter.createProxy({ sourcePath, ext: 'dng', proxyPath, thumbPath });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe('full_decode');
  });

  it('removes the staging directory after success', async () => {
    const { writeFileSync, mkdirSync, readdirSync } = await import('node:fs');
    const sourcePath = path.join(dir, 'source.jpg');
    writeFileSync(sourcePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const proxyPath = path.join(dir, 'proxies', 'fp.jpg');
    const thumbPath = path.join(dir, 'thumbs', 'fp.jpg');
    mkdirSync(path.dirname(proxyPath), { recursive: true });
    mkdirSync(path.dirname(thumbPath), { recursive: true });

    const stagingDirs: string[] = [];
    const runCommand = vi.fn(async (_command: string, args: readonly string[]): Promise<RunCommandOutput> => {
      if (args.includes('--out')) {
        const outPath = args[args.indexOf('--out') + 1];
        if (outPath !== undefined) {
          stagingDirs.push(path.dirname(outPath));
          const { writeFileSync: write } = await import('node:fs');
          write(outPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        }
        return { stdout: '', stderr: '', code: 0 };
      }
      return dimensionsOutput(800, 600);
    });

    const adapter = new SipsPhotoMediaAdapter({ runCommand });
    await adapter.createProxy({ sourcePath, ext: 'jpg', proxyPath, thumbPath });
    const stagingDir = stagingDirs[0];
    expect(stagingDir).toBeDefined();
    if (stagingDir === undefined) return;
    expect(() => readdirSync(stagingDir)).toThrow();
  });
});
