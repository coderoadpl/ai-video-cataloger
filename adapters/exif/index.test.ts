import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ExifrExifAdapter } from './index.js';

type TagType = 'ASCII' | 'SHORT' | 'LONG' | 'RATIONAL';

interface TagEntry {
  tag: number;
  type: TagType;
  count: number;
  bytes: Buffer;
}

const TYPE_CODES: Record<TagType, number> = { ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5 };

const asciiTag = (tag: number, value: string): TagEntry => {
  const bytes = Buffer.from(`${value}\0`, 'ascii');
  return { tag, type: 'ASCII', count: bytes.length, bytes };
};

const shortTag = (tag: number, value: number): TagEntry => {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value, 0);
  return { tag, type: 'SHORT', count: 1, bytes };
};

const longTag = (tag: number, value: number): TagEntry => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value, 0);
  return { tag, type: 'LONG', count: 1, bytes };
};

const rationalTag = (tag: number, pairs: [number, number][]): TagEntry => {
  const bytes = Buffer.alloc(8 * pairs.length);
  pairs.forEach(([numerator, denominator], index) => {
    bytes.writeUInt32LE(numerator, index * 8);
    bytes.writeUInt32LE(denominator, index * 8 + 4);
  });
  return { tag, type: 'RATIONAL', count: pairs.length, bytes };
};

const packIfd = (entries: TagEntry[], ifdOffset: number, nextIfdOffset: number): Buffer => {
  const headerSize = 2 + entries.length * 12 + 4;
  let extraOffset = ifdOffset + headerSize;
  const extraChunks: Buffer[] = [];
  const entryBuffers = entries.map((entry) => {
    const buffer = Buffer.alloc(12);
    buffer.writeUInt16LE(entry.tag, 0);
    buffer.writeUInt16LE(TYPE_CODES[entry.type], 2);
    buffer.writeUInt32LE(entry.count, 4);
    if (entry.bytes.length <= 4) {
      entry.bytes.copy(buffer, 8);
    } else {
      buffer.writeUInt32LE(extraOffset, 8);
      extraChunks.push(entry.bytes);
      extraOffset += entry.bytes.length + (entry.bytes.length % 2);
    }
    return buffer;
  });
  const countBuffer = Buffer.alloc(2);
  countBuffer.writeUInt16LE(entries.length, 0);
  const nextBuffer = Buffer.alloc(4);
  nextBuffer.writeUInt32LE(nextIfdOffset, 0);
  return Buffer.concat([countBuffer, ...entryBuffers, nextBuffer, ...extraChunks.map((chunk) =>
    (chunk.length % 2 === 0 ? chunk : Buffer.concat([chunk, Buffer.from([0])])))]);
};

const ifdSize = (entries: TagEntry[]): number => {
  const inlineSize = 2 + entries.length * 12 + 4;
  const extraSize = entries
    .filter((entry) => entry.bytes.length > 4)
    .reduce((total, entry) => total + entry.bytes.length + (entry.bytes.length % 2), 0);
  return inlineSize + extraSize;
};

const buildTiff = (options: {
  ifd0Extra?: TagEntry[];
  exifEntries?: TagEntry[];
  gpsEntries?: TagEntry[];
}): Buffer => {
  const ifd0Offset = 8;
  const hasExif = options.exifEntries !== undefined;
  const hasGps = options.gpsEntries !== undefined;
  const ifd0Entries = [...(options.ifd0Extra ?? [])];
  const ifd0EntriesFinal = [...ifd0Entries];
  if (hasExif) ifd0EntriesFinal.push(longTag(0x8769, 0));
  if (hasGps) ifd0EntriesFinal.push(longTag(0x8825, 0));

  const ifd0Bytes = ifdSize(ifd0EntriesFinal);
  let cursor = ifd0Offset + ifd0Bytes;
  const exifOffset = hasExif ? cursor : 0;
  if (hasExif) cursor += ifdSize(options.exifEntries ?? []);
  const gpsOffset = hasGps ? cursor : 0;

  const patched = ifd0EntriesFinal.map((entry) => {
    if (entry.tag === 0x8769) return longTag(0x8769, exifOffset);
    if (entry.tag === 0x8825) return longTag(0x8825, gpsOffset);
    return entry;
  });

  const ifd0 = packIfd(patched, ifd0Offset, 0);
  const exifIfd = hasExif ? packIfd(options.exifEntries ?? [], exifOffset, 0) : Buffer.alloc(0);
  const gpsIfd = hasGps ? packIfd(options.gpsEntries ?? [], gpsOffset, 0) : Buffer.alloc(0);

  const header = Buffer.alloc(8);
  header.write('II', 0, 'ascii');
  header.writeUInt16LE(42, 2);
  header.writeUInt32LE(ifd0Offset, 4);

  return Buffer.concat([header, ifd0, exifIfd, gpsIfd]);
};

const wrapAsJpeg = (tiff: Buffer): Buffer => {
  const exifHeader = Buffer.from('Exif\0\0', 'ascii');
  const app1Content = Buffer.concat([exifHeader, tiff]);
  const app1Length = app1Content.length + 2;
  const app1 = Buffer.concat([
    Buffer.from([0xff, 0xe1]),
    Buffer.from([(app1Length >> 8) & 0xff, app1Length & 0xff]),
    app1Content,
  ]);
  const soi = Buffer.from([0xff, 0xd8]);
  const minimalScan = Buffer.from([
    0xff, 0xdb, 0x00, 0x03, 0x00, 0x00,
    0xff, 0xda, 0x00, 0x02, 0x00,
  ]);
  const eoi = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([soi, app1, minimalScan, eoi]);
};

describe('ExifrExifAdapter', () => {
  let dir: string;
  const adapter = new ExifrExifAdapter();

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'avc-exif-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads a full EXIF payload: camera, exposure, offset-time, and GPS', async () => {
    const tiff = buildTiff({
      ifd0Extra: [asciiTag(0x010f, 'Acme'), asciiTag(0x0110, 'Camera 9000'), shortTag(0x0112, 1)],
      exifEntries: [
        asciiTag(0x9003, '2026:01:02 10:00:00'),
        asciiTag(0x9011, '+02:00'),
        shortTag(0x8827, 200),
        rationalTag(0x829d, [[28, 10]]),
        rationalTag(0x829a, [[1, 250]]),
      ],
      gpsEntries: [
        asciiTag(0x0001, 'N'),
        rationalTag(0x0002, [[52, 1], [13, 1], [0, 1]]),
        asciiTag(0x0003, 'E'),
        rationalTag(0x0004, [[21, 1], [1, 1], [0, 1]]),
        asciiTag(0x001d, '2026:01:02'),
        rationalTag(0x0007, [[9, 1], [30, 1], [0, 1]]),
      ],
    });
    const filePath = path.join(dir, 'full.jpg');
    writeFileSync(filePath, wrapAsJpeg(tiff));

    const result = await adapter.read(filePath);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      cameraMake: 'Acme',
      cameraModel: 'Camera 9000',
      dateTimeOriginal: '2026:01:02 10:00:00',
      offsetTimeOriginal: '+02:00',
      iso: 200,
      gpsLat: 52.21666666666667,
      gpsLon: 21.016666666666666,
      gpsInstant: '2026-01-02T09:30:00.000Z',
    });
  });

  it('falls back to GPS time when there is no offset', async () => {
    const tiff = buildTiff({
      exifEntries: [asciiTag(0x9003, '2026:01:02 10:00:00')],
      gpsEntries: [
        asciiTag(0x001d, '2026:01:02'),
        rationalTag(0x0007, [[9, 1], [30, 1], [0, 1]]),
      ],
    });
    const filePath = path.join(dir, 'gps-time.jpg');
    writeFileSync(filePath, wrapAsJpeg(tiff));

    const result = await adapter.read(filePath);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.offsetTimeOriginal).toBeNull();
    expect(result.value?.gpsInstant).toBe('2026-01-02T09:30:00.000Z');
  });

  it('returns null for a JPEG with no EXIF at all', async () => {
    const soi = Buffer.from([0xff, 0xd8]);
    const eoi = Buffer.from([0xff, 0xd9]);
    const filePath = path.join(dir, 'no-exif.jpg');
    writeFileSync(filePath, Buffer.concat([soi, eoi]));

    const result = await adapter.read(filePath);

    expect(result).toEqual({ ok: true, value: null });
  });

  it('returns null instead of throwing on a truncated APP1 segment', async () => {
    const soi = Buffer.from([0xff, 0xd8]);
    const truncatedApp1 = Buffer.from([0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66]);
    const eoi = Buffer.from([0xff, 0xd9]);
    const filePath = path.join(dir, 'truncated.jpg');
    writeFileSync(filePath, Buffer.concat([soi, truncatedApp1, eoi]));

    const result = await adapter.read(filePath);

    expect(result).toEqual({ ok: true, value: null });
  });

  it('reports a read_error for a nonexistent path', async () => {
    const result = await adapter.read(path.join(dir, 'missing.jpg'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('read_error');
  });
});
