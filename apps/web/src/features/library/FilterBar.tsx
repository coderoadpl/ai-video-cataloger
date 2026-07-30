import { useEffect, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';

import type { LibraryFacetsOutput } from '@core/client/index.js';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { libraryFilterChips, libraryFilterIsEmpty, type LibraryFilterAction, type LibraryFilterChipLabels, type LibraryFilterState } from './core/filter-state.js';
import { isLibrarySort, type LibrarySort } from './core/folder-groups.js';

export type LibraryGroupBy = 'date' | 'folder';

const PLACE_DEBOUNCE_MS = 250;

interface FilterBarProps {
  state: LibraryFilterState;
  dispatch: (action: LibraryFilterAction) => void;
  facets: LibraryFacetsOutput;
  chipLabels: LibraryFilterChipLabels;
  groupBy: LibraryGroupBy;
  onGroupByChange: (value: LibraryGroupBy) => void;
  sort: LibrarySort;
  onSortChange: (value: LibrarySort) => void;
  hasQuery: boolean;
}

const withCount = (label: string, count: number): string => `${label} (${String(count)})`;

export const FilterBar = ({
  state,
  dispatch,
  facets,
  chipLabels,
  groupBy,
  onGroupByChange,
  sort,
  onSortChange,
  hasQuery,
}: FilterBarProps) => {
  const dictionary = useDictionary();
  const [placeInput, setPlaceInput] = useState(state.place ?? '');
  const [preset, setPreset] = useState('');

  useEffect(() => {
    if (placeInput === (state.place ?? '')) return undefined;
    const handle = window.setTimeout(
      () => dispatch({ type: 'setPlace', place: placeInput.trim().length === 0 ? null : placeInput }),
      PLACE_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(handle);
  }, [placeInput, state.place, dispatch]);

  useEffect(() => {
    if (state.place === null) setPlaceInput('');
  }, [state.place]);

  const chips = libraryFilterChips(state, chipLabels);
  const thisYear = new Date().getFullYear();
  const presets = [
    { value: String(thisYear), label: dictionary.library.filterDatePresetThisYear },
    { value: String(thisYear - 1), label: dictionary.library.filterDatePresetLastYear },
    ...facets.years
      .filter((year) => year.year !== String(thisYear) && year.year !== String(thisYear - 1))
      .map((year) => ({ value: year.year, label: withCount(year.year, year.count) })),
  ];

  const applyPreset = (year: string) => {
    setPreset(year);
    if (year.length === 0) {
      dispatch({ type: 'setDateRange', from: null, to: null });
      return;
    }
    dispatch({ type: 'setDateRange', from: `${year}-01-01`, to: `${year}-12-31` });
  };

  return (
    <Stack spacing={1} data-testid="library-filter-bar">
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', rowGap: 1.75 }}>
        <Autocomplete
          multiple
          size="small"
          sx={{ minWidth: 200 }}
          options={facets.tags.map((tag) => tag.name)}
          getOptionLabel={(tag) => tag}
          renderOption={(props, tag) => {
            const { key, ...optionProps } = props;
            const count = facets.tags.find((facet) => facet.name === tag)?.count ?? 0;
            return <li key={key} {...optionProps}>{withCount(tag, count)}</li>;
          }}
          value={state.tags}
          onChange={(_event, next) => {
            for (const tag of next) if (!state.tags.includes(tag)) dispatch({ type: 'addTag', tag });
            for (const tag of state.tags) if (!next.includes(tag)) dispatch({ type: 'removeTag', tag });
          }}
          renderInput={(params) => <TextField {...params} label={dictionary.library.filterTags} data-testid="library-filter-tags" />}
        />
        <Autocomplete
          multiple
          size="small"
          sx={{ minWidth: 200 }}
          options={facets.people.map((person) => person.personId)}
          getOptionLabel={(personId) => facets.people.find((person) => person.personId === personId)?.displayName ?? personId}
          renderOption={(props, personId) => {
            const { key, ...optionProps } = props;
            const person = facets.people.find((candidate) => candidate.personId === personId);
            return <li key={key} {...optionProps}>{withCount(person?.displayName ?? personId, person?.count ?? 0)}</li>;
          }}
          value={state.personIds}
          onChange={(_event, next) => {
            for (const personId of next) {
              if (!state.personIds.includes(personId)) {
                const displayName = facets.people.find((person) => person.personId === personId)?.displayName ?? personId;
                dispatch({ type: 'addPerson', personId, displayName });
              }
            }
            for (const personId of state.personIds) if (!next.includes(personId)) dispatch({ type: 'removePerson', personId });
          }}
          renderInput={(params) => <TextField {...params} label={dictionary.library.filterPeople} data-testid="library-filter-people" />}
        />
        <Autocomplete
          freeSolo
          size="small"
          sx={{ minWidth: 200 }}
          options={facets.places.map((place) => place.name)}
          renderOption={(props, name) => {
            const { key, ...optionProps } = props;
            const count = facets.places.find((place) => place.name === name)?.count ?? 0;
            return <li key={key} {...optionProps}>{withCount(name, count)}</li>;
          }}
          inputValue={placeInput}
          onInputChange={(_event, next) => setPlaceInput(next)}
          renderInput={(params) => <TextField {...params} label={dictionary.library.filterPlace} data-testid="library-filter-place" />}
        />
        <TextField
          size="small"
          type="date"
          label={dictionary.library.filterFrom}
          value={state.from ?? ''}
          onChange={(event) => dispatch({ type: 'setDateRange', from: event.target.value.length === 0 ? null : event.target.value, to: state.to })}
          slotProps={{ inputLabel: { shrink: true } }}
          data-testid="library-filter-from"
        />
        <TextField
          size="small"
          type="date"
          label={dictionary.library.filterTo}
          value={state.to ?? ''}
          onChange={(event) => dispatch({ type: 'setDateRange', from: state.from, to: event.target.value.length === 0 ? null : event.target.value })}
          slotProps={{ inputLabel: { shrink: true } }}
          data-testid="library-filter-to"
        />
        <TextField
          size="small"
          select
          label={dictionary.library.filterDatePreset}
          value={presets.some((entry) => entry.value === preset) ? preset : ''}
          onChange={(event) => applyPreset(event.target.value)}
          data-testid="library-filter-date-preset"
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="">{dictionary.library.filterDatePresetAny}</MenuItem>
          {presets.map((entry) => (
            <MenuItem key={entry.value} value={entry.value}>{entry.label}</MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          select
          label={dictionary.library.filterHasGps}
          value={state.hasGps === null ? 'any' : state.hasGps ? 'with' : 'without'}
          onChange={(event) => {
            const value = event.target.value;
            dispatch({ type: 'setHasGps', hasGps: value === 'any' ? null : value === 'with' });
          }}
          data-testid="library-filter-has-gps"
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="any">{dictionary.library.filterHasGpsAny}</MenuItem>
          <MenuItem value="with">{dictionary.library.filterHasGpsWith}</MenuItem>
          <MenuItem value="without">{dictionary.library.filterHasGpsWithout}</MenuItem>
        </TextField>
      </Stack>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        {chips.map((chip) => (
          <Chip
            key={chip.id}
            label={chip.label}
            size="small"
            data-testid={`library-chip-${chip.id}`}
            onDelete={() => {
              if (chip.id === 'date') setPreset('');
              dispatch(chip.remove);
            }}
          />
        ))}
        {libraryFilterIsEmpty(state) ? null : (
          <Button size="small" onClick={() => { setPreset(''); dispatch({ type: 'clearAll' }); }} data-testid="library-filter-clear-all">
            {dictionary.library.filterClearAll}
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        <ToggleButtonGroup
          size="small"
          exclusive
          value={groupBy}
          onChange={(_event, next: LibraryGroupBy | null) => { if (next !== null) onGroupByChange(next); }}
          data-testid="library-group-by"
        >
          <ToggleButton value="date" data-testid="library-group-by-date">{dictionary.library.groupByDate}</ToggleButton>
          <ToggleButton value="folder" data-testid="library-group-by-folder">{dictionary.library.groupByFolder}</ToggleButton>
        </ToggleButtonGroup>
        <TextField
          size="small"
          select
          label={dictionary.library.sortLabel}
          value={sort}
          onChange={(event) => { if (isLibrarySort(event.target.value)) onSortChange(event.target.value); }}
          data-testid="library-sort"
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="captured_desc">{dictionary.library.sortCapturedDesc}</MenuItem>
          <MenuItem value="captured_asc">{dictionary.library.sortCapturedAsc}</MenuItem>
          <MenuItem value="name_asc">{dictionary.library.sortNameAsc}</MenuItem>
          {hasQuery ? <MenuItem value="relevance">{dictionary.library.sortRelevance}</MenuItem> : null}
        </TextField>
      </Stack>
    </Stack>
  );
};
