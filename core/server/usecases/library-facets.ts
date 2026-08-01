import { ok, type AppError, type Result } from '@core/domain/index.js';

import type { FileSystemPort, GlobalCatalogStore, LibraryFacetFolder, LibraryFacetPerson, LibraryFacets } from '../ports.js';

export interface LibraryFacetsDeps {
  globalCatalog: GlobalCatalogStore;
  fs: FileSystemPort;
}

export interface LibraryFacetsOutputFolder extends LibraryFacetFolder {
  online: boolean;
}

export interface LibraryFacetsOutputPerson extends LibraryFacetPerson {
  fallbackIndex: number;
}

export interface LibraryFacetsOutput extends LibraryFacets {
  people: LibraryFacetsOutputPerson[];
  folders: LibraryFacetsOutputFolder[];
  counts: LibraryFacets['counts'] & { offlineFolders: number };
}

const sortPeopleFacet = (people: readonly LibraryFacetsOutputPerson[]): LibraryFacetsOutputPerson[] =>
  [...people].sort((left, right) => {
    if (left.displayName !== null && right.displayName !== null) return left.displayName.localeCompare(right.displayName);
    if (left.displayName !== null) return -1;
    if (right.displayName !== null) return 1;
    return left.fallbackIndex - right.fallbackIndex;
  });

export const libraryFacets = async (
  deps: LibraryFacetsDeps,
): Promise<Result<LibraryFacetsOutput, AppError>> => {
  const facets = await deps.globalCatalog.listLibraryFacets();
  if (!facets.ok) return facets;
  const people = await deps.globalCatalog.listPeople();
  if (!people.ok) return people;

  const fallbackIndexByPersonId = new Map(people.value.map((person, index) => [person.personId, index]));
  const facetPeople = sortPeopleFacet(
    facets.value.people.map((person) => ({ ...person, fallbackIndex: fallbackIndexByPersonId.get(person.personId) ?? 0 })),
  );

  const folders: LibraryFacetsOutputFolder[] = [];
  for (const folder of facets.value.folders) {
    const exists = await deps.fs.exists(folder.currentPath);
    if (!exists.ok) return exists;
    folders.push({ ...folder, online: exists.value });
  }

  return ok({
    ...facets.value,
    people: facetPeople,
    folders,
    counts: { ...facets.value.counts, offlineFolders: folders.filter((folder) => !folder.online).length },
  });
};
