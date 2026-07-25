export interface CliPathEntry {
  path: string;
  version: string | null;
  isSymlink: boolean;
  symlinkTarget: string | null;
}

export interface StaleCliInput {
  appVersion: string;
  ownedInstallPaths: readonly string[];
  entries: readonly CliPathEntry[];
}

export interface CliShadow {
  path: string;
  version: string | null;
  removable: boolean;
}

export interface StaleCliAssessment {
  stale: boolean;
  activePath: string | null;
  activeVersion: string | null;
  shadows: CliShadow[];
}

const matchesAppVersion = (entry: CliPathEntry, appVersion: string): boolean =>
  entry.version !== null && entry.version === appVersion;

const toShadow = (entry: CliPathEntry, ownedInstallPaths: readonly string[]): CliShadow => ({
  path: entry.path,
  version: entry.version,
  removable: entry.isSymlink && ownedInstallPaths.includes(entry.path),
});

export const cliShadowLine = (shadow: CliShadow): string => {
  const version = shadow.version === null ? 'unknown version' : `version ${shadow.version}`;
  const guidance = shadow.removable
    ? 'safe to remove (a symlink this app owns)'
    : 'remove it manually or adjust your PATH';
  return `${shadow.path} (${version}, ${guidance})`;
};

export const assessStaleCli = ({ appVersion, ownedInstallPaths, entries }: StaleCliInput): StaleCliAssessment => {
  const active = entries[0] ?? null;
  if (active === null) {
    return { stale: false, activePath: null, activeVersion: null, shadows: [] };
  }
  const firstCurrentIndex = entries.findIndex((entry) => matchesAppVersion(entry, appVersion));
  const stale = !matchesAppVersion(active, appVersion);
  const shadowingEntries = firstCurrentIndex === -1
    ? entries.filter((entry) => !matchesAppVersion(entry, appVersion))
    : entries.slice(0, firstCurrentIndex);
  return {
    stale,
    activePath: active.path,
    activeVersion: active.version,
    shadows: shadowingEntries.map((entry) => toShadow(entry, ownedInstallPaths)),
  };
};
