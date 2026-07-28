import { ok, type AppError, type Result } from '@core/domain/index.js';

import type { AnalyzedFileLocation, FileSystemPort, GlobalCatalogStore } from '../ports.js';
import { discoverArtifactRoot } from './artifact-root.js';
import { variantOutputPaths } from './artifact-store.js';

export interface CanonicalReachabilityDeps {
  fs: FileSystemPort;
  globalCatalog: GlobalCatalogStore;
}

const sourceIsReachable = async (
  fs: FileSystemPort,
  location: AnalyzedFileLocation,
): Promise<Result<boolean, AppError>> => {
  if (location.folderPath === null) return ok(false);
  const names = [...new Set([location.fileName, location.finalName].filter((name): name is string => name !== null))];
  for (const name of names) {
    const exists = await fs.isFile(fs.join(location.folderPath, name));
    if (!exists.ok) return exists;
    if (exists.value) return ok(true);
  }
  return ok(false);
};

const artifactsAreReachable = async (
  deps: CanonicalReachabilityDeps,
  location: AnalyzedFileLocation,
): Promise<Result<boolean, AppError>> => {
  const variants = await deps.globalCatalog.listVariants(location.fingerprint);
  if (!variants.ok) return variants;
  if (location.folderPath === null) return ok(false);
  const root = await discoverArtifactRoot(deps.fs, location.folderPath);
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
): Promise<Result<AnalyzedFileLocation[], AppError>> => {
  const reachable: AnalyzedFileLocation[] = [];
  let healed = false;
  for (const location of locations) {
    const source = await sourceIsReachable(deps.fs, location);
    if (!source.ok) return source;
    if (source.value) {
      reachable.push(location);
      continue;
    }
    const artifacts = await artifactsAreReachable(deps, location);
    if (!artifacts.ok) return artifacts;
    if (artifacts.value) {
      reachable.push(location);
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
