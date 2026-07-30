import { describe, expect, it } from 'vitest';

import { deriveLibrarySeed } from './show-in-library.js';

const folders = [
  { folderId: '9f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d', displayName: 'Kamper', currentPath: '/Volumes/lib/Kamper', online: true, count: 12 },
  { folderId: 'path-deadbeef', displayName: 'Dron', currentPath: '/Volumes/lib/Dron', online: false, count: 3 },
];

describe('deriveLibrarySeed', () => {
  it('uses the catalogued folder id, not a path hash, for a folder whose id was persisted as a uuid', () => {
    const seed = deriveLibrarySeed('/Volumes/lib/Kamper', 'Kamper', 'fp-1', folders);

    expect(seed).toEqual({ folderId: '9f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d', folderLabel: 'Kamper', fingerprint: 'fp-1' });
  });

  it('matches the catalogued folder across unicode normalization forms of the same path', () => {
    const seed = deriveLibrarySeed('/Volumes/lib/Kamper'.normalize('NFD'), 'Kamper', null, folders);

    expect(seed.folderId).toBe('9f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d');
  });

  it('falls back to the derived path id when the folder is not catalogued yet', () => {
    const seed = deriveLibrarySeed('/Volumes/lib/Unknown', 'Unknown', null, folders);

    expect(seed.folderId).toMatch(/^path-[0-9a-f]{8}$/);
  });
});
