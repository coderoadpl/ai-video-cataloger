import { describe, expect, it } from 'vitest';

import { aspectRatioIndicatorKind } from './aspect-ratio-indicator.js';

describe('aspectRatioIndicatorKind', () => {
  it('flags a portrait source, height greater than width', () => {
    expect(aspectRatioIndicatorKind(1080, 1920)).toBe('portrait');
  });

  it('flags an extreme panorama at the 2.4 threshold', () => {
    expect(aspectRatioIndicatorKind(2400, 1000)).toBe('panorama');
  });

  it('flags an extreme panorama above the threshold', () => {
    expect(aspectRatioIndicatorKind(3000, 1000)).toBe('panorama');
  });

  it('shows nothing for plain landscape, just under the panorama threshold', () => {
    expect(aspectRatioIndicatorKind(2399, 1000)).toBeNull();
  });

  it('shows nothing for a 16:9 landscape source', () => {
    expect(aspectRatioIndicatorKind(1920, 1080)).toBeNull();
  });

  it('shows nothing for a square source', () => {
    expect(aspectRatioIndicatorKind(1000, 1000)).toBeNull();
  });

  it('shows nothing when either dimension is unknown', () => {
    expect(aspectRatioIndicatorKind(null, 1920)).toBeNull();
    expect(aspectRatioIndicatorKind(1080, null)).toBeNull();
    expect(aspectRatioIndicatorKind(null, null)).toBeNull();
  });
});
