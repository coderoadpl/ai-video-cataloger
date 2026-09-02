import { describe, expect, it } from 'vitest';

import {
  EMPTY_LIBRARY_FILTERS,
  type LibraryFilterChipLabels,
  libraryFilterReducer,
  videoOnlyFilterChips,
} from './filter-state.js';

const labels: LibraryFilterChipLabels = {
  hasGps: 'with GPS',
  noGps: 'without GPS',
  folder: (displayName) => `Folder: ${displayName}`,
  dateRange: (from, to) => `${from} – ${to}`,
  dateFrom: (from) => `from ${from}`,
  dateTo: (to) => `until ${to}`,
};

describe('videoOnlyFilterChips', () => {
  it('no longer reports a person filter as video-only', () => {
    const withPerson = libraryFilterReducer(EMPTY_LIBRARY_FILTERS, { type: 'addPerson', personId: 'p-1', displayName: 'Ada' });
    expect(videoOnlyFilterChips(withPerson, labels)).toEqual([]);
  });

  it('still reports place and GPS filters as video-only', () => {
    const withPlace = libraryFilterReducer(EMPTY_LIBRARY_FILTERS, { type: 'setPlace', place: 'Zakopane' });
    const withGps = libraryFilterReducer(withPlace, { type: 'setHasGps', hasGps: true });
    expect(videoOnlyFilterChips(withGps, labels).map((chip) => chip.id)).toEqual(['place', 'hasGps']);
  });
});
