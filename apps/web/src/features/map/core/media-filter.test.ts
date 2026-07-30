import { describe, expect, it } from 'vitest';

import { countByMedia, filterByMedia, MAP_MEDIA_FILTERS } from './media-filter.js';

const items = [
  { id: 'v1', media: 'video' as const },
  { id: 'v2', media: 'video' as const },
  { id: 'p1', media: 'photo' as const },
];

describe('filterByMedia', () => {
  it('returns every item for "all"', () => {
    expect(filterByMedia(items, 'all').map((item) => item.id)).toEqual(['v1', 'v2', 'p1']);
  });

  it('filters to a single media kind', () => {
    expect(filterByMedia(items, 'video').map((item) => item.id)).toEqual(['v1', 'v2']);
    expect(filterByMedia(items, 'photo').map((item) => item.id)).toEqual(['p1']);
  });

  it('returns a new array, never the original reference', () => {
    expect(filterByMedia(items, 'all')).not.toBe(items);
  });
});

describe('countByMedia', () => {
  it('counts each media kind independently', () => {
    expect(countByMedia(items)).toEqual({ video: 2, photo: 1 });
  });

  it('counts zero for an empty list', () => {
    expect(countByMedia([])).toEqual({ video: 0, photo: 0 });
  });
});

describe('MAP_MEDIA_FILTERS', () => {
  it('lists all three filter values once each', () => {
    expect(MAP_MEDIA_FILTERS).toEqual(['all', 'video', 'photo']);
  });
});
