import { canonicalPath, derivedFolderId } from '@core/domain/index.js';

import type { LibrarySeed } from './LibraryView.js';

export interface CataloguedFolder {
  folderId: string;
  currentPath: string;
}

export const deriveLibrarySeed = (
  folderPath: string,
  folderLabel: string,
  fingerprint: string | null,
  folders: readonly CataloguedFolder[],
): Extract<LibrarySeed, { kind: 'folder' }> => {
  const canonical = canonicalPath(folderPath);
  const catalogued = folders.find((folder) => canonicalPath(folder.currentPath) === canonical);
  return {
    kind: 'folder',
    folderId: catalogued?.folderId ?? derivedFolderId(folderPath),
    folderLabel,
    fingerprint,
  };
};
