import { canonicalPath, derivedFolderId } from '@core/domain/index.js';

import type { LibraryShowInSeed } from './LibraryView.js';

export interface CataloguedFolder {
  folderId: string;
  currentPath: string;
}

export const deriveLibrarySeed = (
  folderPath: string,
  folderLabel: string,
  fingerprint: string | null,
  folders: readonly CataloguedFolder[],
): LibraryShowInSeed => {
  const canonical = canonicalPath(folderPath);
  const catalogued = folders.find((folder) => canonicalPath(folder.currentPath) === canonical);
  return {
    folderId: catalogued?.folderId ?? derivedFolderId(folderPath),
    folderLabel,
    fingerprint,
  };
};
