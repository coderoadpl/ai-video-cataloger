import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NodeFileSystemPort } from './index.js';

describe('fullContentHash', () => {
  let dir: string;
  const fs = new NodeFileSystemPort();

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'avc-fch-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('equals a plain sha256 of the full file contents', async () => {
    const filePath = path.join(dir, 'photo.jpg');
    const bytes = Buffer.from('some photo bytes, not actually a jpeg');
    writeFileSync(filePath, bytes);
    const expected = createHash('sha256').update(bytes).digest('hex');

    const result = await fs.fullContentHash(filePath);

    expect(result).toEqual({ ok: true, value: expected });
  });

  it('returns null for a missing file', async () => {
    const result = await fs.fullContentHash(path.join(dir, 'missing.jpg'));
    expect(result).toEqual({ ok: true, value: null });
  });

  it('changes when the content differs even with identical size', async () => {
    const a = path.join(dir, 'a.jpg');
    const b = path.join(dir, 'b.jpg');
    writeFileSync(a, Buffer.from('AAAAAAAAAA'));
    writeFileSync(b, Buffer.from('BBBBBBBBBB'));

    const hashA = await fs.fullContentHash(a);
    const hashB = await fs.fullContentHash(b);

    expect(hashA.ok && hashB.ok && hashA.value !== hashB.value).toBe(true);
  });
});
