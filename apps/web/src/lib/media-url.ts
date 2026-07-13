/**
 * Build a scoped `media://` URL for an absolute image path. The desktop main
 * process serves it through the media-protocol adapter, which validates the
 * path against the currently selected folder (extension allowlist, scope,
 * realpath-escape rejection, size cap). Under the bare dev/browser harness the
 * scheme is unhandled, so the image simply fails to load and the film-icon
 * fallback shows instead.
 *
 * `cacheKey` (the thumbnail mtime) is appended as `?v=…` so a regenerated file
 * at the same path produces a distinct URL and defeats the image cache.
 */
export const mediaUrl = (absPath: string, cacheKey?: string | number | null): string =>
  'media://local/' +
  encodeURIComponent(absPath) +
  (cacheKey === undefined || cacheKey === null ? '' : '?v=' + String(cacheKey));

/** Directory portion of an absolute file path, e.g. `/a/b/clip.mp4` → `/a/b`. */
export const parentDir = (path: string): string => {
  const slash = path.lastIndexOf('/');
  if (slash === -1) return '/';
  return slash === 0 ? '/' : path.slice(0, slash);
};
