import { describe, expect, it } from 'vitest';

import { photoViewerSourceCandidates } from './photo-source.js';

describe('photoViewerSourceCandidates', () => {
  it('offers the original then the proxy for a renderable extension', () => {
    expect(photoViewerSourceCandidates({ ext: 'jpg', currentPath: '/a.jpg', missingAt: null }, '/proxy/a.jpg')).toEqual([
      '/a.jpg',
      '/proxy/a.jpg',
    ]);
  });

  it('offers only the original when there is no proxy yet', () => {
    expect(photoViewerSourceCandidates({ ext: 'png', currentPath: '/a.png', missingAt: null }, null)).toEqual(['/a.png']);
  });

  it('offers only the proxy for a non-renderable raw extension', () => {
    expect(photoViewerSourceCandidates({ ext: 'arw', currentPath: '/a.arw', missingAt: null }, '/proxy/a.jpg')).toEqual([
      '/proxy/a.jpg',
    ]);
  });

  it('skips the original once the file is flagged missing', () => {
    expect(photoViewerSourceCandidates({ ext: 'jpg', currentPath: '/a.jpg', missingAt: 1_700_000_000 }, '/proxy/a.jpg')).toEqual([
      '/proxy/a.jpg',
    ]);
  });

  it('offers nothing when there is no renderable original and no proxy', () => {
    expect(photoViewerSourceCandidates({ ext: 'arw', currentPath: '/a.arw', missingAt: null }, null)).toEqual([]);
  });
});
