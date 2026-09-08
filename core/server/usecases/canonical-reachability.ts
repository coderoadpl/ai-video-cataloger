import { ok, type AppError, type Result } from '@core/domain/index.js';

import type { AnalyzedFileLocation, FileSystemPort, GlobalCatalogStore } from '../ports.js';
import { discoverArtifactRoot } from './artifact-root.js';
import { variantOutputPaths } from './artifact-store.js';

export interface CanonicalReachabilityDeps {
  fs: FileSystemPort;
  globalCatalog: GlobalCatalogStore;
}

const reachableSourcePath = async (
  fs: FileSystemPort,
  location: AnalyzedFileLocation,
): Promise<Result<string | null, AppError>> => {
  if (location.folderPath === null) return ok(null);
  const names = [...new Set([location.fileName, location.finalName].filter((name): name is string => name !== null))];
  for (const name of names) {
    const path = fs.join(location.folderPath, name);
    const exists = await fs.isFile(path);
    if (!exists.ok) return exists;
    if (!exists.value) continue;
    if (name === location.fileName) return ok(path);
    const hash = await fs.partialContentHash(path);
    if (!hash.ok) return hash;
    if (hash.value === location.fingerprint) return ok(path);
  }
  return ok(null);
};

const artifactsAreReachable = async (
  deps: CanonicalReachabilityDeps,
  location: AnalyzedFileLocation,
): Promise<Result<boolean, AppError>> => {
  const variants = await deps.globalCatalog.listVariants(location.fingerprint);
  if (!variants.ok) return variants;
  if (location.folderPath === null) return ok(false);
  const root = await discoverArtifactRoot(deps.fs, location.folderPath, location.folderId);
  if (!root.ok) return root;
  for (const variant of variants.value) {
    const output = variantOutputPaths(deps.fs, root.value, location.fingerprint, variant.configId);
    for (const path of [output.summaryJsonPath, output.summaryPath]) {
      const artifact = await deps.fs.readTextFile(path);
      if (!artifact.ok) return artifact;
      if (artifact.value !== null) return ok(true);
    }
  }
  return ok(false);
};

export const reachableAnalyzedFileLocations = async (
  deps: CanonicalReachabilityDeps,
  locations: readonly AnalyzedFileLocation[],
): Promise<Result<Array<AnalyzedFileLocation & { canonicalPath: string | null }>, AppError>> => {
  const reachable: Array<AnalyzedFileLocation & { canonicalPath: string | null }> = [];
  let healed = false;
  for (const location of locations) {
    const source = await reachableSourcePath(deps.fs, location);
    if (!source.ok) return source;
    if (source.value !== null) {
      reachable.push({ ...location, canonicalPath: source.value });
      continue;
    }
    const artifacts = await artifactsAreReachable(deps, location);
    if (!artifacts.ok) return artifacts;
    if (artifacts.value) {
      reachable.push({ ...location, canonicalPath: location.folderPath === null ? null : deps.fs.join(location.folderPath, location.fileName) });
      continue;
    }
    const cleared = await deps.globalCatalog.clearAnalysisVariants(location.fingerprint);
    if (!cleared.ok) return cleared;
    healed = true;
  }
  if (healed) {
    const flushed = await deps.globalCatalog.flush();
    if (!flushed.ok) return flushed;
  }
  return ok(reachable);
};

export const analyzedCanonicalIsReachable = async (
  deps: CanonicalReachabilityDeps,
  fingerprint: string,
): Promise<Result<boolean, AppError>> => {
  const locations = await deps.globalCatalog.listAnalyzedFileLocations([fingerprint]);
  if (!locations.ok) return locations;
  const reachable = await reachableAnalyzedFileLocations(deps, locations.value);
  if (!reachable.ok) return reachable;
  return ok(reachable.value.length > 0);
};
