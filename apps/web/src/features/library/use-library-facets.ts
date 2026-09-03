import { useQuery } from '@tanstack/react-query';

import type { LibraryFacetsOutput } from '@core/client/index.js';

import { actions } from '../../api.js';

const EMPTY_FACETS: LibraryFacetsOutput = {
  tags: [],
  people: [],
  places: [],
  years: [],
  folders: [],
  counts: { total: 0, withGps: 0, withoutCaptureDate: 0, missing: 0, hidden: 0, offlineFolders: 0 },
};

export interface LibraryFacetsState {
  facets: LibraryFacetsOutput;
  isLoading: boolean;
}

export const useLibraryFacets = (input: { active: boolean }): LibraryFacetsState => {
  const query = useQuery({ ...actions.libraryFacets, enabled: input.active });
  return { facets: query.data ?? EMPTY_FACETS, isLoading: query.isLoading };
};
