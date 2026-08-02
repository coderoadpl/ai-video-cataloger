import { describe, expect, it } from 'vitest';

import { followRenamedKey } from './rename-follow.js';

describe('followRenamedKey', () => {
  it('returns the new path when the old path is missing and the same contentHash appears elsewhere', () => {
    const previous = { path: '/videos/old.mp4', contentHash: 'hash-1' };
    const fresh = [
      { path: '/videos/renamed.mp4', contentHash: 'hash-1' },
      { path: '/videos/other.mp4', contentHash: 'hash-2' },
    ];

    expect(followRenamedKey(previous, fresh)).toBe('/videos/renamed.mp4');
  });

  it('returns the old path unchanged when no fresh video shares the contentHash', () => {
    const previous = { path: '/videos/old.mp4', contentHash: 'hash-1' };
    const fresh = [{ path: '/videos/other.mp4', contentHash: 'hash-2' }];

    expect(followRenamedKey(previous, fresh)).toBe('/videos/old.mp4');
  });

  it('returns the old path unchanged when it is still present in the fresh list', () => {
    const previous = { path: '/videos/old.mp4', contentHash: 'hash-1' };
    const fresh = [{ path: '/videos/old.mp4', contentHash: 'hash-1' }];

    expect(followRenamedKey(previous, fresh)).toBe('/videos/old.mp4');
  });

  it('returns the old path unchanged when the previous video has no contentHash to match by', () => {
    const previous = { path: '/videos/old.mp4', contentHash: null };
    const fresh = [{ path: '/videos/renamed.mp4', contentHash: null }];

    expect(followRenamedKey(previous, fresh)).toBe('/videos/old.mp4');
  });

  it('returns null when there is no previous selection', () => {
    expect(followRenamedKey(null, [{ path: '/videos/a.mp4', contentHash: 'hash-1' }])).toBe(null);
  });
});
