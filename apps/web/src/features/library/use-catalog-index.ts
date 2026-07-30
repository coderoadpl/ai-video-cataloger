import { useQuery } from '@tanstack/react-query';

import type { LibraryFacetsOutput } from '@core/client/index.js';

import { actions } from '../../api.js';

export interface CatalogIndexState {
  hasFiles: boolean | null;
  folders: LibraryFacetsOutput['folders'];
}

export const useCatalogIndex = (): CatalogIndexState => {
  const query = useQuery(actions.libraryFacets);
  return {
    hasFiles: query.data === undefined ? null : query.data.counts.total > 0,
    folders: query.data?.folders ?? [],
  };
};
