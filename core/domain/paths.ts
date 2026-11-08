export const canonicalPath = (value: string): string => value.normalize('NFC');

export const isPathUnderRoot = (value: string, root: string): boolean => {
  const candidate = canonicalPath(value);
  const base = canonicalPath(root);
  return candidate === base || candidate.startsWith(`${base}/`);
};

export const rebasePath = (value: string, fromRoot: string, toRoot: string): string | null => {
  if (!isPathUnderRoot(value, fromRoot)) return null;
  return `${canonicalPath(toRoot)}${canonicalPath(value).slice(canonicalPath(fromRoot).length)}`;
};

export const rebasePathByPrefixes = (
  value: string,
  prefixes: readonly { from: string; to: string }[],
): string | null => {
  for (const prefix of prefixes) {
    const rebased = rebasePath(value, prefix.from, prefix.to);
    if (rebased !== null) return rebased;
  }
  return null;
};
