export const folderName = (path: string): string => {
  const trimmed = path.replace(/\/+$/, '');
  const slash = trimmed.lastIndexOf('/');
  return slash === -1 ? trimmed : trimmed.slice(slash + 1);
};

export const versionLabel = (version: string): string =>
  version.length === 0 ? '' : `v${version}`;
