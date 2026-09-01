import { z } from 'zod';

import {
  CONFIG_DEFAULTS,
  appError,
  derivedFolderId,
  ok,
  type AppError,
  type CatalogFile,
  type CatalogFolder,
  type CatalogVariant,
  type Result,
} from '@core/domain/index.js';

import type {
  AnalyzerPort,
  ConfigStore,
  FileSystemPort,
  GlobalCatalogStore,
  JobsPort,
} from '../ports.js';
import { discoverArtifactRoot, type ArtifactRoot } from './artifact-root.js';
import { analyzedCanonicalIsReachable } from './canonical-reachability.js';
import {
  materializeSelectedVariantProjection,
  selectedVariantProjectionSource,
  sharedArtifactPaths,
  variantArtifactPaths,
  variantOutputPaths,
  type SelectedVariantProjectionSource,
} from './artifact-store.js';
import { resolveFolderIntoIndex } from './catalog-index.js';
import { readFolderMarker } from './folder-identity.js';
import {
  processConfigIdentity,
  resolveProcessOptions,
  type ProcessConfigIdentity,
} from './process.js';
import { artifactPaths, variantProvenanceLabel } from './shared.js';

const configIdSchema = z.union([z.literal('legacy'), z.string().regex(/^cfg_[0-9a-f]{12}$/)]);
const variantInputSchema = z.object({
  fingerprint: z.string().min(1),
  configId: configIdSchema,
}).strict();
const folderDefaultInputSchema = z.object({
  folderPath: z.string().min(1),
  configId: configIdSchema.nullable(),
}).strict();

export interface VariantSelectionDeps {
  globalCatalog: GlobalCatalogStore;
  fs: FileSystemPort;
}

export interface DeferredVariantSelectionDeps extends VariantSelectionDeps {
  jobs: JobsPort;
}

export interface FolderDefaultVariantDeps extends VariantSelectionDeps {
  config: ConfigStore;
  analyzer: AnalyzerPort;
}

export interface SelectVariantOutput {
  fingerprint: string;
  configId: string;
}

export interface SetFolderDefaultVariantOutput {
  folderId: string;
  defaultConfigId: string | null;
  resolvedConfigId: string;
}

export interface DeleteVariantOutput {
  fingerprint: string;
  configId: string;
  selectedConfigId: string;
}

export interface VariantListItem {
  configId: string;
  descriptor: CatalogVariant['descriptor'];
  label: string;
  createdAt: string;
  analyzer: string | null;
  model: string | null;
  usage: CatalogVariant['usage'];
  estimatedCostUsd: number | null;
  artifacts: {
    framesDirectory: string | null;
    transcriptPath: string | null;
    summaryPath: string;
  };
  selected: boolean;
  finalName: string | null;
  description: string | null;
  transcript: string | null;
  language: string | null;
  tags: string[];
}

export interface ListVariantsOutput {
  fingerprint: string;
  videoPath: string;
  folderPath: string;
  folderDefaultConfigId: string | null;
  currentConfig: ProcessConfigIdentity;
  variants: VariantListItem[];
}

export interface VariantLocator {
  videoPath?: string | undefined;
  fingerprint?: string | undefined;
}

interface VariantProjectionContext {
  file: CatalogFile;
  folder: CatalogFolder;
  root: ArtifactRoot;
  videoPath: string;
}

interface FolderSelectionChange {
  before: CatalogVariant;
  after: CatalogVariant;
}

const variantLocatorSchema = z.object({
  videoPath: z.string().min(1).optional(),
  fingerprint: z.string().min(1).optional(),
}).strict().refine(
  (input) => (input.videoPath === undefined) !== (input.fingerprint === undefined),
  { message: 'Exactly one of videoPath or fingerprint is required' },
);

const locatedVariantInputSchema = variantLocatorSchema.safeExtend({
  configId: configIdSchema,
});

const locatedVariantSelectionInputSchema = locatedVariantInputSchema.safeExtend({
  deferProjection: z.boolean().optional(),
});

export const listVariants = async (
  deps: FolderDefaultVariantDeps,
  input: VariantLocator,
): Promise<Result<ListVariantsOutput, AppError>> => {
  const parsed = variantLocatorSchema.safeParse(input);
  if (!parsed.success) return invalidVariantInput(parsed.error.issues);
  const target = await variantTarget(deps, parsed.data);
  if (!target.ok) return target;
  const reachable = await analyzedCanonicalIsReachable(deps, target.value.fingerprint);
  if (!reachable.ok) return reachable;
  const variants = await deps.globalCatalog.listVariants(target.value.fingerprint);
  if (!variants.ok) return variants;
  const storedFolderDefault = await deps.globalCatalog.getFolderDefaultConfigId(target.value.folderId);
  if (!storedFolderDefault.ok) return storedFolderDefault;
  const currentConfig = await resolvedFolderConfigIdentity(deps, target.value.folderPath);
  if (!currentConfig.ok) return currentConfig;
  const resolvedFolderDefaultConfigId = storedFolderDefault.value ?? currentConfig.value.configId;
  const root = await discoverArtifactRoot(deps.fs, target.value.folderPath);
  if (!root.ok) return root;
  const selectedConfigId = await selectedVariantConfigId(
    deps.globalCatalog,
    target.value.fingerprint,
    variants.value,
    resolvedFolderDefaultConfigId,
  );
  if (!selectedConfigId.ok) return selectedConfigId;
  return ok({
    fingerprint: target.value.fingerprint,
    videoPath: target.value.videoPath,
    folderPath: target.value.folderPath,
    folderDefaultConfigId: storedFolderDefault.value,
    currentConfig: currentConfig.value,
    variants: variants.value.sort(compareVariants).map((variant) => variantListItem(
      deps.fs,
      root.value,
      variant,
      selectedConfigId.value,
    )),
  });
};

export const selectVariantByLocator = async (
  deps: DeferredVariantSelectionDeps,
  input: VariantLocator & { configId: string; deferProjection?: boolean | undefined },
): Promise<Result<SelectVariantOutput, AppError>> => {
  const parsed = locatedVariantSelectionInputSchema.safeParse(input);
  if (!parsed.success) return invalidVariantInput(parsed.error.issues);
  const fingerprint = await variantFingerprint(deps, parsed.data);
  if (!fingerprint.ok) return fingerprint;
  if (parsed.data.deferProjection !== true) {
    return selectVariant(deps, { fingerprint: fingerprint.value, configId: parsed.data.configId });
  }
  return selectVariantDeferred(deps, { fingerprint: fingerprint.value, configId: parsed.data.configId });
};

const selectVariantDeferred = async (
  deps: DeferredVariantSelectionDeps,
  input: { fingerprint: string; configId: string },
): Promise<Result<SelectVariantOutput, AppError>> => {
  const variant = await requiredVariant(deps.globalCatalog, input.fingerprint, input.configId);
  if (!variant.ok) return variant;
  const previousConfigId = await deps.globalCatalog.getSelectedConfigId(input.fingerprint);
  if (!previousConfigId.ok) return previousConfigId;
  const previousExplicitConfigId = await deps.globalCatalog.getExplicitSelectedConfigId(input.fingerprint);
  if (!previousExplicitConfigId.ok) return previousExplicitConfigId;
  const previous = previousConfigId.value === null
    ? ok<CatalogVariant | null>(null)
    : await deps.globalCatalog.getVariant(input.fingerprint, previousConfigId.value);
  if (!previous.ok) return previous;
  const selected = await deps.globalCatalog.setSelectedVariant(input.fingerprint, input.configId);
  if (!selected.ok) return selected;
  const queued = await deps.jobs.enqueue({
    kind: 'variant_projection',
    payload: input,
    run: () => synchronizeSelectedVariantProjection(deps, input.fingerprint, previous.value),
  });
  if (!queued.ok) {
    await deps.globalCatalog.setSelectedVariant(input.fingerprint, previousExplicitConfigId.value);
    return { ok: false, error: queued.error };
  }
  return ok({ fingerprint: input.fingerprint, configId: input.configId });
};

export const deleteVariantByLocator = async (
  deps: VariantSelectionDeps,
  input: VariantLocator & { configId: string },
): Promise<Result<DeleteVariantOutput, AppError>> => {
  const parsed = locatedVariantInputSchema.safeParse(input);
  if (!parsed.success) return invalidVariantInput(parsed.error.issues);
  const fingerprint = await variantFingerprint(deps, parsed.data);
  if (!fingerprint.ok) return fingerprint;
  return deleteVariant(deps, { fingerprint: fingerprint.value, configId: parsed.data.configId });
};

export const selectVariant = async (
  deps: VariantSelectionDeps,
  input: { fingerprint: string; configId: string },
): Promise<Result<SelectVariantOutput, AppError>> => {
  const parsed = variantInputSchema.safeParse(input);
  if (!parsed.success) return invalidVariantInput(parsed.error.issues);
  const variant = await requiredVariant(deps.globalCatalog, parsed.data.fingerprint, parsed.data.configId);
  if (!variant.ok) return variant;
  const previousConfigId = await deps.globalCatalog.getSelectedConfigId(parsed.data.fingerprint);
  if (!previousConfigId.ok) return previousConfigId;
  const previousExplicitConfigId = await deps.globalCatalog.getExplicitSelectedConfigId(parsed.data.fingerprint);
  if (!previousExplicitConfigId.ok) return previousExplicitConfigId;
  const previous = previousConfigId.value === null
    ? ok<CatalogVariant | null>(null)
    : await deps.globalCatalog.getVariant(parsed.data.fingerprint, previousConfigId.value);
  if (!previous.ok) return previous;
  const projected = await projectVariant(deps, variant.value);
  if (!projected.ok) return projected;
  const selected = await deps.globalCatalog.setSelectedVariant(parsed.data.fingerprint, parsed.data.configId);
  if (!selected.ok) {
    if (previous.value !== null) {
      const restored = await projectVariant(deps, previous.value);
      if (restored.ok) await removePreviousProjection(deps.fs, restored.value, variant.value, previous.value);
    }
    return selected;
  }
  if (previous.value !== null) {
    const cleaned = await removePreviousProjection(deps.fs, projected.value, previous.value, variant.value);
    if (!cleaned.ok) {
      await deps.globalCatalog.setSelectedVariant(parsed.data.fingerprint, previousExplicitConfigId.value);
      const restored = await projectVariant(deps, previous.value);
      if (restored.ok) await removePreviousProjection(deps.fs, restored.value, variant.value, previous.value);
      return cleaned;
    }
  }
  return ok({ fingerprint: parsed.data.fingerprint, configId: parsed.data.configId });
};

export const setFolderDefaultVariant = async (
  deps: FolderDefaultVariantDeps,
  input: { folderPath: string; configId: string | null },
): Promise<Result<SetFolderDefaultVariantOutput, AppError>> => {
  const parsed = folderDefaultInputSchema.safeParse(input);
  if (!parsed.success) return invalidVariantInput(parsed.error.issues);
  const folderPath = deps.fs.resolve(parsed.data.folderPath);
  const resolvedFolder = await resolveFolderIntoIndex(deps, folderPath);
  if (!resolvedFolder.ok) return resolvedFolder;
  const folderId = resolvedFolder.value.folderId;
  const previousDefault = await deps.globalCatalog.getFolderDefaultConfigId(folderId);
  if (!previousDefault.ok) return previousDefault;
  const records = await deps.globalCatalog.listFolderRecords(folderId);
  if (!records.ok) return records;
  const before = await selectedVariants(deps.globalCatalog, records.value.map((record) => record.file.fingerprint));
  if (!before.ok) return before;
  let fallbackConfigId = parsed.data.configId;
  if (fallbackConfigId === null) {
    const fallback = await resolvedFolderConfigIdentity(deps, folderPath);
    if (!fallback.ok) return fallback;
    fallbackConfigId = fallback.value.configId;
  }
  const stored = await deps.globalCatalog.setFolderDefaultVariant(folderId, fallbackConfigId);
  if (!stored.ok) return stored;
  const after = await selectedVariants(deps.globalCatalog, records.value.map((record) => record.file.fingerprint));
  if (!after.ok) {
    await deps.globalCatalog.setFolderDefaultVariant(folderId, previousDefault.value);
    return after;
  }
  const changes = selectionChanges(before.value, after.value);
  for (const change of changes) {
    const projected = await projectVariant(deps, change.after);
    if (!projected.ok) {
      await rollbackFolderSelections(deps, folderId, previousDefault.value, changes);
      return projected;
    }
    const cleaned = await removePreviousProjection(deps.fs, projected.value, change.before, change.after);
    if (!cleaned.ok) {
      await rollbackFolderSelections(deps, folderId, previousDefault.value, changes);
      return cleaned;
    }
  }
  return ok({
    folderId,
    defaultConfigId: parsed.data.configId,
    resolvedConfigId: fallbackConfigId,
  });
};

export const deleteVariant = async (
  deps: VariantSelectionDeps,
  input: { fingerprint: string; configId: string },
): Promise<Result<DeleteVariantOutput, AppError>> => {
  const parsed = variantInputSchema.safeParse(input);
  if (!parsed.success) return invalidVariantInput(parsed.error.issues);
  const variants = await deps.globalCatalog.listVariants(parsed.data.fingerprint);
  if (!variants.ok) return variants;
  const deleted = variants.value.find((variant) => variant.configId === parsed.data.configId);
  if (deleted === undefined) return variantNotFound(parsed.data.fingerprint, parsed.data.configId);
  if (variants.value.length === 1) {
    return { ok: false, error: appError('conflict', 'Cannot delete the last analysis variant') };
  }
  const selected = await deps.globalCatalog.getSelectedConfigId(parsed.data.fingerprint);
  if (!selected.ok) return selected;
  const survivors = variants.value
    .filter((variant) => variant.configId !== parsed.data.configId)
    .sort(compareVariants);
  const promoted = selected.value === parsed.data.configId ? survivors[0] ?? null : null;
  const projected = promoted === null ? null : await projectVariant(deps, promoted);
  if (projected !== null && !projected.ok) return projected;
  const removed = await deps.globalCatalog.deleteVariant(parsed.data.fingerprint, parsed.data.configId);
  if (!removed.ok) return removed;
  const selectedConfigId = await deps.globalCatalog.getSelectedConfigId(parsed.data.fingerprint);
  if (!selectedConfigId.ok) return selectedConfigId;
  if (selectedConfigId.value === null) {
    return { ok: false, error: appError('internal', 'Deleting a variant left the file without a selected analysis') };
  }
  if (promoted !== null && projected !== null && projected.ok) {
    const cleanedProjection = await removePreviousProjection(deps.fs, projected.value, deleted, promoted);
    if (!cleanedProjection.ok) return cleanedProjection;
  }
  const cleanedArtifacts = await removeUnreferencedArtifacts(deps, deleted, survivors);
  if (!cleanedArtifacts.ok) return cleanedArtifacts;
  return ok({
    fingerprint: parsed.data.fingerprint,
    configId: parsed.data.configId,
    selectedConfigId: selectedConfigId.value,
  });
};

const requiredVariant = async (
  store: GlobalCatalogStore,
  fingerprint: string,
  configId: string,
): Promise<Result<CatalogVariant, AppError>> => {
  const variant = await store.getVariant(fingerprint, configId);
  if (!variant.ok) return variant;
  return variant.value === null ? variantNotFound(fingerprint, configId) : ok(variant.value);
};

const variantNotFound = <T>(fingerprint: string, configId: string): Result<T, AppError> => ({
  ok: false,
  error: appError('variant_not_found', `Analysis variant not found: ${fingerprint}/${configId}`),
});

const synchronizeSelectedVariantProjection = async (
  deps: VariantSelectionDeps,
  fingerprint: string,
  initialPrevious: CatalogVariant | null,
): Promise<Result<SelectVariantOutput, AppError>> => {
  let previous = initialPrevious;
  while (true) {
    const selectedConfigId = await deps.globalCatalog.getSelectedConfigId(fingerprint);
    if (!selectedConfigId.ok) return selectedConfigId;
    if (selectedConfigId.value === null) {
      return { ok: false, error: appError('internal', `Selected variant is unavailable: ${fingerprint}`) };
    }
    const selected = await requiredVariant(deps.globalCatalog, fingerprint, selectedConfigId.value);
    if (!selected.ok) return selected;
    const projected = await projectVariant(deps, selected.value);
    if (!projected.ok) {
      const latest = await deps.globalCatalog.getSelectedConfigId(fingerprint);
      if (!latest.ok) return latest;
      if (latest.value !== selected.value.configId) continue;
      return projected;
    }
    if (previous !== null && previous.configId !== selected.value.configId) {
      const cleaned = await removePreviousProjection(deps.fs, projected.value, previous, selected.value);
      if (!cleaned.ok) {
        const latest = await deps.globalCatalog.getSelectedConfigId(fingerprint);
        if (!latest.ok) return latest;
        if (latest.value !== selected.value.configId) {
          previous = selected.value;
          continue;
        }
        return cleaned;
      }
    }
    const latest = await deps.globalCatalog.getSelectedConfigId(fingerprint);
    if (!latest.ok) return latest;
    if (latest.value === selected.value.configId) {
      return ok({ fingerprint, configId: selected.value.configId });
    }
    previous = selected.value;
  }
};

const projectVariant = async (
  deps: VariantSelectionDeps,
  variant: CatalogVariant,
): Promise<Result<VariantProjectionContext, AppError>> => {
  const context = await projectionContext(deps, variant);
  if (!context.ok) return context;
  const source = await projectionSource(deps.fs, context.value.root, variant);
  if (!source.ok) return source;
  const projected = await materializeSelectedVariantProjection(
    deps.fs,
    context.value.root,
    context.value.videoPath,
    variant.finalName,
    source.value,
  );
  return projected.ok ? ok(context.value) : projected;
};

const projectionContext = async (
  deps: VariantSelectionDeps,
  variant: CatalogVariant,
): Promise<Result<VariantProjectionContext, AppError>> => {
  const file = await deps.globalCatalog.getFile(variant.fingerprint);
  if (!file.ok) return file;
  if (file.value === null) {
    return { ok: false, error: appError('not_found', `Catalog file not found: ${variant.fingerprint}`) };
  }
  const folder = await deps.globalCatalog.getFolder(file.value.folderId);
  if (!folder.ok) return folder;
  if (folder.value === null) {
    return { ok: false, error: appError('folder_not_found', `Catalog folder not found: ${file.value.folderId}`) };
  }
  const root = await discoverArtifactRoot(deps.fs, folder.value.currentPath);
  if (!root.ok) return root;
  return ok({
    file: file.value,
    folder: folder.value,
    root: root.value,
    videoPath: deps.fs.join(folder.value.currentPath, file.value.fileName),
  });
};

const projectionSource = async (
  fs: FileSystemPort,
  root: ArtifactRoot,
  variant: CatalogVariant,
): Promise<Result<SelectedVariantProjectionSource, AppError>> => {
  if (variant.descriptor !== null) {
    return selectedVariantProjectionSource(fs, variantArtifactPaths(fs, root, variant.fingerprint, variant.descriptor));
  }
  const output = variantOutputPaths(fs, root, variant.fingerprint, variant.configId);
  const debugLogPath = await optionalFile(fs, output.debugLogPath);
  if (!debugLogPath.ok) return debugLogPath;
  return ok({
    framesDirectory: null,
    transcriptPath: null,
    transcriptJsonPath: null,
    summaryPath: output.summaryPath,
    summaryJsonPath: output.summaryJsonPath,
    debugLogPath: debugLogPath.value,
  });
};

const selectedVariants = async (
  store: GlobalCatalogStore,
  fingerprints: readonly string[],
): Promise<Result<Map<string, CatalogVariant>, AppError>> => {
  const selected = new Map<string, CatalogVariant>();
  for (const fingerprint of fingerprints) {
    const configId = await store.getSelectedConfigId(fingerprint);
    if (!configId.ok) return configId;
    if (configId.value === null) continue;
    const variant = await store.getVariant(fingerprint, configId.value);
    if (!variant.ok) return variant;
    if (variant.value !== null) selected.set(fingerprint, variant.value);
  }
  return ok(selected);
};

const selectionChanges = (
  before: ReadonlyMap<string, CatalogVariant>,
  after: ReadonlyMap<string, CatalogVariant>,
): FolderSelectionChange[] => [...after.entries()].flatMap(([fingerprint, next]) => {
  const previous = before.get(fingerprint);
  return previous === undefined || previous.configId === next.configId ? [] : [{ before: previous, after: next }];
});

const rollbackFolderSelections = async (
  deps: VariantSelectionDeps,
  folderId: string,
  previousDefault: string | null,
  changes: readonly FolderSelectionChange[],
): Promise<void> => {
  await deps.globalCatalog.setFolderDefaultVariant(folderId, previousDefault);
  for (const change of changes) {
    const restored = await projectVariant(deps, change.before);
    if (restored.ok) await removePreviousProjection(deps.fs, restored.value, change.after, change.before);
  }
};

const resolvedFolderConfigIdentity = async (
  deps: FolderDefaultVariantDeps,
  folderPath: string,
): Promise<Result<ProcessConfigIdentity, AppError>> => {
  const resolved = await resolveProcessOptions(deps.config, folderPath, {
    videoPath: deps.fs.join(folderPath, 'variant-default.mp4'),
    frames: CONFIG_DEFAULTS.frames,
    skipRename: CONFIG_DEFAULTS.skip_rename,
    verbose: false,
    timeout: CONFIG_DEFAULTS.timeout,
    whisper: CONFIG_DEFAULTS.whisper_mode,
    whisperModel: CONFIG_DEFAULTS.whisper_model,
  });
  if (!resolved.ok) return resolved;
  const identity = processConfigIdentity(
    resolved.value,
    deps.analyzer.promptVersion(resolved.value.analyzer.provider),
  );
  return ok(identity);
};

const variantFingerprint = async (
  deps: VariantSelectionDeps,
  locator: VariantLocator,
): Promise<Result<string, AppError>> => {
  if (locator.fingerprint !== undefined) return ok(locator.fingerprint);
  if (locator.videoPath === undefined) return invalidVariantInput('Missing variant locator');
  const videoPath = deps.fs.resolve(locator.videoPath);
  const exists = await deps.fs.isFile(videoPath);
  if (!exists.ok) return exists;
  if (!exists.value) return { ok: false, error: appError('file_not_found', `File not found: ${videoPath}`) };
  const fingerprint = await deps.fs.partialContentHash(videoPath);
  if (!fingerprint.ok) return fingerprint;
  if (fingerprint.value === null) {
    return { ok: false, error: appError('video_not_found', `Video fingerprint is unavailable: ${videoPath}`) };
  }
  return ok(fingerprint.value);
};

const variantTarget = async (
  deps: VariantSelectionDeps,
  locator: VariantLocator,
): Promise<Result<{
  fingerprint: string;
  folderId: string;
  folderPath: string;
  videoPath: string;
}, AppError>> => {
  const fingerprint = await variantFingerprint(deps, locator);
  if (!fingerprint.ok) return fingerprint;
  const file = await deps.globalCatalog.getFile(fingerprint.value);
  if (!file.ok) return file;
  if (file.value === null && locator.videoPath === undefined) {
    return { ok: false, error: appError('video_not_found', `Catalog video not found: ${fingerprint.value}`) };
  }
  const folder = file.value === null ? ok(null) : await deps.globalCatalog.getFolder(file.value.folderId);
  if (!folder.ok) return folder;
  if (folder.value === null && locator.videoPath === undefined) {
    return { ok: false, error: appError('folder_not_found', `Catalog folder not found: ${file.value?.folderId ?? ''}`) };
  }
  const locatedVideoPath = locator.videoPath === undefined
    ? deps.fs.join(folder.value?.currentPath ?? '', file.value?.fileName ?? '')
    : deps.fs.resolve(locator.videoPath);
  const locatedFolderPath = deps.fs.dirname(locatedVideoPath);
  const marker = locator.videoPath === undefined ? ok(null) : await readFolderMarker(deps.fs, locatedFolderPath);
  if (!marker.ok) return marker;
  return ok({
    fingerprint: fingerprint.value,
    folderId: marker.value?.folderId ?? (
      locator.videoPath === undefined
        ? file.value?.folderId ?? derivedFolderId(deps.fs.resolve(locatedFolderPath))
        : derivedFolderId(deps.fs.resolve(locatedFolderPath))
    ),
    folderPath: locatedFolderPath,
    videoPath: locatedVideoPath,
  });
};

const selectedVariantConfigId = async (
  store: GlobalCatalogStore,
  fingerprint: string,
  variants: readonly CatalogVariant[],
  folderDefaultConfigId: string,
): Promise<Result<string | null, AppError>> => {
  const explicit = await store.getExplicitSelectedConfigId(fingerprint);
  if (!explicit.ok) return explicit;
  if (explicit.value !== null && variants.some((variant) => variant.configId === explicit.value)) {
    return ok(explicit.value);
  }
  if (variants.some((variant) => variant.configId === folderDefaultConfigId)) return ok(folderDefaultConfigId);
  return ok([...variants].sort(compareVariants)[0]?.configId ?? null);
};

const variantListItem = (
  fs: FileSystemPort,
  root: ArtifactRoot,
  variant: CatalogVariant,
  selectedConfigId: string | null,
): VariantListItem => {
  const output = variantOutputPaths(fs, root, variant.fingerprint, variant.configId);
  const shared = variant.descriptor === null
    ? null
    : sharedArtifactPaths(fs, root, variant.fingerprint, variant.descriptor);
  const estimatedCost = z.number().nonnegative().safeParse(variant.usage?.['estimatedCostUsd']);
  return {
    configId: variant.configId,
    descriptor: variant.descriptor,
    label: variantProvenanceLabel(variant),
    createdAt: variant.createdAt,
    analyzer: variant.analyzer,
    model: variant.model,
    usage: variant.usage,
    estimatedCostUsd: estimatedCost.success ? estimatedCost.data : null,
    artifacts: {
      framesDirectory: shared?.framesDirectory ?? null,
      transcriptPath: shared?.transcriptPath ?? null,
      summaryPath: output.summaryPath,
    },
    selected: selectedConfigId === variant.configId,
    finalName: variant.finalName,
    description: variant.description,
    transcript: variant.transcript,
    language: variant.language,
    tags: variant.tags,
  };
};

const removePreviousProjection = async (
  fs: FileSystemPort,
  context: VariantProjectionContext,
  previous: CatalogVariant,
  next: CatalogVariant,
): Promise<Result<void, AppError>> => {
  const previousPaths = artifactPaths(fs, context.root, context.videoPath, previous.finalName);
  const nextPaths = artifactPaths(fs, context.root, context.videoPath, next.finalName);
  if (previousPaths.summaryJsonPath === nextPaths.summaryJsonPath) return ok(undefined);
  for (const target of [
    previousPaths.framesDir,
    previousPaths.transcriptPath,
    previousPaths.transcriptJsonPath,
    previousPaths.summaryPath,
    previousPaths.summaryJsonPath,
    previousPaths.debugLogPath,
  ]) {
    const deleted = await fs.deletePath(target);
    if (!deleted.ok) return deleted;
  }
  return ok(undefined);
};

const removeUnreferencedArtifacts = async (
  deps: VariantSelectionDeps,
  deleted: CatalogVariant,
  survivors: readonly CatalogVariant[],
): Promise<Result<void, AppError>> => {
  const context = await projectionContext(deps, deleted);
  if (!context.ok) return context;
  const output = variantOutputPaths(deps.fs, context.value.root, deleted.fingerprint, deleted.configId);
  const removedOutput = await deps.fs.deletePath(output.directory);
  if (!removedOutput.ok) return removedOutput;
  if (deleted.descriptor === null) return ok(undefined);
  const shared = sharedArtifactPaths(deps.fs, context.value.root, deleted.fingerprint, deleted.descriptor);
  const survivorShared = survivors.flatMap((variant) => variant.descriptor === null
    ? []
    : [sharedArtifactPaths(deps.fs, context.value.root, variant.fingerprint, variant.descriptor)]);
  if (shared.framesDirectory !== null && !survivorShared.some((paths) => paths.framesKey === shared.framesKey)) {
    const removedFrames = await deps.fs.deletePath(shared.framesDirectory);
    if (!removedFrames.ok) return removedFrames;
  }
  if (!survivorShared.some((paths) => paths.transcriptKey === shared.transcriptKey)) {
    const removedTranscript = await deps.fs.deletePath(shared.transcriptPath);
    if (!removedTranscript.ok) return removedTranscript;
    const removedTranscriptJson = await deps.fs.deletePath(shared.transcriptJsonPath);
    if (!removedTranscriptJson.ok) return removedTranscriptJson;
  }
  return ok(undefined);
};

const optionalFile = async (fs: FileSystemPort, path: string): Promise<Result<string | null, AppError>> => {
  const exists = await fs.isFile(path);
  if (!exists.ok) return exists;
  return ok(exists.value ? path : null);
};

const compareVariants = (left: CatalogVariant, right: CatalogVariant): number =>
  right.createdAt.localeCompare(left.createdAt) || left.configId.localeCompare(right.configId);

const invalidVariantInput = <T>(details: unknown): Result<T, AppError> => ({
  ok: false,
  error: appError('validation', 'Invalid analysis variant input', details),
});
