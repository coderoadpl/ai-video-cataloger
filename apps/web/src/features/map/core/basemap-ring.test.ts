import { describe, expect, it } from 'vitest';

import { unwrapRing } from './basemap-ring.js';

const maxLongitudeStep = (ring: readonly (readonly number[])[]): number => {
  let largest = 0;
  for (let index = 1; index < ring.length; index += 1) {
    const step = Math.abs((ring[index]?.[0] ?? 0) - (ring[index - 1]?.[0] ?? 0));
    if (step > largest) largest = step;
  }
  return largest;
};

describe('unwrapRing', () => {
  it('removes the antimeridian jump that would smear a ring across the whole map', () => {
    const crossing = [[179, -16], [180, -16], [-179.5, -16.5], [-179, -17], [179.5, -17]];

    expect(maxLongitudeStep(crossing)).toBeGreaterThan(180);
    expect(maxLongitudeStep(unwrapRing(crossing))).toBeLessThanOrEqual(180);
  });

  it('carries the unwrapped longitudes past the antimeridian instead of dropping points', () => {
    expect(unwrapRing([[179, 10], [-179, 10]])).toEqual([[179, 10], [181, 10]]);
  });

  it('leaves a ring that never crosses the antimeridian untouched', () => {
    const ring = [[10, 50], [11, 51], [12, 50]];

    expect(unwrapRing(ring)).toEqual(ring);
  });
});
