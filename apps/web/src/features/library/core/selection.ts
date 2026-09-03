import { type z } from 'zod';

import { librarySelectionScopeSchema } from '@core/contract/index.js';

import type { LibraryFilterState } from './filter-state.js';
import type { LibrarySort } from './folder-groups.js';
import type { LibraryMedia } from './media.js';

export type LibrarySelectionState =
  | { mode: 'items'; fingerprints: Set<string>; anchor: string | null }
  | { mode: 'all-in-filter'; excluded: Set<string> };

export type LibrarySelectionScope = z.output<typeof librarySelectionScopeSchema>;

export type LibrarySelectionAction =
  | { type: 'toggle'; fingerprint: string }
  | { type: 'extendTo'; fingerprint: string; order: readonly string[] }
  | { type: 'selectAllInFilter' }
  | { type: 'clear' }
  | { type: 'removeResolved'; fingerprints: readonly string[] };

export interface SelectionFilterProjection {
  filters: LibraryFilterState;
  query: string;
  media: LibraryMedia;
  hideUnavailable: boolean;
  hidden: 'exclude' | 'only' | 'include';
}

export interface SelectionCountParts {
  items: (count: number) => string;
  allInFilter: (count: number) => string;
}

export const emptyLibrarySelection = (): LibrarySelectionState => ({
  mode: 'items',
  fingerprints: new Set(),
  anchor: null,
});

const selectedRange = (
  anchor: string,
  target: string,
  order: readonly string[],
): string[] => {
  const anchorIndex = order.indexOf(anchor);
  const targetIndex = order.indexOf(target);
  if (anchorIndex === -1 || targetIndex === -1) return [target];
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return order.slice(start, end + 1);
};

export const librarySelectionReducer = (
  state: LibrarySelectionState,
  action: LibrarySelectionAction,
): LibrarySelectionState => {
  switch (action.type) {
    case 'toggle': {
      if (state.mode === 'all-in-filter') return state;
      const fingerprints = new Set(state.fingerprints);
      if (fingerprints.has(action.fingerprint)) {
        fingerprints.delete(action.fingerprint);
      } else {
        fingerprints.add(action.fingerprint);
      }
      if (fingerprints.size === 0) return emptyLibrarySelection();
      return { mode: 'items', fingerprints, anchor: action.fingerprint };
    }
    case 'extendTo': {
      if (state.mode === 'all-in-filter') return state;
      const anchor = state.anchor ?? action.fingerprint;
      return { mode: 'items', fingerprints: new Set(selectedRange(anchor, action.fingerprint, action.order)), anchor };
    }
    case 'selectAllInFilter':
      return { mode: 'all-in-filter', excluded: new Set() };
    case 'clear':
      return emptyLibrarySelection();
    case 'removeResolved': {
      if (state.mode === 'all-in-filter') {
        const excluded = new Set(state.excluded);
        for (const fingerprint of action.fingerprints) excluded.add(fingerprint);
        return { mode: 'all-in-filter', excluded };
      }
      const fingerprints = new Set(state.fingerprints);
      for (const fingerprint of action.fingerprints) fingerprints.delete(fingerprint);
      const anchor = state.anchor !== null && fingerprints.has(state.anchor) ? state.anchor : null;
      return { mode: 'items', fingerprints, anchor };
    }
    default:
      return state;
  }
};

export const selectedFingerprintCount = (
  state: LibrarySelectionState,
  filterTotal: number,
): number => state.mode === 'all-in-filter'
  ? Math.max(0, filterTotal - state.excluded.size)
  : state.fingerprints.size;

export const selectedFingerprints = (state: LibrarySelectionState): string[] =>
  state.mode === 'items' ? [...state.fingerprints] : [];

export const selectionScopeOf = (
  state: LibrarySelectionState,
  projection: SelectionFilterProjection,
): LibrarySelectionScope | null => {
  if (state.mode === 'items') {
    const fingerprints = selectedFingerprints(state);
    if (fingerprints.length === 0) return null;
    return librarySelectionScopeSchema.parse({ kind: 'fingerprints', fingerprints });
  }

  return librarySelectionScopeSchema.parse({
    kind: 'filter',
    filter: {
      ...(projection.query.trim().length > 0 ? { query: projection.query.trim() } : {}),
      tags: projection.filters.tags,
      people: projection.filters.personIds,
      ...(projection.filters.place === null ? {} : { place: projection.filters.place }),
      ...(projection.filters.from === null ? {} : { from: projection.filters.from }),
      ...(projection.filters.to === null ? {} : { to: projection.filters.to }),
      hasGps: projection.filters.hasGps,
      ...(projection.filters.folderId === null ? {} : { folderId: projection.filters.folderId }),
      media: projection.media,
      hideUnavailable: projection.hideUnavailable,
      hidden: projection.hidden,
    },
  });
};

export const selectionCountLabel = (
  state: LibrarySelectionState,
  filterTotal: number,
  parts: SelectionCountParts,
): string => state.mode === 'all-in-filter'
  ? parts.allInFilter(selectedFingerprintCount(state, filterTotal))
  : parts.items(selectedFingerprintCount(state, filterTotal));

export const selectionResetKey = (input: SelectionFilterProjection & { sort: LibrarySort }): string =>
  JSON.stringify({
    filters: input.filters,
    query: input.query,
    media: input.media,
    hideUnavailable: input.hideUnavailable,
    hidden: input.hidden,
    sort: input.sort,
  });
