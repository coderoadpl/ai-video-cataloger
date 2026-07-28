import { z } from 'zod';

import {
  CONFIG_DEFAULTS,
  appError,
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
} from '../ports.js';
import { discoverArtifactRoot, type ArtifactRoot } from './artifact-root.js';
import {
  materializeSelectedVariantProjection,
  selectedVariantProjectionSource,
  sharedArtifactPaths,
  variantArtifactPaths,
  variantOutputPaths,
  type SelectedVariantProjectionSource,
} from './artifact-store.js';
import { resolveFolderIntoIndex } from './catalog-index.js';
import { processConfigIdentity, resolveProcessOptions } from './process.js';
import { artifactPaths } from './shared.js';

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
  const fallback = parsed.data.configId === null
    ? await resolvedFolderConfigId(deps, folderPath)
    : ok(parsed.data.configId);
  if (!fallback.ok) return fallback;
  const stored = await deps.globalCatalog.setFolderDefaultVariant(folderId, fallback.value);
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
    resolvedConfigId: fallback.value,
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

const resolvedFolderConfigId = async (
  deps: FolderDefaultVariantDeps,
  folderPath: string,
): Promise<Result<string, AppError>> => {
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
  return ok(identity.configId);
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
