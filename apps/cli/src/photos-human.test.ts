import { describe, expect, it } from 'vitest';

import { photosForgetHuman, photosStatusHuman } from './photos-human.js';

describe('photosStatusHuman', () => {
  it('formats an overall status', () => {
    const text = photosStatusHuman({
      media: 'photo',
      root: null,
      counts: { photos: 10, paths: 12, exifRead: 8, exifFailed: 2, missing: 1, duplicates: 2 },
    });
    expect(text).toBe(
      'Scope: all photos\n'
      + 'Photos: 10 (12 paths, 2 duplicated)\n'
      + 'EXIF read: 8 / failed: 2\n'
      + 'Missing: 1',
    );
  });

  it('formats a root-scoped status', () => {
    const text = photosStatusHuman({
      media: 'photo',
      root: '/media/photos',
      counts: { photos: 1, paths: 1, exifRead: 0, exifFailed: 1, missing: 0, duplicates: 0 },
    });
    expect(text).toContain('Scope: /media/photos');
  });
});

describe('photosForgetHuman', () => {
  it('formats a forget summary', () => {
    const text = photosForgetHuman({
      media: 'photo',
      root: '/media/photos',
      pathsRemoved: 3,
      photosDeleted: 2,
      photosRepointed: 1,
    });
    expect(text).toBe('Forgot /media/photos: 3 paths removed, 2 photos deleted, 1 photos re-pointed');
  });
});
