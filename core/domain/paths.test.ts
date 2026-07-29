import { describe, expect, it } from 'vitest';

import { canonicalPath } from './paths.js';

const NFC_A_RING = 'Å-ring';
const NFD_A_RING = 'Å-ring';

describe('canonicalPath', () => {
  it('folds NFD into NFC', () => {
    expect(canonicalPath(NFD_A_RING)).toBe(NFC_A_RING);
    expect(NFD_A_RING).not.toBe(NFC_A_RING);
  });

  it('is idempotent on an already-NFC value', () => {
    expect(canonicalPath(NFC_A_RING)).toBe(NFC_A_RING);
  });

  it('leaves ASCII untouched', () => {
    expect(canonicalPath('/plain/ascii/path')).toBe('/plain/ascii/path');
  });
});
