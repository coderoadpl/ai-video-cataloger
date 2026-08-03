import type { LibraryItem, LibraryVideoItem } from './day-groups.js';

export type LibraryOfflineReason = LibraryVideoItem['folder']['offlineReason'];

export interface LibraryFolderSection {
  folderId: string;
  displayName: string;
  offline: boolean;
  offlineReason: LibraryOfflineReason;
  items: LibraryVideoItem[];
}

export type LibrarySort = 'relevance' | 'captured_desc' | 'captured_asc' | 'name_asc';

export const isLibrarySort = (value: string): value is LibrarySort =>
  value === 'relevance' || value === 'captured_desc' || value === 'captured_asc' || value === 'name_asc';

const displayNameOf = (item: LibraryItem): string => item.media === 'video' ? (item.finalName ?? item.fileName) : item.fileName;

export const sortItems = <T extends LibraryItem>(items: readonly T[], sort: LibrarySort): T[] => {
  if (sort === 'name_asc') {
    return [...items].sort((left, right) => displayNameOf(left).localeCompare(displayNameOf(right)));
  }
  if (sort === 'captured_asc') {
    return [...items].sort((left, right) => (left.capturedAt ?? '').localeCompare(right.capturedAt ?? ''));
  }
  if (sort === 'captured_desc') {
    return [...items].sort((left, right) => (right.capturedAt ?? '').localeCompare(left.capturedAt ?? ''));
  }
  return [...items];
};

export const groupByFolder = (items: readonly LibraryVideoItem[], sort: LibrarySort): LibraryFolderSection[] => {
  const byFolder = new Map<string, LibraryFolderSection>();
  const order: string[] = [];

  for (const item of items) {
    const existing = byFolder.get(item.folder.folderId);
    if (existing !== undefined) {
      existing.items.push(item);
      continue;
    }
    byFolder.set(item.folder.folderId, {
      folderId: item.folder.folderId,
      displayName: item.folder.displayName,
      offline: !item.folder.online,
      offlineReason: item.folder.offlineReason,
      items: [item],
    });
    order.push(item.folder.folderId);
  }

  return order
    .map((folderId) => byFolder.get(folderId))
    .filter((section): section is LibraryFolderSection => section !== undefined)
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
    .map((section) => ({ ...section, items: sortItems(section.items, sort) }));
};
