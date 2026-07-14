export const mediaUrl = (absPath: string, cacheKey?: string | number | null): string =>
  'media://local/' +
  encodeURIComponent(absPath) +
  (cacheKey === undefined || cacheKey === null ? '' : '?v=' + String(cacheKey));

export const parentDir = (path: string): string => {
  const slash = path.lastIndexOf('/');
  if (slash === -1) return '/';
  return slash === 0 ? '/' : path.slice(0, slash);
};
