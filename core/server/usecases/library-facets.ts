import { ok, type AppError, type Result } from '@core/domain/index.js';

import type { FileSystemPort, GlobalCatalogStore, LibraryFacetFolder, LibraryFacets } from '../ports.js';

export interface LibraryFacetsDeps {
  globalCatalog: GlobalCatalogStore;
  fs: FileSystemPort;
}

export interface LibraryFacetsOutputFolder extends LibraryFacetFolder {
  online: boolean;
}

export interface LibraryFacetsOutput extends LibraryFacets {
  folders: LibraryFacetsOutputFolder[];
  counts: LibraryFacets['counts'] & { offlineFolders: number };
}

export const libraryFacets = async (
  deps: LibraryFacetsDeps,
): Promise<Result<LibraryFacetsOutput, AppError>> => {
  const facets = await deps.globalCatalog.listLibraryFacets();
  if (!facets.ok) return facets;

  const folders: LibraryFacetsOutputFolder[] = [];
  for (const folder of facets.value.folders) {
    const exists = await deps.fs.exists(folder.currentPath);
    if (!exists.ok) return exists;
    folders.push({ ...folder, online: exists.value });
  }

  return ok({
    ...facets.value,
    folders,
    counts: { ...facets.value.counts, offlineFolders: folders.filter((folder) => !folder.online).length },
  });
};
