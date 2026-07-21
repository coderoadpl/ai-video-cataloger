import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NodeFileSystemPort } from './index.js';

const fill = (size: number, seed: number): Buffer => {
  const buffer = Buffer.alloc(size);
  for (let index = 0; index < size; index += 1) buffer[index] = (index * 31 + seed) % 251;
  return buffer;
};

const unwrapHash = async (fs: NodeFileSystemPort, filePath: string): Promise<string> => {
  const result = await fs.partialContentHash(filePath);
  if (!result.ok || result.value === null) throw new Error('hash failed');
  return result.value;
};

describe('partialContentHash identity', () => {
  let dir: string;
  const fs = new NodeFileSystemPort();

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'avc-fp-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is invariant across rename and move for a multi-window file', async () => {
    const original = path.join(dir, 'clip.mp4');
    writeFileSync(original, fill(3 * 1024 * 1024, 7));
    const hash = await unwrapHash(fs, original);

    const renamed = path.join(dir, 'renamed.mp4');
    writeFileSync(renamed, fill(3 * 1024 * 1024, 7));
    expect(await unwrapHash(fs, renamed)).toBe(hash);

    const nestedDir = path.join(dir, 'nested');
    mkdirSync(nestedDir, { recursive: true });
    const moved = path.join(nestedDir, 'clip.mp4');
    writeFileSync(moved, fill(3 * 1024 * 1024, 7));
    expect(await unwrapHash(fs, moved)).toBe(hash);
  });

  it('is invariant across rename for a small single-window file', async () => {
    const original = path.join(dir, 'small.mp4');
    writeFileSync(original, fill(4096, 3));
    const hash = await unwrapHash(fs, original);

    const renamed = path.join(dir, 'renamed-small.mp4');
    writeFileSync(renamed, fill(4096, 3));
    expect(await unwrapHash(fs, renamed)).toBe(hash);
  });

  it('changes when the file content changes', async () => {
    const original = path.join(dir, 'a.mp4');
    writeFileSync(original, fill(2 * 1024 * 1024, 1));
    const hash = await unwrapHash(fs, original);

    const different = path.join(dir, 'b.mp4');
    writeFileSync(different, fill(2 * 1024 * 1024, 2));
    expect(await unwrapHash(fs, different)).not.toBe(hash);
  });
});
