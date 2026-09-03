import { describe, expect, it } from 'vitest';

import { EMPTY_LIBRARY_FILTERS } from './filter-state.js';
import {
  emptyLibrarySelection,
  librarySelectionReducer,
  selectedFingerprintCount,
  selectionCountLabel,
  selectionResetKey,
  selectionScopeOf,
} from './selection.js';

describe('librarySelectionReducer', () => {
  it('toggles a fingerprint idempotently', () => {
    const selected = librarySelectionReducer(emptyLibrarySelection(), { type: 'toggle', fingerprint: 'fp-1' });
    const cleared = librarySelectionReducer(selected, { type: 'toggle', fingerprint: 'fp-1' });

    expect(selectedFingerprintCount(selected, 10)).toBe(1);
    expect(selectedFingerprintCount(cleared, 10)).toBe(0);
  });

  it('extends a range across rendered sections', () => {
    const anchored = librarySelectionReducer(emptyLibrarySelection(), { type: 'toggle', fingerprint: 'a' });
    const ranged = librarySelectionReducer(anchored, { type: 'extendTo', fingerprint: 'd', order: ['a', 'b', 'c', 'd'] });

    expect(selectionScopeOf(ranged, projection())?.kind).toBe('fingerprints');
    expect(selectedFingerprintCount(ranged, 10)).toBe(4);
  });

  it('extends a range backwards from the anchor', () => {
    const anchored = librarySelectionReducer(emptyLibrarySelection(), { type: 'toggle', fingerprint: 'd' });
    const ranged = librarySelectionReducer(anchored, { type: 'extendTo', fingerprint: 'b', order: ['a', 'b', 'c', 'd'] });

    expect(selectedFingerprintCount(ranged, 10)).toBe(3);
  });

  it('uses the full filter total for select-all-in-filter', () => {
    const state = librarySelectionReducer(emptyLibrarySelection(), { type: 'selectAllInFilter' });
    const scope = selectionScopeOf(state, projection({ query: 'lake', hidden: 'only' }));

    expect(selectedFingerprintCount(state, 125)).toBe(125);
    expect(selectionCountLabel(state, 125, { items: (count) => `${String(count)} items`, allInFilter: (count) => `${String(count)} all` })).toBe('125 all');
    expect(scope).toMatchObject({ kind: 'filter', filter: { query: 'lake', hidden: 'only' } });
  });

  it('keeps select-all-in-filter as a whole-filter scope when a rendered tile is clicked again', () => {
    const state = librarySelectionReducer(emptyLibrarySelection(), { type: 'selectAllInFilter' });
    const clicked = librarySelectionReducer(state, { type: 'toggle', fingerprint: 'fp-1' });
    const scope = selectionScopeOf(clicked, projection({ query: 'lake' }));

    expect(selectedFingerprintCount(clicked, 12)).toBe(12);
    expect(scope).toMatchObject({ kind: 'filter', filter: { query: 'lake' } });
  });

  it('changes the reset key when the current filter changes', () => {
    const before = selectionResetKey({ ...projection(), sort: 'captured_desc' });
    const after = selectionResetKey({
      ...projection({ filters: { ...EMPTY_LIBRARY_FILTERS, tags: ['travel'] } }),
      sort: 'captured_desc',
    });

    expect(after).not.toBe(before);
  });
});

const projection = (overrides: Partial<Parameters<typeof selectionScopeOf>[1]> = {}): Parameters<typeof selectionScopeOf>[1] => ({
  filters: EMPTY_LIBRARY_FILTERS,
  query: '',
  media: 'all',
  hideUnavailable: false,
  hidden: 'exclude',
  ...overrides,
});
