import { describe, expect, it } from 'vitest';

import { InMemoryFileSystem } from '../../../test/server/usecases/test-fakes.js';

const NFD_A_RING = '/w/Å-ring';
const NFC_A_RING = '/w/Å-ring';

describe('InMemoryFileSystem NFC/NFD fidelity', () => {
  it('finds an NFD-added path via an NFC lookup, mirroring macOS normalization-insensitive lookups', async () => {
    const fs = new InMemoryFileSystem();
    fs.addFile(`${NFD_A_RING}/a.mp4`);

    const result = await fs.exists(`${NFC_A_RING}/a.mp4`);

    expect(result).toEqual({ ok: true, value: true });
  });

  it('preserves the literal on-disk form in listDirectory entries', async () => {
    const fs = new InMemoryFileSystem();
    fs.addFile(`${NFD_A_RING}/a.mp4`);

    const result = await fs.listDirectory(NFC_A_RING);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.path).toBe(`${NFD_A_RING}/a.mp4`);
  });
});
