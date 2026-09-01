import type { LibraryItem, LibraryVideoItem } from './day-groups.js';
import type { LibraryOfflineReason } from './folder-groups.js';

export type LibraryVideoStage =
  | { kind: 'player'; path: string; posterPath: string | null }
  | { kind: 'unavailable'; reason: NonNullable<LibraryOfflineReason> };

export const viewerTitle = (item: LibraryItem): string =>
  item.media === 'video' ? item.finalName ?? item.fileName : item.fileName;

export const videoViewerStage = (item: LibraryVideoItem): LibraryVideoStage => {
  if (!item.folder.online) return { kind: 'unavailable', reason: item.folder.offlineReason ?? 'drive-disconnected' };
  if (item.missing) return { kind: 'unavailable', reason: 'file-missing' };
  return {
    kind: 'player',
    path: `${item.folder.currentPath}/${item.fileName}`,
    posterPath: item.gridThumbnailPath ?? item.thumbnailPath,
  };
};
