import { ok, type AppError, type Result } from '@core/domain/index.js';

import type { FileSystemPort, GlobalCatalogStore, LibraryFacetFolder, LibraryFacetPerson, LibraryFacets, PhotosStore } from '../ports.js';

export interface LibraryFacetsDeps {
  globalCatalog: GlobalCatalogStore;
  photos: PhotosStore;
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
  const hiddenPhotos = await deps.photos.countHidden();
  if (!hiddenPhotos.ok) return hiddenPhotos;
  const hiddenPhotoFingerprints = await deps.photos.listHiddenFingerprints();
  if (!hiddenPhotoFingerprints.ok) return hiddenPhotoFingerprints;
  const facets = await deps.globalCatalog.listLibraryFacets(hiddenPhotoFingerprints.value);
  if (!facets.ok) return facets;
  const facetPeople = sortPeopleFacet(facets.value.people);

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
    counts: {
      ...facets.value.counts,
      hidden: facets.value.counts.hidden + hiddenPhotos.value,
      offlineFolders: folders.filter((folder) => !folder.online).length,
    },
  });
};
