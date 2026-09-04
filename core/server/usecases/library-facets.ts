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
  const facets = await deps.globalCatalog.listLibraryFacets();
  if (!facets.ok) return facets;
  const hiddenPhotos = await deps.photos.countHidden();
  if (!hiddenPhotos.ok) return hiddenPhotos;
  const hiddenPhotoFingerprints = await deps.photos.listHiddenFingerprints();
  if (!hiddenPhotoFingerprints.ok) return hiddenPhotoFingerprints;
  const hiddenVideoFingerprints = await deps.globalCatalog.listHiddenFingerprints();
  if (!hiddenVideoFingerprints.ok) return hiddenVideoFingerprints;
  const observations = await deps.globalCatalog.listFaceObservations();
  if (!observations.ok) return observations;
  const people = await deps.globalCatalog.listPeople();
  if (!people.ok) return people;

  const fallbackIndexByPersonId = new Map(people.value.map((person, index) => [person.personId, index]));
  const hiddenFingerprints = new Set([...hiddenVideoFingerprints.value, ...hiddenPhotoFingerprints.value]);
  const peopleById = new Map(people.value.map((person) => [person.personId, person]));
  const fingerprintCountsByPersonId = new Map<string, Set<string>>();
  for (const observation of observations.value) {
    if (observation.personId === null || hiddenFingerprints.has(observation.fingerprint)) continue;
    const current = fingerprintCountsByPersonId.get(observation.personId) ?? new Set<string>();
    current.add(observation.fingerprint);
    fingerprintCountsByPersonId.set(observation.personId, current);
  }
  const facetPeople = sortPeopleFacet(
    [...fingerprintCountsByPersonId.entries()]
      .map(([personId, fingerprints]) => {
        const person = peopleById.get(personId);
        return {
          personId,
          displayName: person?.displayName ?? null,
          count: fingerprints.size,
          fallbackIndex: fallbackIndexByPersonId.get(personId) ?? 0,
        };
      }),
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
    counts: {
      ...facets.value.counts,
      hidden: facets.value.counts.hidden + hiddenPhotos.value,
      offlineFolders: folders.filter((folder) => !folder.online).length,
    },
  });
};
