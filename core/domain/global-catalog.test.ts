import { describe, expect, it } from 'vitest';

import { acceptsGpsWrite, gpsSourceSchema } from './global-catalog.js';

const EMPTY = { lat: null, lon: null, source: null };
const CAMERA = { lat: 1, lon: 1, source: gpsSourceSchema.parse('camera') };
const TIMELINE = { lat: 1, lon: 1, source: gpsSourceSchema.parse('timeline') };
const MANUAL = { lat: 1, lon: 1, source: gpsSourceSchema.parse('manual') };

describe('acceptsGpsWrite', () => {
  it('never accepts a null incoming coordinate, even onto an empty cell', () => {
    expect(acceptsGpsWrite(EMPTY, { lat: null, lon: null, source: 'timeline' })).toBe(false);
    expect(acceptsGpsWrite(CAMERA, { lat: null, lon: null, source: 'camera' })).toBe(false);
  });

  it('accepts any source onto an empty cell', () => {
    for (const source of ['camera', 'timeline', 'manual'] as const) {
      expect(acceptsGpsWrite(EMPTY, { lat: 1, lon: 1, source })).toBe(true);
    }
  });

  it('never lets timeline overwrite camera or manual', () => {
    expect(acceptsGpsWrite(CAMERA, { lat: 2, lon: 2, source: 'timeline' })).toBe(false);
    expect(acceptsGpsWrite(MANUAL, { lat: 2, lon: 2, source: 'timeline' })).toBe(false);
  });

  it('lets a timeline write refresh an existing timeline cell (equal rank)', () => {
    expect(acceptsGpsWrite(TIMELINE, { lat: 2, lon: 2, source: 'timeline' })).toBe(true);
  });

  it('lets camera overwrite a timeline cell but never a manual one', () => {
    expect(acceptsGpsWrite(TIMELINE, { lat: 2, lon: 2, source: 'camera' })).toBe(true);
    expect(acceptsGpsWrite(MANUAL, { lat: 2, lon: 2, source: 'camera' })).toBe(false);
  });

  it('lets manual overwrite anything', () => {
    expect(acceptsGpsWrite(CAMERA, { lat: 2, lon: 2, source: 'manual' })).toBe(true);
    expect(acceptsGpsWrite(TIMELINE, { lat: 2, lon: 2, source: 'manual' })).toBe(true);
  });
});
