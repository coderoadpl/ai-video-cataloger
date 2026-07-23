import { describe, expect, it } from 'vitest';

import { displayAspectRatio, thumbnailBoxForSource } from './thumbnail-aspect.js';

describe('thumbnail aspect helpers', () => {
  it('uses landscape source dimensions', () => {
    expect(thumbnailBoxForSource({ width: 1920, height: 1080, rotation: 0 }, 64)).toEqual({ width: 64, height: 36 });
  });

  it('uses portrait display dimensions after rotation metadata', () => {
    expect(displayAspectRatio({ width: 1920, height: 1080, rotation: 90 })).toBeCloseTo(1080 / 1920);
    expect(thumbnailBoxForSource({ width: 1920, height: 1080, rotation: 90 }, 64)).toEqual({ width: 64, height: 64 });
  });

  it('clamps extreme landscape and portrait sources into a stable box', () => {
    expect(thumbnailBoxForSource({ width: 8000, height: 1000, rotation: 0 }, 64)).toEqual({ width: 64, height: 29 });
    expect(thumbnailBoxForSource({ width: 1000, height: 8000, rotation: 0 }, 64)).toEqual({ width: 64, height: 64 });
  });
});
