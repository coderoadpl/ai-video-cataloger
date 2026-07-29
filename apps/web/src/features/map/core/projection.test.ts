import { describe, expect, it } from 'vitest';

import {
  MAX_MERCATOR_LAT,
  MAX_SCALE,
  MIN_SCALE,
  fitViewport,
  panViewport,
  project,
  toScreen,
  unitBounds,
  unproject,
  zoomViewport,
} from './projection.js';

describe('project', () => {
  it('maps the origin to the center of the unit square', () => {
    expect(project({ lon: 0, lat: 0 })).toEqual({ x: 0.5, y: 0.5 });
  });

  it('clamps latitude beyond the mercator limit', () => {
    const clamped = project({ lon: 0, lat: MAX_MERCATOR_LAT });
    const overshot = project({ lon: 0, lat: 86 });
    expect(overshot.y).toBeCloseTo(clamped.y, 9);
  });
});

describe('unproject', () => {
  it('round-trips project for a table of points', () => {
    const points = [
      { lon: 0, lat: 0 },
      { lon: 179, lat: 45 },
      { lon: -179, lat: -45 },
      { lon: 19.9366, lat: 50.0614 },
      { lon: -122.4194, lat: 37.7749 },
      { lon: 100, lat: -60 },
    ];
    for (const point of points) {
      const roundTripped = unproject(project(point));
      expect(roundTripped.lon).toBeCloseTo(point.lon, 6);
      expect(roundTripped.lat).toBeCloseTo(point.lat, 6);
    }
  });
});

describe('fitViewport', () => {
  it('returns the whole world for an empty list', () => {
    const viewport = fitViewport(null, 800, 600, 40);
    expect(viewport).toEqual({ width: 800, height: 600, scale: MIN_SCALE, centerX: 0.5, centerY: 0.5 });
  });

  it('caps the scale at 64 for a single point', () => {
    const bounds = unitBounds([project({ lon: 10, lat: 10 })]);
    const viewport = fitViewport(bounds, 800, 600, 40);
    expect(viewport.scale).toBe(64);
  });
});

describe('zoomViewport', () => {
  it('respects the scale bounds', () => {
    const viewport = { width: 800, height: 600, scale: MIN_SCALE, centerX: 0.5, centerY: 0.5 };
    expect(zoomViewport(viewport, 0.001).scale).toBe(MIN_SCALE);
    expect(zoomViewport(viewport, 1_000_000).scale).toBe(MAX_SCALE);
  });

  it('keeps the anchor pixel fixed across a zoom', () => {
    const viewport = { width: 800, height: 600, scale: 4, centerX: 0.5, centerY: 0.5 };
    const anchor = { x: 0.6, y: 0.4 };
    const before = toScreen(anchor, viewport);
    const zoomed = zoomViewport(viewport, 2, anchor);
    const after = toScreen(anchor, zoomed);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});

describe('panViewport', () => {
  it('cannot push the world fully off-canvas', () => {
    const viewport = { width: 800, height: 600, scale: MIN_SCALE, centerX: 0.5, centerY: 0.5 };
    const panned = panViewport(viewport, -100_000, -100_000);
    expect(panned.centerX).toBeGreaterThanOrEqual(0);
    expect(panned.centerX).toBeLessThanOrEqual(1);
    expect(panned.centerY).toBeGreaterThanOrEqual(0);
    expect(panned.centerY).toBeLessThanOrEqual(1);
  });
});
