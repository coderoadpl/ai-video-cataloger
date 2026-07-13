import type { z } from 'zod';

import type { scanVideoSchema } from '@core/contract/index.js';

/** A single scanned video exactly as the `scan` contract returns it. */
export type CatalogVideo = z.output<typeof scanVideoSchema>;

/**
 * Stable identity for a video across scans: the partial content hash survives
 * renames (the file's bytes don't change), so a selection keyed by it follows a
 * video through `renameVideo`. Untracked/unhashed videos fall back to their
 * path.
 */
export const keyOf = (video: Pick<CatalogVideo, 'contentHash' | 'path'>): string =>
  video.contentHash === null ? 'path:' + video.path : video.contentHash;
