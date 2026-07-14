import type { z } from 'zod';

import type { scanVideoSchema } from '@core/contract/index.js';

export type CatalogVideo = z.output<typeof scanVideoSchema>;

export const keyOf = (video: Pick<CatalogVideo, 'contentHash' | 'path'>): string =>
  video.contentHash === null ? 'path:' + video.path : video.contentHash;
