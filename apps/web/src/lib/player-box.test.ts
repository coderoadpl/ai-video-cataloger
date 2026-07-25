import { describe, expect, it } from 'vitest';

import { playerBoxForSource } from './player-box.js';

describe('player box helper', () => {
  it('lets landscape sources fill the available width', () => {
    const box = playerBoxForSource({ width: 1920, height: 1080, rotation: 0 }, 520);
    expect(box.aspectRatio).toBeCloseTo(16 / 9);
    expect(box.maxWidthPx).toBeNull();
    expect(box.maxHeightPx).toBe(520);
  });

  it('bounds portrait sources by height so they keep true aspect', () => {
    const box = playerBoxForSource({ width: 720, height: 1280, rotation: 0 }, 520);
    expect(box.aspectRatio).toBeCloseTo(720 / 1280);
    expect(box.maxWidthPx).toBe(Math.round(520 * (720 / 1280)));
  });

  it('treats a rotated landscape source as portrait', () => {
    const box = playerBoxForSource({ width: 1920, height: 1080, rotation: 90 }, 520);
    expect(box.aspectRatio).toBeCloseTo(1080 / 1920);
    expect(box.maxWidthPx).toBe(Math.round(520 * (1080 / 1920)));
  });

  it('falls back to a 16:9 landscape box when dimensions are unknown', () => {
    const box = playerBoxForSource(undefined, 520);
    expect(box.aspectRatio).toBeCloseTo(16 / 9);
    expect(box.maxWidthPx).toBeNull();
  });
});
