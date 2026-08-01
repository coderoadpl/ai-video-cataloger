import type { z } from 'zod';

import type { catalogLocationSchema, searchResultSchema } from '@core/contract/index.js';

export interface PreviewMedia {
  kind: 'video';
  fingerprint: string;
  title: string;
  path: string;
  folderPath: string;
  online: boolean;
  missing: boolean;
  description: string | null;
  tags: readonly string[];
  placeName: string | null;
  capturedAt: string | null;
  posterPath: string | null;
}

export const previewFromSearchResult = (item: z.output<typeof searchResultSchema>): PreviewMedia => ({
  kind: 'video',
  fingerprint: item.fingerprint,
  title: item.finalName ?? item.fileName,
  path: `${item.folder.currentPath}/${item.fileName}`,
  folderPath: item.folder.currentPath,
  online: item.folder.online,
  missing: item.missing,
  description: item.description,
  tags: item.tags,
  placeName: item.place?.name ?? null,
  capturedAt: item.capturedAt,
  posterPath: item.gridThumbnailPath ?? item.thumbnailPath,
});

export const previewFromLocation = (location: z.output<typeof catalogLocationSchema>): PreviewMedia | null => {
  if (location.media === 'photo') return null;
  return {
    kind: 'video',
    fingerprint: location.fingerprint,
    title: location.finalName ?? location.fileName,
    path: `${location.folder.currentPath}/${location.fileName}`,
    folderPath: location.folder.currentPath,
    online: location.folder.online,
    missing: location.missing,
    description: null,
    tags: [],
    placeName: location.place?.name ?? null,
    capturedAt: null,
    posterPath: location.thumbPath,
  };
};
