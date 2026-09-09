import { describe, expect, it } from 'vitest';

import { pairReviewBadge } from './pair-review-badge.js';

describe('pairReviewBadge', () => {
  it('keeps the true pending count while it fits in the reviewable queue', () => {
    expect(pairReviewBadge(0, 200)).toEqual({ count: 0, truncated: false });
    expect(pairReviewBadge(37, 200)).toEqual({ count: 37, truncated: false });
    expect(pairReviewBadge(200, 200)).toEqual({ count: 200, truncated: false });
  });

  it('caps the badge at the queue limit once more pairs are pending than the review serves', () => {
    expect(pairReviewBadge(201, 200)).toEqual({ count: 200, truncated: true });
    expect(pairReviewBadge(12_345, 200)).toEqual({ count: 200, truncated: true });
  });
});
