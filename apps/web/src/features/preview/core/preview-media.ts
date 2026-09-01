import type { z } from 'zod';

import type { catalogLocationSchema } from '@core/contract/index.js';

export type PreviewOfflineReason = 'drive-disconnected' | 'file-missing';

export interface PreviewMedia {
  kind: 'video';
  fingerprint: string;
  title: string;
  path: string;
  folderPath: string;
  online: boolean;
  offlineReason: PreviewOfflineReason | null;
  missing: boolean;
  description: string | null;
  tags: readonly string[];
  placeName: string | null;
  capturedAt: string | null;
  posterPath: string | null;
  gps: { lat: number; lon: number } | null;
}

export const previewFromLocation = (location: z.output<typeof catalogLocationSchema>): PreviewMedia | null => {
  if (location.media === 'photo') return null;
  return {
    kind: 'video',
    fingerprint: location.fingerprint,
    title: location.finalName ?? location.fileName,
    path: `${location.folder.currentPath}/${location.fileName}`,
    folderPath: location.folder.currentPath,
    online: location.folder.online,
    offlineReason: location.folder.online ? null : 'drive-disconnected',
    missing: location.missing,
    description: null,
    tags: [],
    placeName: location.place?.name ?? null,
    capturedAt: null,
    posterPath: location.thumbPath,
    gps: { lat: location.lat, lon: location.lon },
  };
};
