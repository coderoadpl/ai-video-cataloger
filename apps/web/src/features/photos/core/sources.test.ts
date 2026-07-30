import { describe, expect, it } from 'vitest';

import { viewerSourceCandidates } from './sources.js';

describe('viewerSourceCandidates', () => {
  it('offers the original path then the proxy for a present jpg/jpeg/png', () => {
    expect(viewerSourceCandidates({ ext: 'jpg', currentPath: '/a.jpg', missingAt: null }, '/proxy/a.jpg')).toEqual([
      '/a.jpg',
      '/proxy/a.jpg',
    ]);
    expect(viewerSourceCandidates({ ext: 'png', currentPath: '/a.png', missingAt: null }, null)).toEqual(['/a.png']);
  });

  it('renders RAW and HEIC exclusively via the proxy', () => {
    expect(viewerSourceCandidates({ ext: 'arw', currentPath: '/a.arw', missingAt: null }, '/proxy/a.jpg')).toEqual([
      '/proxy/a.jpg',
    ]);
    expect(viewerSourceCandidates({ ext: 'heic', currentPath: '/a.heic', missingAt: null }, '/proxy/a.jpg')).toEqual([
      '/proxy/a.jpg',
    ]);
  });

  it('drops the original candidate for a missing photo', () => {
    expect(viewerSourceCandidates({ ext: 'jpg', currentPath: '/a.jpg', missingAt: 1_700_000_000 }, '/proxy/a.jpg')).toEqual([
      '/proxy/a.jpg',
    ]);
  });

  it('returns an empty array when nothing is available, signalling the no-proxy-yet placeholder', () => {
    expect(viewerSourceCandidates({ ext: 'arw', currentPath: '/a.arw', missingAt: null }, null)).toEqual([]);
  });
});
