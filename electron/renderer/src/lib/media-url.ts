/**
 * Build a scoped media:// URL for an absolute image path.
 * Served by the main process media protocol handler, which validates the
 * path against the currently selected folder.
 *
 * @param absPath - Absolute path to the image file
 * @param cacheKey - Optional cache-buster appended as ?v=cacheKey
 */
export const mediaUrl = (absPath: string, cacheKey?: string | number): string =>
  'media://local/' +
  encodeURIComponent(absPath) +
  (cacheKey !== undefined && cacheKey !== null ? '?v=' + cacheKey : '');
