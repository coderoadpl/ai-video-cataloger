import { describe, expect, it } from 'vitest';

import { photoBadges, type PhotoBadgeInput } from './sidebar-badges.js';

const item = (overrides: Partial<PhotoBadgeInput> = {}): PhotoBadgeInput => ({
  analysed: false,
  sightings: 1,
  proxyState: 'done',
  exifReadAt: '2026-01-01T00:00:00.000Z',
  missingAt: null,
  ...overrides,
});

describe('photoBadges', () => {
  it('returns no badges for an all-clear item', () => {
    expect(photoBadges(item())).toEqual([]);
  });

  it('flags analyzed', () => {
    expect(photoBadges(item({ analysed: true }))).toEqual(['analysed']);
  });

  it('flags duplicate when sighted more than once', () => {
    expect(photoBadges(item({ sightings: 2 }))).toEqual(['duplicate']);
  });

  it('flags proxyFailed', () => {
    expect(photoBadges(item({ proxyState: 'failed' }))).toEqual(['proxyFailed']);
  });

  it('flags exifMissing when exifReadAt is null', () => {
    expect(photoBadges(item({ exifReadAt: null }))).toEqual(['exifMissing']);
  });

  it('flags missing when missingAt is set', () => {
    expect(photoBadges(item({ missingAt: 1234 }))).toEqual(['missing']);
  });

  it('renders every applicable badge in a fixed order', () => {
    expect(photoBadges(item({
      analysed: true,
      sightings: 3,
      proxyState: 'failed',
      exifReadAt: null,
      missingAt: 999,
    }))).toEqual(['analysed', 'duplicate', 'proxyFailed', 'exifMissing', 'missing']);
  });
});
