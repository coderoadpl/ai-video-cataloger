import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NodeFileSystemPort } from './index.js';

describe('NodeFileSystemPort.isWritable', () => {
  let dir: string;
  const fs = new NodeFileSystemPort();

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'avc-writable-'));
  });

  afterEach(() => {
    chmodSync(dir, 0o755);
    rmSync(dir, { recursive: true, force: true });
  });

  it('is true for a writable directory', async () => {
    expect(await fs.isWritable(dir)).toEqual({ ok: true, value: true });
  });

  it('is false for the same directory made read-only', async () => {
    chmodSync(dir, 0o555);
    expect(await fs.isWritable(dir)).toEqual({ ok: true, value: false });
  });

  it('is false, not an error, for a missing path', async () => {
    expect(await fs.isWritable(path.join(dir, 'missing'))).toEqual({ ok: true, value: false });
  });
});
