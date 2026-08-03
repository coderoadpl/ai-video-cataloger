export interface LibraryFilterState {
  tags: string[];
  personIds: string[];
  personLabels: Record<string, string>;
  place: string | null;
  from: string | null;
  to: string | null;
  hasGps: boolean | null;
  folderId: string | null;
  folderLabel: string | null;
}

export const EMPTY_LIBRARY_FILTERS: LibraryFilterState = {
  tags: [],
  personIds: [],
  personLabels: {},
  place: null,
  from: null,
  to: null,
  hasGps: null,
  folderId: null,
  folderLabel: null,
};

export type LibraryFilterAction =
  | { type: 'addTag'; tag: string }
  | { type: 'removeTag'; tag: string }
  | { type: 'addPerson'; personId: string; displayName: string }
  | { type: 'removePerson'; personId: string }
  | { type: 'setPlace'; place: string | null }
  | { type: 'setDateRange'; from: string | null; to: string | null }
  | { type: 'setHasGps'; hasGps: boolean | null }
  | { type: 'setFolder'; folderId: string | null; displayName: string | null }
  | { type: 'clearAll' };

export const libraryFilterReducer = (state: LibraryFilterState, action: LibraryFilterAction): LibraryFilterState => {
  switch (action.type) {
    case 'addTag':
      return state.tags.includes(action.tag) ? state : { ...state, tags: [...state.tags, action.tag] };
    case 'removeTag':
      return { ...state, tags: state.tags.filter((tag) => tag !== action.tag) };
    case 'addPerson':
      return state.personIds.includes(action.personId) ? state : {
        ...state,
        personIds: [...state.personIds, action.personId],
        personLabels: { ...state.personLabels, [action.personId]: action.displayName },
      };
    case 'removePerson': {
      const personLabels = Object.fromEntries(
        Object.entries(state.personLabels).filter(([personId]) => personId !== action.personId),
      );
      return { ...state, personIds: state.personIds.filter((personId) => personId !== action.personId), personLabels };
    }
    case 'setPlace':
      return { ...state, place: action.place };
    case 'setDateRange':
      return { ...state, from: action.from, to: action.to };
    case 'setHasGps':
      return { ...state, hasGps: action.hasGps };
    case 'setFolder':
      return { ...state, folderId: action.folderId, folderLabel: action.folderId === null ? null : action.displayName };
    case 'clearAll':
      return EMPTY_LIBRARY_FILTERS;
    default:
      return state;
  }
};

export interface LibraryFilterChip {
  id: string;
  label: string;
  remove: LibraryFilterAction;
}

export interface LibraryFilterChipLabels {
  hasGps: string;
  noGps: string;
  folder: (displayName: string) => string;
  dateRange: (from: string, to: string) => string;
  dateFrom: (from: string) => string;
  dateTo: (to: string) => string;
}

const dateChipLabel = (from: string | null, to: string | null, labels: LibraryFilterChipLabels): string => {
  if (from !== null && to !== null) return labels.dateRange(from, to);
  if (from !== null) return labels.dateFrom(from);
  return labels.dateTo(to ?? '');
};

export const libraryFilterChips = (state: LibraryFilterState, labels: LibraryFilterChipLabels): LibraryFilterChip[] => {
  const chips: LibraryFilterChip[] = [];
  for (const tag of state.tags) {
    chips.push({ id: `tag:${tag}`, label: `#${tag}`, remove: { type: 'removeTag', tag } });
  }
  for (const personId of state.personIds) {
    chips.push({
      id: `person:${personId}`,
      label: state.personLabels[personId] ?? personId,
      remove: { type: 'removePerson', personId },
    });
  }
  if (state.place !== null) {
    chips.push({ id: 'place', label: state.place, remove: { type: 'setPlace', place: null } });
  }
  if (state.from !== null || state.to !== null) {
    chips.push({
      id: 'date',
      label: dateChipLabel(state.from, state.to, labels),
      remove: { type: 'setDateRange', from: null, to: null },
    });
  }
  if (state.hasGps !== null) {
    chips.push({
      id: 'hasGps',
      label: state.hasGps ? labels.hasGps : labels.noGps,
      remove: { type: 'setHasGps', hasGps: null },
    });
  }
  if (state.folderId !== null) {
    chips.push({
      id: `folder:${state.folderId}`,
      label: labels.folder(state.folderLabel ?? state.folderId),
      remove: { type: 'setFolder', folderId: null, displayName: null },
    });
  }
  return chips;
};

export const libraryFilterIsEmpty = (state: LibraryFilterState): boolean =>
  state.tags.length === 0
  && state.personIds.length === 0
  && state.place === null
  && state.from === null
  && state.to === null
  && state.hasGps === null
  && state.folderId === null;

export interface LibrarySearchParams {
  tags: string[];
  people: string[];
  place: string | null;
  from: string | null;
  to: string | null;
  hasGps: boolean | null;
  folderId: string | null;
}

export const toSearchParams = (state: LibraryFilterState): LibrarySearchParams => ({
  tags: state.tags,
  people: state.personIds,
  place: state.place,
  from: state.from,
  to: state.to,
  hasGps: state.hasGps,
  folderId: state.folderId,
});

export const noMatchSentence = (
  state: LibraryFilterState,
  labels: LibraryFilterChipLabels,
  build: (parts: string[]) => string,
  genericBody: string,
): string => {
  const parts = libraryFilterChips(state, labels).map((chip) => chip.label);
  return parts.length === 0 ? genericBody : build(parts);
};
