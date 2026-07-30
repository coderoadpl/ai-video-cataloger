import { describe, expect, it } from 'vitest';

import { photosForgetHuman, photosProxiesHuman, photosStatusHuman } from './photos-human.js';

describe('photosStatusHuman', () => {
  it('formats an overall status', () => {
    const text = photosStatusHuman({
      media: 'photo',
      root: null,
      counts: { photos: 10, paths: 12, exifRead: 8, exifFailed: 2, missing: 1, duplicates: 2, proxied: 7, proxyFailed: 1 },
    });
    expect(text).toBe(
      'Scope: all photos\n'
      + 'Photos: 10 (12 paths, 2 duplicated)\n'
      + 'EXIF read: 8 / failed: 2\n'
      + 'Proxies: 7 generated, 1 failed\n'
      + 'Missing: 1',
    );
  });

  it('formats a root-scoped status', () => {
    const text = photosStatusHuman({
      media: 'photo',
      root: '/media/photos',
      counts: { photos: 1, paths: 1, exifRead: 0, exifFailed: 1, missing: 0, duplicates: 0, proxied: 0, proxyFailed: 0 },
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
      artifactPaths: ['/home/.ai-video-cataloger/photo-artifacts/proxies/ph_1.jpg'],
    });
    expect(text).toBe('Forgot /media/photos: 3 paths removed, 2 photos deleted, 1 photos re-pointed');
  });
});

describe('photosProxiesHuman', () => {
  it('formats a proxies summary', () => {
    const text = photosProxiesHuman({
      media: 'photo',
      root: '/media/photos',
      force: false,
      candidates: 163,
      generated: 120,
      skippedExisting: 40,
      failed: 3,
      thumbFailed: 0,
    });
    expect(text).toBe('Proxies: 120 generated, 3 failed, 40 already present (163 candidates)');
  });
});
