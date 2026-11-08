import { describe, expect, it } from 'vitest';

import { canonicalPath, isPathUnderRoot, rebasePath, rebasePathByPrefixes } from './paths.js';

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

describe('isPathUnderRoot', () => {
  it('matches the root itself and its descendants', () => {
    expect(isPathUnderRoot('/Volumes/media', '/Volumes/media')).toBe(true);
    expect(isPathUnderRoot('/Volumes/media/a/b', '/Volumes/media')).toBe(true);
  });

  it('rejects a sibling that only shares the prefix', () => {
    expect(isPathUnderRoot('/Volumes/media2', '/Volumes/media')).toBe(false);
    expect(isPathUnderRoot('/Volumes/media2/a', '/Volumes/media')).toBe(false);
  });

  it('compares the canonical form of both sides', () => {
    expect(isPathUnderRoot(`/Volumes/${NFD_A_RING}/clip`, `/Volumes/${NFC_A_RING}`)).toBe(true);
    expect(isPathUnderRoot(`/Volumes/${NFC_A_RING}/clip`, `/Volumes/${NFD_A_RING}`)).toBe(true);
  });
});

describe('rebasePath', () => {
  it('replaces the root prefix and keeps the remainder', () => {
    expect(rebasePath('/Volumes/media/a/b', '/Volumes/media', '/Volumes/library')).toBe('/Volumes/library/a/b');
    expect(rebasePath('/Volumes/media', '/Volumes/media', '/Volumes/library')).toBe('/Volumes/library');
  });

  it('returns null outside the root', () => {
    expect(rebasePath('/Volumes/media2/a', '/Volumes/media', '/Volumes/library')).toBeNull();
  });

  it('returns the canonical form', () => {
    expect(rebasePath(`/Volumes/media/${NFD_A_RING}`, '/Volumes/media', '/Volumes/library')).toBe(`/Volumes/library/${NFC_A_RING}`);
  });
});

describe('rebasePathByPrefixes', () => {
  const prefixes = [
    { from: '/Volumes/media', to: '/Volumes/library' },
    { from: '/home/mirror/path-00000001', to: '/home/mirror/path-00000002' },
  ];

  it('applies the first prefix that contains the path', () => {
    expect(rebasePathByPrefixes('/Volumes/media/a.jpg', prefixes)).toBe('/Volumes/library/a.jpg');
    expect(rebasePathByPrefixes('/home/mirror/path-00000001/thumbnails/a.jpg', prefixes))
      .toBe('/home/mirror/path-00000002/thumbnails/a.jpg');
  });

  it('returns null when no prefix contains the path', () => {
    expect(rebasePathByPrefixes('/Volumes/media2/a.jpg', prefixes)).toBeNull();
  });
});
