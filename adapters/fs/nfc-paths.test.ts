import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NodeFileSystemPort } from './index.js';

const NFD_A_RING = 'Å-ring'.normalize('NFD');
const NFC_A_RING = 'Å-ring'.normalize('NFC');

describe('NodeFileSystemPort NFC canonicalization', () => {
  let dir: string;
  const fs = new NodeFileSystemPort();

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'avc-nfc-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolve() folds an NFD segment into NFC', () => {
    const resolved = fs.resolve(path.join(dir, NFD_A_RING));
    expect(resolved.endsWith(NFC_A_RING)).toBe(true);
    expect(resolved.endsWith(NFD_A_RING)).toBe(false);
  });

  it('join() folds NFD segments into NFC', () => {
    const joined = fs.join(dir, NFD_A_RING, 'a.mp4');
    expect(joined.includes(NFC_A_RING)).toBe(true);
  });

  it('returns NFC names and paths from listDirectory() when the on-disk entry is NFD', async () => {
    const nfdDir = path.join(dir, NFD_A_RING);
    mkdirSync(nfdDir);
    writeFileSync(path.join(nfdDir, 'a.mp4'), 'x');

    const result = await fs.listDirectory(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.name).toBe(NFC_A_RING);
    expect(result.value[0]?.path.endsWith(NFC_A_RING)).toBe(true);
  });

  it('opens a file written with an NFD name through its NFC path, proving the platform lookup is normalization-insensitive', async () => {
    const nfdDir = path.join(dir, NFD_A_RING);
    mkdirSync(nfdDir);
    writeFileSync(path.join(nfdDir, 'a.txt'), 'hello');

    const nfcPath = path.join(dir, NFC_A_RING, 'a.txt');
    const content = await fs.readTextFile(nfcPath);
    expect(content).toEqual({ ok: true, value: 'hello' });
  });
});
