import { crc32 } from 'node:zlib';
import { deflateSync } from 'node:zlib';

const chunk = (type: string, payload: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typed) >>> 0);
  return Buffer.concat([length, typed, checksum]);
};

export const syntheticPng = (size: number): Buffer => {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 3 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x += 1) {
      const pixel = rowStart + 1 + x * 3;
      const horizon = y < size / 2;
      const sun = Math.hypot(x - size * 0.7, y - size * 0.25) < size * 0.12;
      raw[pixel] = sun ? 250 : horizon ? 90 + Math.round((y / size) * 120) : 40 + ((x + y) % 40);
      raw[pixel + 1] = sun ? 230 : horizon ? 140 + Math.round((y / size) * 90) : 90 + ((x * 2 + y) % 60);
      raw[pixel + 2] = sun ? 120 : horizon ? 220 - Math.round((y / size) * 60) : 50 + ((x + y * 3) % 40);
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};
