import type { z } from 'zod';

import type { photosDetailOutputSchema } from '@core/contract/index.js';

import type { PhotoListItem } from './photo-list-item.js';

export type PhotoDetail = z.output<typeof photosDetailOutputSchema>;

export const detailToListItem = (detail: PhotoDetail): PhotoListItem => ({
  fingerprint: detail.photo.fingerprint,
  fileName: detail.photo.fileName,
  currentPath: detail.photo.currentPath,
  ext: detail.photo.ext,
  capturedAt: detail.photo.capturedAt,
  capturedAtSource: detail.photo.capturedAtSource,
  width: detail.photo.width,
  height: detail.photo.height,
  proxyState: detail.photo.proxyState,
  thumbState: detail.photo.thumbState,
  missingAt: detail.photo.missingAt,
  sightings: detail.sightings.length,
  thumbPath: detail.thumbPath,
  gridThumbPath: detail.gridThumbPath,
  proxyPath: detail.proxyPath,
  analysed: detail.analysis !== null,
  exifReadAt: detail.photo.exifReadAt,
});
