import { describe, expect, it } from 'vitest';

import {
  EMPTY_LIBRARY_FILTERS,
  type LibraryFilterChipLabels,
  libraryFilterChips,
  libraryFilterIsEmpty,
  libraryFilterReducer,
  noMatchSentence,
  toSearchParams,
} from './filter-state.js';

describe('libraryFilterReducer', () => {
  it('adds and removes a tag without duplicating it', () => {
    const withTag = libraryFilterReducer(EMPTY_LIBRARY_FILTERS, { type: 'addTag', tag: 'beach' });
    const withTagAgain = libraryFilterReducer(withTag, { type: 'addTag', tag: 'beach' });
    expect(withTagAgain.tags).toEqual(['beach']);

    const removed = libraryFilterReducer(withTagAgain, { type: 'removeTag', tag: 'beach' });
    expect(removed.tags).toEqual([]);
  });

  it('tracks a person label alongside its id and forgets it on removal', () => {
    const withPerson = libraryFilterReducer(EMPTY_LIBRARY_FILTERS, { type: 'addPerson', personId: 'p-1', displayName: 'Ada' });
    expect(withPerson.personIds).toEqual(['p-1']);
    expect(withPerson.personLabels).toEqual({ 'p-1': 'Ada' });

    const removed = libraryFilterReducer(withPerson, { type: 'removePerson', personId: 'p-1' });
    expect(removed.personIds).toEqual([]);
    expect(removed.personLabels).toEqual({});
  });

  it('sets and clears a folder with its display label', () => {
    const withFolder = libraryFilterReducer(EMPTY_LIBRARY_FILTERS, { type: 'setFolder', folderId: 'path-abc', displayName: 'Vacation' });
    expect(withFolder.folderId).toBe('path-abc');
    expect(withFolder.folderLabel).toBe('Vacation');

    const cleared = libraryFilterReducer(withFolder, { type: 'setFolder', folderId: null, displayName: null });
    expect(cleared.folderId).toBeNull();
    expect(cleared.folderLabel).toBeNull();
  });

  it('resets everything on clearAll', () => {
    const dirty = libraryFilterReducer(EMPTY_LIBRARY_FILTERS, { type: 'setHasGps', hasGps: true });
    const cleared = libraryFilterReducer(dirty, { type: 'clearAll' });
    expect(cleared).toEqual(EMPTY_LIBRARY_FILTERS);
  });
});

const labels: LibraryFilterChipLabels = {
  hasGps: 'with GPS',
  noGps: 'without GPS',
  folder: (displayName) => `Folder: ${displayName}`,
  dateRange: (from, to) => `${from} – ${to}`,
  dateFrom: (from) => `from ${from}`,
  dateTo: (to) => `until ${to}`,
};

describe('libraryFilterChips', () => {
  it('projects every active filter into a removable chip', () => {
    const state = libraryFilterReducer(
      libraryFilterReducer(EMPTY_LIBRARY_FILTERS, { type: 'addTag', tag: 'beach' }),
      { type: 'setHasGps', hasGps: true },
    );
    const chips = libraryFilterChips(state, labels);
    expect(chips.map((chip) => chip.id)).toEqual(['tag:beach', 'hasGps']);
  });

  it('labels the gps, date-range and folder chips from the supplied dictionary parts, never a hardcoded English string', () => {
    const state = libraryFilterReducer(
      libraryFilterReducer(
        libraryFilterReducer(EMPTY_LIBRARY_FILTERS, { type: 'setHasGps', hasGps: false }),
        { type: 'setDateRange', from: '2019-01-01', to: '2019-12-31' },
      ),
      { type: 'setFolder', folderId: 'path-abc', displayName: 'Vacation' },
    );

    expect(libraryFilterChips(state, labels).map((chip) => chip.label))
      .toEqual(['2019-01-01 – 2019-12-31', 'without GPS', 'Folder: Vacation']);
  });

  it('renders no chips for the empty state', () => {
    expect(libraryFilterChips(EMPTY_LIBRARY_FILTERS, labels)).toEqual([]);
    expect(libraryFilterIsEmpty(EMPTY_LIBRARY_FILTERS)).toBe(true);
  });
});

describe('toSearchParams', () => {
  it('maps filter state onto the searchQuery contract fields', () => {
    const state = libraryFilterReducer(EMPTY_LIBRARY_FILTERS, { type: 'addPerson', personId: 'p-1', displayName: 'Ada' });
    expect(toSearchParams(state)).toEqual({
      tags: [],
      people: ['p-1'],
      place: null,
      from: null,
      to: null,
      hasGps: null,
      folderId: null,
    });
  });
});

describe('noMatchSentence', () => {
  it('names every active chip and the text query', () => {
    const state = libraryFilterReducer(EMPTY_LIBRARY_FILTERS, { type: 'addTag', tag: 'beach' });
    const sentence = noMatchSentence(state, 'sunset', labels, (parts) => `No files match ${parts.join(', ')}`, 'No results');
    expect(sentence).toBe('No files match "sunset", #beach');
  });

  it('falls back to the generic body when nothing is active', () => {
    expect(noMatchSentence(EMPTY_LIBRARY_FILTERS, '', labels, () => 'unused', 'No results')).toBe('No results');
  });
});
