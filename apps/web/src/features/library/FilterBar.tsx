import { memo, useEffect, useMemo, useState } from 'react';
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
  Tooltip,
} from '@mui/material';

import type { LibraryFacetsOutput } from '@core/client/index.js';

import { MediaFilterToggle } from '../../components/ui/MediaFilterToggle.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { labelWithCount } from '../../lib/format.js';
import { libraryFilterChips, libraryFilterIsEmpty, type LibraryFilterAction, type LibraryFilterChipLabels, type LibraryFilterState } from './core/filter-state.js';
import { isLibrarySort, type LibrarySort } from './core/folder-groups.js';
import type { LibraryMedia } from './core/media.js';

export type LibraryGroupBy = 'date' | 'folder';

export interface LibraryMediaTotals {
  all: number;
  video: number;
  photo: number;
}

const PLACE_DEBOUNCE_MS = 250;

interface FilterBarProps {
  state: LibraryFilterState;
  dispatch: (action: LibraryFilterAction) => void;
  facets: LibraryFacetsOutput;
  chipLabels: LibraryFilterChipLabels;
  groupBy: LibraryGroupBy;
  onGroupByChange: (value: LibraryGroupBy) => void;
  canGroupByFolder: boolean;
  sort: LibrarySort;
  onSortChange: (value: LibrarySort) => void;
  hasQuery: boolean;
  media: LibraryMedia;
  onMediaChange: (value: LibraryMedia) => void;
  mediaTotals: LibraryMediaTotals;
  hideUnavailable: boolean;
  onHideUnavailableChange: (value: boolean) => void;
  hiddenActive: boolean;
  hiddenCount: number;
  onHiddenChange: (value: boolean) => void;
}

const FilterBarView = ({
  state,
  dispatch,
  facets,
  chipLabels,
  groupBy,
  onGroupByChange,
  canGroupByFolder,
  sort,
  onSortChange,
  hasQuery,
  media,
  onMediaChange,
  mediaTotals,
  hideUnavailable,
  onHideUnavailableChange,
  hiddenActive,
  hiddenCount,
  onHiddenChange,
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
  const presets = useMemo(() => [
    { value: String(thisYear), label: dictionary.library.filterDatePresetThisYear },
    { value: String(thisYear - 1), label: dictionary.library.filterDatePresetLastYear },
    ...facets.years
      .filter((year) => year.year !== String(thisYear) && year.year !== String(thisYear - 1))
      .map((year) => ({ value: year.year, label: labelWithCount(year.year, year.count) })),
  ], [facets.years, thisYear, dictionary.library.filterDatePresetThisYear, dictionary.library.filterDatePresetLastYear]);

  const tagOptions = useMemo(() => facets.tags.map((tag) => tag.name), [facets.tags]);
  const tagCounts = useMemo(() => new Map(facets.tags.map((tag) => [tag.name, tag.count])), [facets.tags]);
  const personOptions = useMemo(() => facets.people.map((person) => person.personId), [facets.people]);
  const peopleById = useMemo(
    () => new Map(facets.people.map((person) => [person.personId, person])),
    [facets.people],
  );
  const placeOptions = useMemo(() => facets.places.map((place) => place.name), [facets.places]);
  const placeCounts = useMemo(() => new Map(facets.places.map((place) => [place.name, place.count])), [facets.places]);
  const folderOptions = useMemo(() => facets.folders.map((folder) => folder.folderId), [facets.folders]);
  const foldersById = useMemo(
    () => new Map(facets.folders.map((folder) => [folder.folderId, folder])),
    [facets.folders],
  );
  const personLabel = (personId: string): string => {
    const person = peopleById.get(personId);
    return person?.displayName ?? dictionary.people.personName(person?.fallbackIndex ?? 0);
  };

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
          options={tagOptions}
          getOptionLabel={(tag) => tag}
          renderOption={(props, tag) => {
            const { key, ...optionProps } = props;
            return <li key={key} {...optionProps}>{labelWithCount(tag, tagCounts.get(tag) ?? 0)}</li>;
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
          options={personOptions}
          getOptionLabel={personLabel}
          renderOption={(props, personId) => {
            const { key, ...optionProps } = props;
            return (
              <li key={key} {...optionProps}>
                {labelWithCount(personLabel(personId), peopleById.get(personId)?.count ?? 0)}
              </li>
            );
          }}
          value={state.personIds}
          onChange={(_event, next) => {
            for (const personId of next) {
              if (!state.personIds.includes(personId)) {
                dispatch({ type: 'addPerson', personId, displayName: personLabel(personId) });
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
          options={placeOptions}
          renderOption={(props, name) => {
            const { key, ...optionProps } = props;
            return <li key={key} {...optionProps}>{labelWithCount(name, placeCounts.get(name) ?? 0)}</li>;
          }}
          inputValue={placeInput}
          onInputChange={(_event, next) => setPlaceInput(next)}
          renderInput={(params) => <TextField {...params} label={dictionary.library.filterPlace} data-testid="library-filter-place" />}
        />
        <Autocomplete
          size="small"
          sx={{ minWidth: 200 }}
          options={folderOptions}
          getOptionLabel={(folderId) => foldersById.get(folderId)?.displayName ?? folderId}
          renderOption={(props, folderId) => {
            const { key, ...optionProps } = props;
            const folder = foldersById.get(folderId);
            return <li key={key} {...optionProps}>{labelWithCount(folder?.displayName ?? folderId, folder?.count ?? 0)}</li>;
          }}
          value={state.folderId}
          onChange={(_event, next) => {
            const folder = next === null ? null : foldersById.get(next);
            dispatch({ type: 'setFolder', folderId: next, displayName: folder?.displayName ?? next });
          }}
          renderInput={(params) => <TextField {...params} label={dictionary.library.filterFolder} data-testid="library-filter-folder" />}
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
        <Tooltip title={dictionary.library.hideUnavailableTooltip}>
          <ToggleButton
            size="small"
            value="hideUnavailable"
            selected={hideUnavailable}
            onChange={() => onHideUnavailableChange(!hideUnavailable)}
            data-testid="library-hide-unavailable"
          >
            {dictionary.library.hideUnavailable}
          </ToggleButton>
        </Tooltip>
        <ToggleButton
          size="small"
          value="hidden"
          selected={hiddenActive}
          onChange={() => onHiddenChange(!hiddenActive)}
          data-testid="library-hidden-filter"
        >
          {labelWithCount(dictionary.library.hiddenFilter, hiddenCount)}
        </ToggleButton>
        <MediaFilterToggle
          value={media}
          counts={mediaTotals}
          onChange={onMediaChange}
          groupTestId="library-media-filter"
          optionTestIdPrefix="library-media"
        />
        <ToggleButtonGroup
          size="small"
          exclusive
          value={groupBy}
          onChange={(_event, next: LibraryGroupBy | null) => { if (next !== null) onGroupByChange(next); }}
          data-testid="library-group-by"
        >
          <ToggleButton value="date" data-testid="library-group-by-date">{dictionary.library.groupByDate}</ToggleButton>
          <Tooltip title={canGroupByFolder ? '' : dictionary.library.groupByFolderUnavailableTooltip}>
            <span>
              <ToggleButton value="folder" data-testid="library-group-by-folder" disabled={!canGroupByFolder}>
                {dictionary.library.groupByFolder}
              </ToggleButton>
            </span>
          </Tooltip>
        </ToggleButtonGroup>
        <Tooltip title={hasQuery && media === 'all' ? dictionary.library.sortRelevanceUnavailableTooltip : ''}>
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
            {hasQuery && media !== 'all' ? <MenuItem value="relevance">{dictionary.library.sortRelevance}</MenuItem> : null}
          </TextField>
        </Tooltip>
      </Stack>
    </Stack>
  );
};

export const FilterBar = memo(FilterBarView);
