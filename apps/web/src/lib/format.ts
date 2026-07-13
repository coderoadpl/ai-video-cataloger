/** Trailing path segment of an absolute folder path, e.g. `/a/b/clips` → `clips`. */
export const folderName = (path: string): string => {
  const trimmed = path.replace(/\/+$/, '');
  const slash = trimmed.lastIndexOf('/');
  return slash === -1 ? trimmed : trimmed.slice(slash + 1);
};

/** `1.2.3` → `v1.2.3`; empty string stays empty so the header can hide it. */
export const versionLabel = (version: string): string =>
  version.length === 0 ? '' : `v${version}`;
