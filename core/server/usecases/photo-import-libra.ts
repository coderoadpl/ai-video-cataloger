import {
  accuracyMForLibraConfidence,
  appError,
  buildImportedPhotoConfigDescriptor,
  canonicalJson,
  canonicalPath,
  FACE_ENGINE_VERSION,
  libraDescriptionEntrySchema,
  libraFaceEntrySchema,
  libraGeoEntrySchema,
  libraManifestEntrySchema,
  mapLibraGeoIntervalKind,
  mapLibraQuality,
  mapLibraScene,
  normalizeLibraPath,
  ok,
  parseLibraNdjson,
  photoConfigId,
  translateLibraFaceObsId,
  type AppError,
  type FaceObservation,
  type Result,
} from '@core/domain/index.js';

import {
  JOB_CANCELLED_ERROR_MESSAGE,
  type FileSystemPort,
  type GlobalCatalogStore,
  type JobExecutionContext,
  type JobsPort,
  type PhotosStore,
} from '../ports.js';

export interface PhotoImportLibraDeps {
  fs: FileSystemPort;
  photos: PhotosStore;
  globalCatalog: GlobalCatalogStore;
  jobs: JobsPort;
}

export type PhotoImportLibraPassDeps = Omit<PhotoImportLibraDeps, 'jobs'>;

export interface PhotoImportLibraInput {
  artifactsDir: string;
  manifestPath: string;
  dryRun: boolean;
}

export interface PhotoImportLibraArtifactCounts {
  entries: number;
  invalidLines: number;
}

export interface PhotoImportLibraSummary {
  media: 'photo';
  artifactsDir: string;
  manifestPath: string;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string | null;
  roots: number;
  manifest: PhotoImportLibraArtifactCounts & { matched: number; unmatched: number };
  descriptions: PhotoImportLibraArtifactCounts & { imported: number; unmatched: number };
  faces: PhotoImportLibraArtifactCounts & {
    imported: number;
    skippedIncomplete: number;
    unmatched: number;
    photosCompleted: number;
  };
  geo: PhotoImportLibraArtifactCounts & {
    written: number;
    unchanged: number;
    skippedPrecedence: number;
    skippedUnsupportedSource: number;
    unmatched: number;
  };
  elapsedMs: number;
}

// The imported variant must never win default selection over a live analysis run before or
// after the import — createdAt drives that fallback (resolveSelectedPhotoAnalysis), so this
// sentinel is deliberately older than any real analysis timestamp the app could ever produce.
const IMPORTED_PHOTO_VARIANT_CREATED_AT = new Date(0).toISOString();
const IMPORTED_PHOTO_VARIANT_LABEL = 'Imported (PHOTO LIBRA)';
const IMPORTED_PHOTO_VARIANT_LANGUAGE = 'pl';

export const photosImportLibra = async (
  deps: PhotoImportLibraDeps,
  input: PhotoImportLibraInput,
): Promise<Result<{ jobId: string }, AppError>> =>
  deps.jobs.enqueue({
    kind: 'photo_import_libra',
    payload: input,
    resourceKey: `photo-import-libra:${deps.fs.resolve(input.artifactsDir)}`,
    run: (context) => runPhotoImportLibra(deps, input, context),
  });

export const runPhotoImportLibra = async (
  deps: PhotoImportLibraPassDeps,
  input: PhotoImportLibraInput,
  progress?: JobExecutionContext,
): Promise<Result<PhotoImportLibraSummary, AppError>> => {
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();

  const manifestText = await deps.fs.readTextFile(input.manifestPath);
  if (!manifestText.ok) return manifestText;
  if (manifestText.value === null) {
    return { ok: false, error: appError('file_not_found', `Manifest not found: ${input.manifestPath}`) };
  }

  const rootsResult = await deps.photos.listRoots();
  if (!rootsResult.ok) return rootsResult;
  if (rootsResult.value.length === 0) {
    return {
      ok: false,
      error: appError('prerequisites_failed', 'No scanned photo roots found — run `photos scan` before importing PHOTO LIBRA artifacts'),
    };
  }
  const roots = rootsResult.value.map((root) => root.root);

  const summary: PhotoImportLibraSummary = {
    media: 'photo',
    artifactsDir: input.artifactsDir,
    manifestPath: input.manifestPath,
    dryRun: input.dryRun,
    startedAt,
    finishedAt: null,
    roots: roots.length,
    manifest: { entries: 0, invalidLines: 0, matched: 0, unmatched: 0 },
    descriptions: { entries: 0, invalidLines: 0, imported: 0, unmatched: 0 },
    faces: { entries: 0, invalidLines: 0, imported: 0, skippedIncomplete: 0, unmatched: 0, photosCompleted: 0 },
    geo: { entries: 0, invalidLines: 0, written: 0, unchanged: 0, skippedPrecedence: 0, skippedUnsupportedSource: 0, unmatched: 0 },
    elapsedMs: 0,
  };

  const manifestParsed = parseLibraNdjson(manifestText.value, libraManifestEntrySchema);
  summary.manifest.entries = manifestParsed.values.length;
  summary.manifest.invalidLines = manifestParsed.invalidLines;

  const started = await report(progress, {
    step: 'photo-import-libra-scanning',
    percentage: 0,
    total: manifestParsed.values.length,
    data: { artifactsDir: input.artifactsDir, manifestPath: input.manifestPath, manifestEntries: manifestParsed.values.length },
  });
  if (!started.ok) return started;

  const md5ToFingerprint = new Map<string, string>();
  const pathToMd5 = new Map<string, string>();
  for (const entry of manifestParsed.values) {
    const cancellation = cancelled(progress);
    if (!cancellation.ok) return cancellation;
    pathToMd5.set(normalizeLibraPath(entry.path), entry.md5);
    const fingerprint = await resolveFingerprintByLibraPath(deps, roots, entry.path);
    if (fingerprint === null) {
      summary.manifest.unmatched += 1;
      continue;
    }
    summary.manifest.matched += 1;
    md5ToFingerprint.set(entry.md5, fingerprint);
  }

  const descriptionsImported = await importDescriptions(deps, input, md5ToFingerprint, summary, progress);
  if (!descriptionsImported.ok) return descriptionsImported;

  const facesImported = await importFaces(deps, input, md5ToFingerprint, summary, progress);
  if (!facesImported.ok) return facesImported;

  const geoImported = await importGeo(deps, input, roots, pathToMd5, md5ToFingerprint, summary, progress);
  if (!geoImported.ok) return geoImported;

  summary.finishedAt = new Date().toISOString();
  summary.elapsedMs = Date.now() - startedAtMs;

  const done = await report(progress, { step: 'photo-import-libra-summary', percentage: 100, data: { ...summary } });
  if (!done.ok) return done;

  return ok(summary);
};

const importDescriptions = async (
  deps: PhotoImportLibraPassDeps,
  input: PhotoImportLibraInput,
  md5ToFingerprint: ReadonlyMap<string, string>,
  summary: PhotoImportLibraSummary,
  progress: JobExecutionContext | undefined,
): Promise<Result<void, AppError>> => {
  const path = deps.fs.join(input.artifactsDir, 'descriptions.ndjson');
  const text = await deps.fs.readTextFile(path);
  if (!text.ok) return text;
  if (text.value === null) return ok(undefined);

  const parsed = parseLibraNdjson(text.value, libraDescriptionEntrySchema);
  summary.descriptions.entries = parsed.values.length;
  summary.descriptions.invalidLines = parsed.invalidLines;
  if (parsed.values.length === 0) return ok(undefined);

  const descriptor = buildImportedPhotoConfigDescriptor();
  const configId = photoConfigId(descriptor);

  if (!input.dryRun) {
    const upserted = await deps.photos.upsertAnalysisConfig({
      configId,
      descriptorJson: canonicalJson(descriptor),
      label: IMPORTED_PHOTO_VARIANT_LABEL,
      now: IMPORTED_PHOTO_VARIANT_CREATED_AT,
    });
    if (!upserted.ok) return upserted;
  }

  for (const entry of parsed.values) {
    const cancellation = cancelled(progress);
    if (!cancellation.ok) return cancellation;
    const fingerprint = md5ToFingerprint.get(entry.md5);
    if (fingerprint === undefined) {
      summary.descriptions.unmatched += 1;
      continue;
    }
    summary.descriptions.imported += 1;
    if (input.dryRun) continue;
    const recorded = await deps.photos.recordPhotoAnalysis({
      fingerprint,
      configId,
      description: entry.descPl,
      scene: mapLibraScene(entry.scene),
      quality: mapLibraQuality(entry.quality),
      language: IMPORTED_PHOTO_VARIANT_LANGUAGE,
      analyzer: 'imported',
      model: null,
      batchSize: 1,
      usageJson: null,
      tags: entry.tags,
      createdAt: IMPORTED_PHOTO_VARIANT_CREATED_AT,
    });
    if (!recorded.ok) return recorded;
  }
  return ok(undefined);
};

const importFaces = async (
  deps: PhotoImportLibraPassDeps,
  input: PhotoImportLibraInput,
  md5ToFingerprint: ReadonlyMap<string, string>,
  summary: PhotoImportLibraSummary,
  progress: JobExecutionContext | undefined,
): Promise<Result<void, AppError>> => {
  const path = deps.fs.join(input.artifactsDir, 'faces.ndjson');
  const text = await deps.fs.readTextFile(path);
  if (!text.ok) return text;
  if (text.value === null) return ok(undefined);

  const parsed = parseLibraNdjson(text.value, libraFaceEntrySchema);
  summary.faces.entries = parsed.values.length;
  summary.faces.invalidLines = parsed.invalidLines;

  const completedFingerprints = new Set<string>();

  for (const entry of parsed.values) {
    const cancellation = cancelled(progress);
    if (!cancellation.ok) return cancellation;
    const fingerprint = md5ToFingerprint.get(entry.md5);
    if (fingerprint === undefined) {
      summary.faces.unmatched += 1;
      continue;
    }
    completedFingerprints.add(fingerprint);
    if (entry.obsId === null) continue;
    if (entry.bbox === undefined || entry.embedding === undefined) {
      summary.faces.skippedIncomplete += 1;
      continue;
    }
    const obsId = translateLibraFaceObsId(fingerprint, entry.obsId);
    if (obsId === null) {
      summary.faces.skippedIncomplete += 1;
      continue;
    }
    summary.faces.imported += 1;
    if (input.dryRun) continue;
    const observation: FaceObservation = {
      obsId,
      fingerprint,
      kind: 'face',
      frameTsS: 0,
      bbox: entry.bbox,
      embedding: entry.embedding,
      quality: entry.score ?? 0,
      personId: null,
      cropPath: null,
      media: 'photo',
    };
    const upserted = await deps.globalCatalog.upsertFaceObservation(observation);
    if (!upserted.ok) return upserted;
  }

  summary.faces.photosCompleted = completedFingerprints.size;
  if (!input.dryRun) {
    for (const fingerprint of completedFingerprints) {
      const completed = await deps.photos.completePhotoFaceIndex(fingerprint, FACE_ENGINE_VERSION);
      if (!completed.ok) return completed;
    }
  }
  return ok(undefined);
};

const importGeo = async (
  deps: PhotoImportLibraPassDeps,
  input: PhotoImportLibraInput,
  roots: readonly string[],
  pathToMd5: ReadonlyMap<string, string>,
  md5ToFingerprint: ReadonlyMap<string, string>,
  summary: PhotoImportLibraSummary,
  progress: JobExecutionContext | undefined,
): Promise<Result<void, AppError>> => {
  const path = deps.fs.join(input.artifactsDir, 'geo.ndjson');
  const text = await deps.fs.readTextFile(path);
  if (!text.ok) return text;
  if (text.value === null) return ok(undefined);

  const parsed = parseLibraNdjson(text.value, libraGeoEntrySchema);
  summary.geo.entries = parsed.values.length;
  summary.geo.invalidLines = parsed.invalidLines;

  for (const entry of parsed.values) {
    const cancellation = cancelled(progress);
    if (!cancellation.ok) return cancellation;

    const intervalKind = mapLibraGeoIntervalKind(entry.source);
    const accuracyM = accuracyMForLibraConfidence(entry.confidence);
    if (entry.lat === null || entry.lon === null || intervalKind === null || accuracyM === null) {
      summary.geo.skippedUnsupportedSource += 1;
      continue;
    }

    const md5 = pathToMd5.get(normalizeLibraPath(entry.path));
    const manifestFingerprint = md5 === undefined ? undefined : md5ToFingerprint.get(md5);
    const fingerprint = manifestFingerprint ?? await resolveFingerprintByLibraPath(deps, roots, entry.path);
    if (fingerprint === null) {
      summary.geo.unmatched += 1;
      continue;
    }

    if (input.dryRun) {
      summary.geo.written += 1;
      continue;
    }

    const applied = await deps.photos.applyPhotoGeoBackfill({
      fingerprint,
      location: {
        lat: entry.lat,
        lon: entry.lon,
        source: 'timeline',
        accuracyM,
        intervalKind,
        resolvedAt: new Date().toISOString(),
      },
    });
    if (!applied.ok) return applied;
    if (applied.value === 'written') summary.geo.written += 1;
    else if (applied.value === 'unchanged') summary.geo.unchanged += 1;
    else summary.geo.skippedPrecedence += 1;
  }
  return ok(undefined);
};

const resolveFingerprintByLibraPath = async (
  deps: PhotoImportLibraPassDeps,
  roots: readonly string[],
  libraPath: string,
): Promise<string | null> => {
  const relative = normalizeLibraPath(libraPath);
  for (const root of roots) {
    const candidate = canonicalPath(deps.fs.join(root, relative));
    const sighting = await deps.photos.getSightingByPath(candidate);
    if (sighting.ok && sighting.value !== null) return sighting.value.fingerprint;
  }
  return null;
};

const report = (
  progress: JobExecutionContext | undefined,
  progressInput: {
    step: 'photo-import-libra-scanning' | 'photo-import-libra-summary';
    percentage?: number;
    total?: number;
    data?: Record<string, unknown>;
  },
): Promise<Result<void, AppError>> =>
  progress === undefined ? Promise.resolve(ok(undefined)) : progress.reportProgress(progressInput);

const cancelled = (progress: JobExecutionContext | undefined): Result<void, AppError> => {
  if (progress === undefined || !progress.signal.aborted) return ok(undefined);
  return { ok: false, error: appError('processing_error', JOB_CANCELLED_ERROR_MESSAGE) };
};
