import { z } from 'zod';

import {
  ANALYZER_BACKENDS,
  CAPTURED_AT_SOURCES,
  CONFIG_DEFAULTS,
  ERROR_CODES,
  FILE_ARTIFACT_IDS,
  LOCAL_AI_MODEL_TAGS,
  LOCAL_AI_SUPPORT_LEVELS,
  TAG_ALIAS_RULES,
  VIDEO_STATUSES,
  WHISPER_MODEL_NAMES,
  WHISPER_MODES,
  analyzerProviderConfigSchema,
  analyzerProviderDescriptorSchema,
  analyzerProviderFamilySchema,
  analyzerProviderIdSchema,
  backupIndicatorStateSchema,
  backupPhaseSchema,
  backupSchemaVersionsSchema,
  backupProviderSchema,
  backupTierSchema,
  configDescriptorSchema,
  configKeySchema,
  canonicalPath,
  catalogPlaceSchema,
  credentialDeletionSchema,
  credentialsBackendStatusSchema,
  folderIdSchema,
  geminiCostEstimateSchema,
  photoExtensionSchema,
  photoFingerprintSchema,
  remoteBackupSchema,
  videoStatusSchema,
  whisperLanguageSchema,
  whisperEngineSchema,
} from '@core/domain/index.js';

export const healthOutputSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
});

export const healthLiveOutputSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
});

export const readyCheckSchema = z.object({
  name: z.enum(['catalog', 'lock', 'provider_config']),
  ok: z.boolean(),
  detail: z.string(),
});

export const healthReadyOutputSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  checks: z.array(readyCheckSchema),
});

const canonicalPathString = () => z.string().min(1).transform(canonicalPath);

const emptyInputSchema = z.object({});
const folderInputSchema = z.object({ folder: canonicalPathString() });
const optionalFolderInputSchema = z.object({ folder: canonicalPathString().optional() });
const videoPathInputSchema = z.object({ videoPath: canonicalPathString() });
const forceInputSchema = z.object({ force: z.boolean().default(false) });
const jobIdInputSchema = z.object({ jobId: z.string().min(1) });
const configIdString = () => z.string().regex(/^cfg_[0-9a-f]{12}$/);
const configIdSchema = z.union([z.literal('legacy'), configIdString()]);
const queryInteger = (fallback: number, min: number, max: number) =>
  z.preprocess(
    (value) => typeof value === 'string' && value.length > 0 ? Number.parseInt(value, 10) : value,
    z.number().int().min(min).max(max).default(fallback),
  );
const queryBoolean = z.preprocess(
  (value) => value === 'true' ? true : value === 'false' ? false : value,
  z.boolean().default(false),
);
const scanInputSchema = folderInputSchema.extend({ cached: queryBoolean });

export const summarySchema = z.object({
  schemaVersion: z.literal(1),
  description: z.string(),
  suggestedFilename: z.string(),
  fullAnalysis: z.string(),
  tags: z.array(z.string()).default([]),
  analyzedAt: z.string(),
  costEstimate: geminiCostEstimateSchema.optional(),
});

export const transcriptSegmentSchema = z.object({
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  text: z.string(),
});

export const scanVideoArtifactsSchema = z.object({
  framePaths: z.array(z.string()).nullable(),
  transcriptContent: z.string().nullable(),
  transcriptPath: z.string().nullable(),
  transcriptSegments: z.array(transcriptSegmentSchema).nullable().optional(),
  summary: summarySchema.nullable(),
  summaryPath: z.string().nullable(),
  thumbnailPath: z.string().nullable(),
  thumbnailMtime: z.number().nullable(),
  newFilename: z.string().nullable(),
});

export const scanVideoSchema = z.object({
  path: z.string(),
  filename: z.string(),
  size: z.number().int().nonnegative(),
  sizeFormatted: z.string(),
  duration: z.number().nullable(),
  durationFormatted: z.string().nullable(),
  status: z.union([videoStatusSchema, z.literal('not_tracked')]),
  errorMessage: z.string().nullable().optional(),
  contentHash: z.string().nullable(),
  duplicate: z.object({ canonicalPath: z.string() }).nullable().optional(),
  source: z.object({
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    rotation: z.number().nullable(),
  }).optional(),
  artifacts: scanVideoArtifactsSchema,
});

export const scanOutputSchema = z.object({
  folder: z.string(),
  databasePath: z.string().nullable(),
  videos: z.array(scanVideoSchema),
  summary: z.object({
    total: z.number().int().nonnegative(),
    tracked: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    inProgress: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
    notTracked: z.number().int().nonnegative(),
  }),
});

export const catalogTreeFolderSchema = z.object({
  path: z.string(),
  name: z.string(),
  relativePath: z.string(),
  depth: z.number().int().nonnegative(),
  videoCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative().nullable(),
  processedCount: z.number().int().nonnegative().nullable(),
});

export const catalogTreeOutputSchema = z.object({
  root: z.string(),
  folders: z.array(catalogTreeFolderSchema),
  pendingTotal: z.number().int().nonnegative(),
  processedTotal: z.number().int().nonnegative(),
  videoTotal: z.number().int().nonnegative(),
  hasUnknownPending: z.boolean(),
});

export const catalogTreeFolderOutputSchema = z.object({
  videos: z.array(scanVideoSchema),
});

export const catalogLockInfoSchema = z.object({
  pid: z.number().int().positive(),
  processName: z.enum(['gui', 'cli']),
  startedAt: z.string().min(1),
  hostname: z.string().min(1),
});

export const catalogLockOutputSchema = z.object({
  writable: z.boolean(),
  owner: catalogLockInfoSchema.nullable(),
  blockedBy: catalogLockInfoSchema.nullable(),
  warnings: z.array(z.string()),
});

export const catalogFolderRecordSchema = z.object({
  fingerprint: z.string().min(1),
  fileName: z.string(),
  finalName: z.string().nullable(),
  missing: z.boolean(),
  missingAt: z.number().nullable(),
});

export const catalogFolderOutputSchema = z.object({
  records: z.array(catalogFolderRecordSchema),
});

export const catalogTreeAbsentGroupSchema = z.object({
  folderPath: z.string().min(1),
  entries: z.array(catalogFolderRecordSchema),
});

export const catalogTreeAbsentOutputSchema = z.object({
  groups: z.array(catalogTreeAbsentGroupSchema),
});

export const processInputSchema = videoPathInputSchema.extend({
  frames: z.number().int().optional(),
  framesExplicit: z.boolean().optional(),
  skipRename: z.boolean().optional(),
  skipRenameExplicit: z.boolean().optional(),
  verbose: z.boolean().default(false),
  timeout: z.number().int().optional(),
  timeoutExplicit: z.boolean().optional(),
  whisper: z.enum(WHISPER_MODES).optional(),
  whisperExplicit: z.boolean().optional(),
  whisperModel: z.enum(WHISPER_MODEL_NAMES).optional(),
  whisperModelExplicit: z.boolean().optional(),
  whisperLanguage: whisperLanguageSchema.optional(),
  whisperLanguageExplicit: z.boolean().optional(),
  analyzer: z.enum([...ANALYZER_BACKENDS, 'api']).optional(),
  provider: analyzerProviderIdSchema.optional(),
  localModel: z.string().min(1).optional(),
  force: z.boolean().optional(),
  batch: z.object({ current: z.number().int().positive(), total: z.number().int().positive() }).optional(),
}).transform((input) => ({
  videoPath: input.videoPath,
  frames: input.frames ?? CONFIG_DEFAULTS.frames,
  framesExplicit: input.framesExplicit ?? input.frames !== undefined,
  skipRename: input.skipRename ?? CONFIG_DEFAULTS.skip_rename,
  skipRenameExplicit: input.skipRenameExplicit ?? input.skipRename !== undefined,
  verbose: input.verbose,
  timeout: input.timeout ?? CONFIG_DEFAULTS.timeout,
  timeoutExplicit: input.timeoutExplicit ?? input.timeout !== undefined,
  whisper: input.whisper ?? CONFIG_DEFAULTS.whisper_mode,
  whisperExplicit: input.whisperExplicit ?? input.whisper !== undefined,
  whisperModel: input.whisperModel ?? CONFIG_DEFAULTS.whisper_model,
  whisperModelExplicit: input.whisperModelExplicit ?? input.whisperModel !== undefined,
  whisperLanguage: input.whisperLanguage ?? CONFIG_DEFAULTS.whisper_language,
  whisperLanguageExplicit: input.whisperLanguageExplicit ?? input.whisperLanguage !== undefined,
  ...(input.analyzer === undefined ? {} : { analyzer: input.analyzer }),
  ...(input.provider === undefined ? {} : { provider: input.provider }),
  ...(input.localModel === undefined ? {} : { localModel: input.localModel }),
  ...(input.force === undefined ? {} : { force: input.force }),
  ...(input.batch === undefined ? {} : { batch: input.batch }),
}));

export const processDriveInputSchema = z.object({
  root: canonicalPathString(),
  frames: z.number().int().optional(),
  framesExplicit: z.boolean().optional(),
  skipRename: z.boolean().optional(),
  skipRenameExplicit: z.boolean().optional(),
  verbose: z.boolean().default(false),
  timeout: z.number().int().optional(),
  timeoutExplicit: z.boolean().optional(),
  whisper: z.enum(WHISPER_MODES).optional(),
  whisperExplicit: z.boolean().optional(),
  whisperModel: z.enum(WHISPER_MODEL_NAMES).optional(),
  whisperModelExplicit: z.boolean().optional(),
  whisperLanguage: whisperLanguageSchema.optional(),
  whisperLanguageExplicit: z.boolean().optional(),
  analyzer: z.enum([...ANALYZER_BACKENDS, 'api']).optional(),
  provider: analyzerProviderIdSchema.optional(),
  localModel: z.string().min(1).optional(),
  force: z.boolean().optional(),
  skipDuplicates: z.boolean().optional(),
  geminiBatch: z.boolean().optional(),
  geminiBatchExplicit: z.boolean().optional(),
  skipFaces: z.boolean().optional(),
}).transform((input) => ({
  root: input.root,
  frames: input.frames ?? CONFIG_DEFAULTS.frames,
  framesExplicit: input.framesExplicit ?? input.frames !== undefined,
  skipRename: input.skipRename ?? CONFIG_DEFAULTS.skip_rename,
  skipRenameExplicit: input.skipRenameExplicit ?? input.skipRename !== undefined,
  verbose: input.verbose,
  timeout: input.timeout ?? CONFIG_DEFAULTS.timeout,
  timeoutExplicit: input.timeoutExplicit ?? input.timeout !== undefined,
  whisper: input.whisper ?? CONFIG_DEFAULTS.whisper_mode,
  whisperExplicit: input.whisperExplicit ?? input.whisper !== undefined,
  whisperModel: input.whisperModel ?? CONFIG_DEFAULTS.whisper_model,
  whisperModelExplicit: input.whisperModelExplicit ?? input.whisperModel !== undefined,
  whisperLanguage: input.whisperLanguage ?? CONFIG_DEFAULTS.whisper_language,
  whisperLanguageExplicit: input.whisperLanguageExplicit ?? input.whisperLanguage !== undefined,
  ...(input.analyzer === undefined ? {} : { analyzer: input.analyzer }),
  ...(input.provider === undefined ? {} : { provider: input.provider }),
  ...(input.localModel === undefined ? {} : { localModel: input.localModel }),
  ...(input.force === undefined ? {} : { force: input.force }),
  ...(input.skipDuplicates === undefined ? {} : { skipDuplicates: input.skipDuplicates }),
  ...(input.geminiBatch === undefined ? {} : { geminiBatch: input.geminiBatch }),
  geminiBatchExplicit: input.geminiBatchExplicit ?? input.geminiBatch !== undefined,
  ...(input.skipFaces === undefined ? {} : { skipFaces: input.skipFaces }),
}));

export const jobAcceptedOutputSchema = z.object({
  jobId: z.string(),
});

export const backupListInputSchema = z.object({
  tier: backupTierSchema.nullable().default(null),
});

export const backupListOutputSchema = z.object({
  backups: z.array(remoteBackupSchema),
});

export const backupRestoreInputSchema = z.object({
  remoteId: z.string().min(1),
  recoveryKey: z.string().min(1).optional(),
});

export const backupRestoreOutputSchema = z.object({
  restored: remoteBackupSchema,
  relaunchRequired: z.literal(true),
  preRestoreDirectory: z.string().min(1),
});

export const backupRunInputSchema = z.object({
  tier: backupTierSchema.default('critical'),
});

export const backupConnectionSchema = z.object({
  accountEmail: z.string().nullable(),
  driveName: z.string().nullable(),
  folderName: z.string(),
  remainingQuotaBytes: z.number().int().nonnegative().nullable(),
});

export const backupConnectInputSchema = z.object({
  provider: backupProviderSchema,
  keyJson: z.string().min(1).nullable().default(null),
  sharedDriveId: z.string().min(1).nullable().default(null),
});

export const backupConnectOutputSchema = z.object({
  provider: backupProviderSchema,
  connection: backupConnectionSchema,
  serviceAccountFingerprint: z.string().nullable(),
});

export const backupTestInputSchema = z.object({});

export const backupTestOutputSchema = z.object({
  connection: backupConnectionSchema,
});

export const backupEnableInputSchema = z.object({
  includeOptional: z.boolean().default(false),
  keepLast: z.number().int().min(1).max(90).default(CONFIG_DEFAULTS.backup_keep_last),
  keepWeekly: z.number().int().min(0).max(52).default(CONFIG_DEFAULTS.backup_keep_weekly),
  runFirstBackup: z.boolean().default(true),
  acknowledgeUnreadableArchives: z.boolean().default(false),
});

export const backupEnableOutputSchema = z.object({
  enabled: z.literal(true),
  jobId: z.string().min(1).nullable(),
});

export const backupDisableInputSchema = z.object({
  purgeCredentials: z.boolean().default(false),
});

export const backupDisableOutputSchema = z.object({
  enabled: z.literal(false),
});

export const backupRecoveryKeyExportInputSchema = z.object({});

export const backupRecoveryKeyExportOutputSchema = z.object({
  fingerprint: z.string().min(1),
  path: z.string().min(1),
});

export const backupRecoveryKeyImportInputSchema = z.object({
  recoveryKey: z.string().min(1),
});

export const backupRecoveryKeyImportOutputSchema = z.object({
  fingerprint: z.string().min(1),
});

export const backupConnectCancelInputSchema = z.object({});

export const backupConnectCancelOutputSchema = z.object({
  cancelled: z.boolean(),
});

export const backupRecoveryKeyConfirmInputSchema = z.object({});

export const backupRecoveryKeyConfirmOutputSchema = z.object({
  confirmed: z.literal(true),
});

const queryFlag = z.preprocess((value) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}, z.boolean().default(false));

export const backupStatusInputSchema = z.object({
  testConnection: queryFlag,
});

export const backupStatusOutputSchema = z.object({
  enabled: z.boolean(),
  provider: backupProviderSchema,
  connected: z.boolean(),
  accountEmail: z.string().nullable(),
  serviceAccountFingerprint: z.string().nullable(),
  sharedDriveId: z.string().nullable(),
  folderName: z.string(),
  includeOptional: z.boolean(),
  keepLast: z.number().int(),
  keepWeekly: z.number().int(),
  indicator: backupIndicatorStateSchema,
  phase: backupPhaseSchema,
  percentage: z.number().int().min(0).max(100).nullable(),
  activeJobId: z.string().nullable(),
  lastSuccessAt: z.iso.datetime().nullable(),
  lastArchiveName: z.string().nullable(),
  lastErrorCode: z.enum(ERROR_CODES).nullable(),
  lastRestoreAt: z.iso.datetime().nullable(),
  nextDueAt: z.iso.datetime().nullable(),
  supportedSchemaVersions: backupSchemaVersionsSchema,
  connection: backupConnectionSchema.nullable(),
  recoveryKeyStored: z.boolean(),
});

export const processCompletedOutputSchema = z.object({
  video: z.string(),
  path: z.string(),
  status: z.literal('completed'),
  configId: configIdString(),
  selectedConfigId: z.string().min(1),
  costEstimate: geminiCostEstimateSchema.optional(),
});

export const driveRunFailureSchema = z.object({
  path: z.string().min(1),
  scope: z.enum(['folder', 'file']),
  code: z.enum(ERROR_CODES),
  message: z.string(),
});

export const driveRunFacesSchema = z.object({
  ran: z.boolean(),
  skippedReason: z.enum(['flag', 'artifacts_missing', 'unavailable', 'cancelled', 'failed']).nullable(),
  filesIndexed: z.number().int().nonnegative(),
  observationsAdded: z.number().int().nonnegative(),
  rejectedLowQuality: z.number().int().nonnegative().default(0),
  peopleCreated: z.number().int().nonnegative(),
  filesFailed: z.number().int().nonnegative().default(0),
  failureCodes: z.array(z.object({ code: z.enum(ERROR_CODES), count: z.number().int().positive() })).default([]),
  aborted: z.boolean().default(false),
  error: z.object({ code: z.enum(ERROR_CODES), message: z.string() }).nullable(),
});

export const driveRunSummarySchema = z.object({
  runId: z.string().min(1),
  root: z.string().min(1),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  foldersTotal: z.number().int().nonnegative(),
  foldersDone: z.number().int().nonnegative(),
  filesTotal: z.number().int().nonnegative(),
  filesDone: z.number().int().nonnegative(),
  filesSkipped: z.number().int().nonnegative(),
  filesDuplicateSkipped: z.number().int().nonnegative().default(0),
  filesFailed: z.number().int().nonnegative(),
  costEstimate: z.object({
    kind: z.literal('estimate'),
    currency: z.literal('USD'),
    files: z.number().int().nonnegative(),
    estimatedCostUsd: z.number().nonnegative(),
  }).optional(),
  faces: driveRunFacesSchema.optional(),
  snapshotSkipped: z.number().int().nonnegative().default(0),
  elapsedMs: z.number().int().nonnegative(),
  failures: z.array(driveRunFailureSchema),
});

export const materializeInputSchema = z.object({
  root: canonicalPathString(),
  dryRun: z.boolean().default(false),
});

export const materializeSummarySchema = z.object({
  root: z.string().min(1),
  dryRun: z.boolean(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  foldersTotal: z.number().int().nonnegative(),
  foldersDone: z.number().int().nonnegative(),
  foldersNotWritable: z.number().int().nonnegative(),
  filesTotal: z.number().int().nonnegative(),
  filesMaterialized: z.number().int().nonnegative(),
  filesUnchanged: z.number().int().nonnegative(),
  filesSkipped: z.number().int().nonnegative(),
  filesFailed: z.number().int().nonnegative(),
  collisions: z.number().int().nonnegative(),
  skipped: z.object({
    notInCatalog: z.number().int().nonnegative(),
    noVariant: z.number().int().nonnegative(),
    noFinalName: z.number().int().nonnegative(),
    fingerprintUnavailable: z.number().int().nonnegative(),
    duplicate: z.number().int().nonnegative(),
  }),
  elapsedMs: z.number().int().nonnegative(),
  failures: z.array(driveRunFailureSchema),
});

export const photosScanInputSchema = z.object({
  root: canonicalPathString(),
});

export const photoScanSummarySchema = z.object({
  media: z.literal('photo'),
  root: z.string(),
  runId: z.string(),
  filesTotal: z.number(),
  photosNew: z.number(),
  photosUpdated: z.number(),
  pathsSeen: z.number(),
  skippedUnchanged: z.number(),
  readFailed: z.number(),
  exifRead: z.number(),
  exifFailed: z.number(),
  missingMarked: z.number(),
  folderReadErrors: z.number(),
  proxies: z.object({
    ran: z.boolean(),
    generated: z.number(),
    skippedExisting: z.number(),
    failed: z.number(),
    skippedReason: z.string().nullable(),
  }),
});

export const photosStatusInputSchema = z.object({
  root: canonicalPathString().optional(),
});

export const photosStatusOutputSchema = z.object({
  media: z.literal('photo'),
  root: z.string().nullable(),
  counts: z.object({
    photos: z.number(),
    paths: z.number(),
    exifRead: z.number(),
    exifFailed: z.number(),
    missing: z.number(),
    duplicates: z.number(),
    proxied: z.number(),
    proxyFailed: z.number(),
    analysed: z.number(),
    facesIndexed: z.number(),
  }),
});

export const photosForgetInputSchema = z.object({
  root: canonicalPathString(),
});

export const photosForgetOutputSchema = z.object({
  media: z.literal('photo'),
  root: z.string(),
  pathsRemoved: z.number(),
  photosDeleted: z.number(),
  photosRepointed: z.number(),
  artifactPaths: z.array(z.string()),
});

export const photoProxiesInputSchema = z.object({
  root: canonicalPathString(),
  force: z.boolean().optional().default(false),
});

export const photoGridThumbsInputSchema = z.object({
  force: z.boolean().optional().default(false),
});

export const photoGridThumbsSummarySchema = z.object({
  media: z.literal('photo'),
  force: z.boolean(),
  candidates: z.number().int().nonnegative(),
  generated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export const photoProxiesSummarySchema = z.object({
  media: z.literal('photo'),
  root: z.string(),
  force: z.boolean(),
  candidates: z.number(),
  generated: z.number(),
  skippedExisting: z.number(),
  failed: z.number(),
  thumbFailed: z.number(),
  gridFailed: z.number().int().nonnegative().default(0),
});

export const photosProcessInputSchema = z.object({
  root: canonicalPathString().optional(),
  force: z.boolean().optional().default(false),
  batchSize: z.number().int().min(1).max(12).optional(),
  fingerprints: z.array(z.string().min(1)).optional(),
});

export const photoProcessSummarySchema = z.object({
  media: z.literal('photo'),
  root: z.string().nullable(),
  force: z.boolean(),
  configId: z.string().nullable(),
  batchSize: z.number(),
  candidates: z.number(),
  analysed: z.number(),
  failed: z.number(),
  skippedExisting: z.number(),
  splitRetries: z.number(),
});

export const photoGpsBackfillInputSchema = z.object({
  timelinePath: z.string().min(1),
  root: canonicalPathString().optional(),
  dryRun: z.boolean().default(false),
  toleranceMinutes: z.number().int().min(0).max(240).default(30),
  maxVisitHours: z.number().int().min(1).max(720).default(36),
  reresolvePlaces: z.boolean().default(false),
});

export const photoGpsBackfillSummarySchema = z.object({
  media: z.literal('photo'),
  timelinePath: z.string().min(1),
  dryRun: z.boolean(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  timeline: z.object({
    entries: z.number().int().nonnegative(),
    entriesSkipped: z.number().int().nonnegative(),
    entriesIgnored: z.number().int().nonnegative(),
    intervals: z.number().int().nonnegative(),
    firstStart: z.string().nullable(),
    lastEnd: z.string().nullable(),
  }),
  photosTotal: z.number().int().nonnegative(),
  photosConsidered: z.number().int().nonnegative(),
  matched: z.object({
    visit: z.number().int().nonnegative(),
    activity: z.number().int().nonnegative(),
    path: z.number().int().nonnegative(),
  }),
  matchedWithinTolerance: z.number().int().nonnegative(),
  assumedWidened: z.number().int().nonnegative(),
  written: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  unmatched: z.number().int().nonnegative(),
  skipped: z.object({
    cameraGps: z.number().int().nonnegative(),
    manualGps: z.number().int().nonnegative(),
    noCapturedAt: z.number().int().nonnegative(),
  }),
  accuracy: z.object({
    buckets: z.array(z.object({ upToM: z.number().nonnegative().nullable(), files: z.number().int().nonnegative() })),
    medianM: z.number().nonnegative().nullable(),
    p90M: z.number().nonnegative().nullable(),
  }),
  places: z.object({
    datasetId: z.string().nullable(),
    resolved: z.number().int().nonnegative(),
    unresolved: z.number().int().nonnegative(),
    skippedNoDataset: z.number().int().nonnegative(),
  }),
  elapsedMs: z.number().int().nonnegative(),
});

export const photoImportLibraInputSchema = z.object({
  artifactsDir: z.string().min(1),
  manifestPath: z.string().min(1),
  dryRun: z.boolean().default(false),
});

const photoImportLibraArtifactCountsSchema = z.object({
  entries: z.number().int().nonnegative(),
  invalidLines: z.number().int().nonnegative(),
});

export const photoImportLibraSummarySchema = z.object({
  media: z.literal('photo'),
  artifactsDir: z.string().min(1),
  manifestPath: z.string().min(1),
  dryRun: z.boolean(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  roots: z.number().int().nonnegative(),
  manifest: photoImportLibraArtifactCountsSchema.extend({
    matched: z.number().int().nonnegative(),
    unmatched: z.number().int().nonnegative(),
  }),
  descriptions: photoImportLibraArtifactCountsSchema.extend({
    imported: z.number().int().nonnegative(),
    unmatched: z.number().int().nonnegative(),
  }),
  faces: photoImportLibraArtifactCountsSchema.extend({
    imported: z.number().int().nonnegative(),
    skippedIncomplete: z.number().int().nonnegative(),
    unmatched: z.number().int().nonnegative(),
    photosCompleted: z.number().int().nonnegative(),
  }),
  geo: photoImportLibraArtifactCountsSchema.extend({
    written: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    skippedPrecedence: z.number().int().nonnegative(),
    skippedUnsupportedSource: z.number().int().nonnegative(),
    unmatched: z.number().int().nonnegative(),
  }),
  elapsedMs: z.number().int().nonnegative(),
});

export const photoAnalysisErrorSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  createdAt: z.string(),
});

export const photoListItemSchema = z.object({
  fingerprint: z.string(),
  fileName: z.string(),
  currentPath: z.string(),
  ext: photoExtensionSchema,
  capturedAt: z.string().nullable(),
  capturedAtSource: z.enum(CAPTURED_AT_SOURCES).nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  proxyState: z.enum(['pending', 'done', 'failed', 'not_needed']),
  thumbState: z.enum(['pending', 'done', 'failed']),
  missingAt: z.number().nullable(),
  sightings: z.number(),
  thumbPath: z.string().nullable(),
  gridThumbPath: z.string().nullable().default(null),
  proxyPath: z.string().nullable(),
  analysed: z.boolean(),
  analysisError: photoAnalysisErrorSchema.nullable().default(null),
  exifReadAt: z.string().nullable(),
});

export const photosTreeInputSchema = z.object({});

export const photosTreeOutputSchema = z.object({
  media: z.literal('photo'),
  roots: z.array(z.object({
    root: z.string(),
    photos: z.number(),
    missing: z.number(),
    lastScanAt: z.string(),
  })),
});

export const photosFolderTreeInputSchema = z.object({});

export const photosFolderTreeFolderSchema = z.object({
  path: z.string(),
  name: z.string(),
  relativePath: z.string(),
  root: z.string(),
  depth: z.number().int().nonnegative(),
  photoCount: z.number().int().nonnegative(),
  analysedCount: z.number().int().nonnegative(),
});

export const photosFolderTreeOutputSchema = z.object({
  media: z.literal('photo'),
  folders: z.array(photosFolderTreeFolderSchema),
  photoTotal: z.number().int().nonnegative(),
  analysedTotal: z.number().int().nonnegative(),
});

export const photosTreeFolderInputSchema = folderInputSchema;

export const photosTreeFolderOutputSchema = z.object({
  media: z.literal('photo'),
  items: z.array(photoListItemSchema),
});

export const photosListInputSchema = z.object({
  root: canonicalPathString().optional(),
  offset: queryInteger(0, 0, 1_000_000),
  limit: queryInteger(200, 1, 500),
});

export const photosListOutputSchema = z.object({
  media: z.literal('photo'),
  root: z.string().nullable(),
  total: z.number(),
  offset: z.number(),
  items: z.array(photoListItemSchema),
});

export const photosDetailInputSchema = z.object({
  fingerprint: photoFingerprintSchema,
});

export const photosDetailOutputSchema = z.object({
  media: z.literal('photo'),
  photo: z.object({
    fingerprint: z.string(),
    folderId: z.string(),
    fileName: z.string(),
    currentPath: z.string(),
    ext: photoExtensionSchema,
    size: z.number(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    orientation: z.number().nullable(),
    cameraMake: z.string().nullable(),
    cameraModel: z.string().nullable(),
    lens: z.string().nullable(),
    iso: z.number().nullable(),
    fNumber: z.number().nullable(),
    exposureTime: z.number().nullable(),
    exifRating: z.number().nullable(),
    capturedAt: z.string().nullable(),
    capturedAtSource: z.enum(CAPTURED_AT_SOURCES).nullable(),
    discoveredAt: z.string(),
    exifReadAt: z.string().nullable(),
    proxyState: z.enum(['pending', 'done', 'failed', 'not_needed']),
    proxyWidth: z.number().nullable(),
    proxyHeight: z.number().nullable(),
    thumbState: z.enum(['pending', 'done', 'failed']),
    missingAt: z.number().nullable(),
  }),
  sightings: z.array(z.object({
    currentPath: z.string(),
    folderId: z.string(),
    lastSeenAt: z.string(),
  })),
  ownerPath: z.string(),
  proxyPath: z.string().nullable(),
  thumbPath: z.string().nullable(),
  gridThumbPath: z.string().nullable().default(null),
  people: z.array(z.object({
    personId: z.string().min(1),
    displayName: z.string().nullable(),
  })).default([]),
  analysis: z.object({
    configId: configIdString(),
    label: z.string().min(1),
    description: z.string(),
    scene: z.string(),
    quality: z.string(),
    tags: z.array(z.string()),
    batchSize: z.number().int().nullable(),
    createdAt: z.string(),
    variantCount: z.number().int().nonnegative(),
    explicit: z.boolean(),
  }).nullable(),
  analysisError: photoAnalysisErrorSchema.nullable().default(null),
});

export const photosSearchResultSchema = z.object({
  fingerprint: photoFingerprintSchema,
  fileName: z.string().min(1),
  currentPath: z.string().min(1),
  ext: photoExtensionSchema,
  capturedAt: z.string().nullable(),
  description: z.string().nullable(),
  snippet: z.string(),
  tags: z.array(z.string()),
  variantCount: z.number().int().nonnegative(),
  thumbState: z.enum(['pending', 'done', 'failed']),
  proxyState: z.enum(['pending', 'done', 'failed', 'not_needed']),
  missingAt: z.number().nullable(),
  thumbPath: z.string().nullable(),
  gridThumbPath: z.string().nullable().default(null),
  proxyPath: z.string().nullable(),
});

export const photosSearchInputSchema = z.object({
  query: z.string().min(1),
  limit: queryInteger(50, 1, 200),
  offset: queryInteger(0, 0, 100_000),
});

export const photosSearchOutputSchema = z.object({
  media: z.literal('photo'),
  query: z.string(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
  results: z.array(photosSearchResultSchema),
});

export const photosVariantRecordSchema = z.object({
  configId: configIdString(),
  label: z.string().min(1),
  description: z.string(),
  scene: z.string(),
  quality: z.string(),
  language: z.string().nullable(),
  analyzer: z.string().nullable(),
  model: z.string().nullable(),
  batchSize: z.number().int().nullable(),
  createdAt: z.string(),
  tags: z.array(z.string()),
  selected: z.boolean(),
  explicit: z.boolean(),
});

export const photosVariantsListInputSchema = z.object({
  fingerprint: photoFingerprintSchema,
});

export const photosVariantsListOutputSchema = z.object({
  media: z.literal('photo'),
  fingerprint: photoFingerprintSchema,
  selectedConfigId: configIdString().nullable(),
  variants: z.array(photosVariantRecordSchema),
});

export const photosVariantsSelectInputSchema = z.object({
  fingerprint: photoFingerprintSchema,
  configId: configIdString().nullable(),
});

export const photosVariantsSelectOutputSchema = z.object({
  media: z.literal('photo'),
  fingerprint: photoFingerprintSchema,
  configId: configIdString().nullable(),
});

export const photosVariantsDeleteInputSchema = z.object({
  fingerprint: photoFingerprintSchema,
  configId: configIdString(),
});

export const photosVariantsDeleteOutputSchema = z.object({
  media: z.literal('photo'),
  fingerprint: photoFingerprintSchema,
  configId: configIdString(),
  selectedConfigId: configIdString().nullable(),
});

export const photosVariantsFolderDefaultInputSchema = z.object({
  folderId: z.string().min(1),
  configId: configIdString().nullable(),
});

export const photosVariantsFolderDefaultOutputSchema = z.object({
  media: z.literal('photo'),
  folderId: z.string().min(1),
  defaultConfigId: configIdString().nullable(),
});

export const thumbnailInputSchema = videoPathInputSchema.merge(forceInputSchema).extend({
  priority: z.enum(['foreground', 'background']).default('foreground'),
});

export const thumbnailOutputSchema = z.object({
  video: z.string(),
  path: z.string(),
  thumbnailPath: z.string(),
  generated: z.boolean(),
  skipped: z.boolean(),
});

export const thumbnailsInputSchema = z.object({
  root: canonicalPathString(),
  force: z.boolean().default(false),
});

export const thumbnailsSummarySchema = z.object({
  root: z.string().min(1),
  foldersScanned: z.number().int().nonnegative(),
  filesScanned: z.number().int().nonnegative(),
  candidates: z.number().int().nonnegative(),
  generated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  fromFrame: z.number().int().nonnegative(),
  fromSource: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  gridGenerated: z.number().int().nonnegative().default(0),
  gridSkipped: z.number().int().nonnegative().default(0),
  gridFailed: z.number().int().nonnegative().default(0),
  failures: z.array(driveRunFailureSchema),
});

export const gpsBackfillInputSchema = z.object({
  timelinePath: z.string().min(1),
  root: canonicalPathString().optional(),
  dryRun: z.boolean().default(false),
  toleranceMinutes: z.number().int().min(0).max(240).default(30),
  maxVisitHours: z.number().int().min(1).max(720).default(36),
  reresolvePlaces: z.boolean().default(false),
});

export const gpsBackfillSummarySchema = z.object({
  timelinePath: z.string().min(1),
  dryRun: z.boolean(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  timeline: z.object({
    entries: z.number().int().nonnegative(),
    entriesSkipped: z.number().int().nonnegative(),
    entriesIgnored: z.number().int().nonnegative(),
    intervals: z.number().int().nonnegative(),
    firstStart: z.string().nullable(),
    lastEnd: z.string().nullable(),
  }),
  filesTotal: z.number().int().nonnegative(),
  filesConsidered: z.number().int().nonnegative(),
  capturedAtProbed: z.number().int().nonnegative(),
  matched: z.object({
    visit: z.number().int().nonnegative(),
    activity: z.number().int().nonnegative(),
    path: z.number().int().nonnegative(),
  }),
  matchedWithinTolerance: z.number().int().nonnegative(),
  written: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  unmatched: z.number().int().nonnegative(),
  skipped: z.object({
    cameraGps: z.number().int().nonnegative(),
    manualGps: z.number().int().nonnegative(),
    noCapturedAt: z.number().int().nonnegative(),
    offline: z.number().int().nonnegative(),
  }),
  skewSuspicious: z.number().int().nonnegative(),
  skewSamples: z.array(z.string()),
  accuracy: z.object({
    buckets: z.array(z.object({ upToM: z.number().nonnegative().nullable(), files: z.number().int().nonnegative() })),
    medianM: z.number().nonnegative().nullable(),
    p90M: z.number().nonnegative().nullable(),
  }),
  places: z.object({
    datasetId: z.string().nullable(),
    resolved: z.number().int().nonnegative(),
    unresolved: z.number().int().nonnegative(),
    skippedNoDataset: z.number().int().nonnegative(),
  }),
  failures: z.array(driveRunFailureSchema),
  elapsedMs: z.number().int().nonnegative(),
});

export const facesReclusterOutputSchema = z.object({
  dryRun: z.boolean(),
  observations: z.number().int().nonnegative(),
  personsBefore: z.number().int().nonnegative(),
  personsAfter: z.number().int().nonnegative(),
  observationsReassigned: z.number().int().nonnegative(),
  observationsAssigned: z.number().int().nonnegative(),
  observationsUnassigned: z.number().int().nonnegative(),
  namesCarried: z.number().int().nonnegative(),
  namesDropped: z.array(z.string()),
  personsWithoutExemplar: z.number().int().nonnegative(),
  largestClusters: z.array(z.object({
    personId: z.string().min(1),
    observations: z.number().int().nonnegative(),
  })),
  elapsedMs: z.number().int().nonnegative(),
});

export const facesExemplarsOutputSchema = z.object({
  dryRun: z.boolean(),
  people: z.number().int().nonnegative(),
  peopleWithoutExemplarBefore: z.number().int().nonnegative(),
  peopleWithoutExemplarAfter: z.number().int().nonnegative(),
  filesPlanned: z.number().int().nonnegative(),
  filesVisited: z.number().int().nonnegative(),
  filesUnavailable: z.number().int().nonnegative(),
  cropsPlanned: z.number().int().nonnegative(),
  cropsWritten: z.number().int().nonnegative(),
  cropPathsNormalized: z.number().int().nonnegative(),
  detectionsMismatched: z.number().int().nonnegative(),
  observationsUnaddressable: z.number().int().nonnegative(),
  limitReached: z.boolean(),
  elapsedMs: z.number().int().nonnegative(),
});

export const statusVideoSchema = z.object({
  path: z.string(),
  originalName: z.string(),
  newName: z.string().nullable(),
  status: videoStatusSchema,
  statusLabel: z.string(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const statusOutputSchema = z.object({
  videos: z.array(statusVideoSchema),
  summary: z.object({
    total: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    inProgress: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
  }),
});

export const resetAllInputSchema = forceInputSchema.merge(optionalFolderInputSchema);

export const resetAllOutputSchema = z.union([
  z.object({
    cleared: z.number().int().nonnegative(),
    byStatus: z.record(z.enum(VIDEO_STATUSES), z.number().int().nonnegative()),
    configPreserved: z.literal(true),
  }),
  z.object({
    cleared: z.literal(0),
    message: z.literal('No video records in database'),
  }),
]);

export const resetSingleInputSchema = z.object({
  folder: canonicalPathString().optional(),
  filename: canonicalPathString(),
  force: z.boolean().default(false),
});

export const resetSingleOutputSchema = z.union([
  z.object({
    filename: z.string(),
    previousStatus: videoStatusSchema,
    newStatus: z.literal('pending'),
    previousError: z.string().nullable(),
  }),
  z.object({
    filename: z.string(),
    previousStatus: z.literal('pending'),
    newStatus: z.literal('pending'),
    message: z.literal('Video is already in pending status'),
  }),
]);

export const configGetInputSchema = z.object({
  folder: canonicalPathString().optional(),
  key: configKeySchema.nullable().default(null),
});

export const storedConfigSchema = z.object({
  whisper_binary_path: z.string().nullable(),
  whisper_model: z.string().nullable(),
  whisper_language: z.string().nullable(),
  whisper_mode: z.string().nullable(),
  whisper_api_base_url: z.string().nullable(),
  whisper_api_model: z.string().nullable(),
  frames: z.string().nullable(),
  timeout: z.string().nullable(),
  skip_rename: z.string().nullable(),
  analyzer_backend: z.string().nullable(),
  local_model: z.string().nullable(),
  analyzer_provider: z.string().nullable(),
  faces_enabled: z.string().nullable(),
  gemini_batch_mode: z.string().nullable(),
  gemini_monthly_budget_usd: z.string().nullable(),
  output_language: z.string().nullable(),
  tag_language: z.string().nullable(),
  ui_language: z.string().nullable(),
  backup_enabled: z.string().nullable(),
  backup_provider: z.string().nullable(),
  backup_include_optional: z.string().nullable(),
  backup_keep_last: z.string().nullable(),
  backup_keep_weekly: z.string().nullable(),
  backup_folder_id: z.string().nullable(),
  backup_shared_drive_id: z.string().nullable(),
  backup_service_account_fingerprint: z.string().nullable(),
  backup_account_email: z.string().nullable(),
});

export const storedConfigDefaultsSchema = z.object({
  whisper_binary_path: z.string(),
  whisper_model: z.string(),
  whisper_language: z.string(),
  whisper_mode: z.string(),
  whisper_api_base_url: z.string(),
  whisper_api_model: z.string(),
  frames: z.string(),
  timeout: z.string(),
  skip_rename: z.string(),
  analyzer_backend: z.string(),
  local_model: z.string(),
  analyzer_provider: z.string(),
  faces_enabled: z.string(),
  gemini_batch_mode: z.string(),
  gemini_monthly_budget_usd: z.string(),
  output_language: z.string(),
  tag_language: z.string(),
  ui_language: z.string(),
  backup_enabled: z.string(),
  backup_provider: z.string(),
  backup_include_optional: z.string(),
  backup_keep_last: z.string(),
  backup_keep_weekly: z.string(),
  backup_folder_id: z.string(),
  backup_shared_drive_id: z.string(),
  backup_service_account_fingerprint: z.string(),
  backup_account_email: z.string(),
});

export const configValueSourcesSchema = z.object({
  whisper_binary_path: z.enum(['folder', 'home', 'default']),
  whisper_model: z.enum(['folder', 'home', 'default']),
  whisper_language: z.enum(['folder', 'home', 'default']),
  whisper_mode: z.enum(['folder', 'home', 'default']),
  whisper_api_base_url: z.enum(['folder', 'home', 'default']),
  whisper_api_model: z.enum(['folder', 'home', 'default']),
  frames: z.enum(['folder', 'home', 'default']),
  timeout: z.enum(['folder', 'home', 'default']),
  skip_rename: z.enum(['folder', 'home', 'default']),
  analyzer_backend: z.enum(['folder', 'home', 'default']),
  local_model: z.enum(['folder', 'home', 'default']),
  analyzer_provider: z.enum(['folder', 'home', 'default']),
  faces_enabled: z.enum(['folder', 'home', 'default']),
  gemini_batch_mode: z.enum(['folder', 'home', 'default']),
  gemini_monthly_budget_usd: z.enum(['folder', 'home', 'default']),
  output_language: z.enum(['folder', 'home', 'default']),
  tag_language: z.enum(['folder', 'home', 'default']),
  ui_language: z.enum(['folder', 'home', 'default']),
  backup_enabled: z.enum(['folder', 'home', 'default']),
  backup_provider: z.enum(['folder', 'home', 'default']),
  backup_include_optional: z.enum(['folder', 'home', 'default']),
  backup_keep_last: z.enum(['folder', 'home', 'default']),
  backup_keep_weekly: z.enum(['folder', 'home', 'default']),
  backup_folder_id: z.enum(['folder', 'home', 'default']),
  backup_shared_drive_id: z.enum(['folder', 'home', 'default']),
  backup_service_account_fingerprint: z.enum(['folder', 'home', 'default']),
  backup_account_email: z.enum(['folder', 'home', 'default']),
});

export const configEntrySchema = z.object({
  key: configKeySchema,
  value: z.string().nullable(),
  defaultValue: z.string(),
  description: z.string(),
  effectiveValue: z.string(),
  source: z.enum(['folder', 'home', 'default']),
  ignoredFolderValue: z.string().nullable(),
});

export const configGetOutputSchema = z.union([
  z.object({
    config: storedConfigSchema,
    defaults: storedConfigDefaultsSchema,
    effective: storedConfigDefaultsSchema,
    sources: configValueSourcesSchema,
  }),
  configEntrySchema,
]);

export const configSetInputSchema = z.object({
  folder: canonicalPathString().optional(),
  key: configKeySchema,
  value: z.string(),
});

export const configSetOutputSchema = z.object({
  key: configKeySchema,
  value: z.string(),
  previousValue: z.string().nullable(),
  scope: z.enum(['home', 'folder']),
  ignoredFolderValue: z.string().nullable(),
});

export const configUnsetInputSchema = z.object({
  folder: canonicalPathString(),
  key: configKeySchema,
});

export const configUnsetOutputSchema = z.object({
  key: configKeySchema,
  previousValue: z.string().nullable(),
  scope: z.literal('folder'),
});

export const credentialSetInputSchema = z.object({
  providerId: z.string().trim().min(1),
  credential: z.string().min(1),
});

export const credentialSetOutputSchema = z.object({
  providerId: z.string().min(1),
  stored: z.literal(true),
  backend: credentialsBackendStatusSchema,
});

export const credentialDeleteInputSchema = z.object({
  providerId: z.string().trim().min(1),
});

export const credentialDeleteOutputSchema = credentialDeletionSchema.extend({
  providerId: z.string().min(1),
});

export const providersListOutputSchema = z.object({
  providers: z.array(analyzerProviderDescriptorSchema),
});

export const providerTestInputSchema = analyzerProviderConfigSchema;

const providerTestBaseSchema = z.object({
  providerId: z.string().min(1),
  latencyMs: z.number().int().nonnegative().nullable(),
  message: z.string(),
});

export const apiProviderTestOutputSchema = providerTestBaseSchema.extend({
  family: z.literal('api'),
  reachable: z.boolean(),
  authenticated: z.boolean(),
}).strict();

export const harnessProviderTestOutputSchema = providerTestBaseSchema.extend({
  family: z.literal('harness'),
  available: z.boolean(),
  version: z.string().nullable(),
}).strict();

export const localProviderTestOutputSchema = providerTestBaseSchema.extend({
  family: z.literal('local'),
  runtimeAvailable: z.boolean(),
  modelAvailable: z.boolean(),
  version: z.string().nullable(),
}).strict();

export const providerTestOutputSchema = z.discriminatedUnion('family', [
  apiProviderTestOutputSchema,
  harnessProviderTestOutputSchema,
  localProviderTestOutputSchema,
]);

export const whisperModelListEntrySchema = z.object({
  name: z.enum(WHISPER_MODEL_NAMES),
  size: z.string(),
  downloaded: z.boolean(),
  active: z.boolean(),
});

export const whisperModelsListOutputSchema = z.object({
  models: z.array(whisperModelListEntrySchema),
});

export const whisperModelInputSchema = z.object({
  modelName: z.enum(WHISPER_MODEL_NAMES),
});

export const whisperModelDownloadInputSchema = whisperModelInputSchema.extend({
  force: z.boolean().default(false),
});

export const whisperModelDownloadOutputSchema = z.object({
  model: z.enum(WHISPER_MODEL_NAMES),
  path: z.string(),
  downloaded: z.boolean(),
  skipped: z.boolean(),
  sizeBytes: z.number().int().nonnegative().optional(),
});

export const whisperModelDeleteInputSchema = whisperModelInputSchema.extend({
  force: z.boolean().default(false),
});

export const whisperModelDeleteOutputSchema = z.object({
  model: z.enum(WHISPER_MODEL_NAMES),
  path: z.string(),
  deleted: z.boolean(),
});

export const whisperModelUseOutputSchema = z.object({
  model: z.enum(WHISPER_MODEL_NAMES),
  size: z.string().optional(),
  downloaded: z.boolean(),
});

export const whisperRuntimeStatusOutputSchema = z.object({
  available: z.boolean(),
  path: z.string().nullable(),
  source: z.union([z.literal('configured'), z.literal('managed'), z.literal('system')]).nullable(),
  version: z.string().nullable(),
  managedInstalled: z.boolean(),
  buildToolsAvailable: z.boolean(),
  missingBuildTools: z.array(z.string()),
  message: z.string().optional(),
});

export const whisperRuntimeInstallOutputSchema = z.object({
  path: z.string(),
  version: z.string(),
  installed: z.boolean(),
});

export const faceArtifactEntrySchema = z.object({
  artifactId: z.enum(FILE_ARTIFACT_IDS),
  filename: z.string().min(1),
  bytes: z.number().int().positive().nullable(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  url: z.url(),
  license: z.string().min(1),
  path: z.string().min(1),
  downloaded: z.boolean(),
  valid: z.boolean(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  actualSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  reason: z.string().min(1).nullable(),
  remedy: z.string().min(1).nullable(),
});

export const faceArtifactsStatusOutputSchema = z.object({
  artifacts: z.array(faceArtifactEntrySchema),
  ready: z.boolean(),
});

export const faceArtifactsInstallInputSchema = forceInputSchema;

export const machineSchema = z.object({
  platform: z.string(),
  arch: z.string(),
  totalMemGB: z.number(),
  appleSilicon: z.boolean(),
});

export const localAiTierSchema = z.object({
  tag: z.enum(LOCAL_AI_MODEL_TAGS),
  label: z.string(),
  downloadGB: z.number(),
  minTotalMemGB: z.number(),
  supportLevel: z.enum(LOCAL_AI_SUPPORT_LEVELS),
  installed: z.boolean(),
  recommended: z.boolean(),
});

export const localAiRequirementsOutputSchema = z.object({
  machine: machineSchema,
  runtimeUp: z.boolean(),
  runtimeVersion: z.string(),
  tiers: z.array(localAiTierSchema),
});

export const localAiTagInputSchema = z.object({
  tag: z.string().min(1),
});

export const localAiPullOutputSchema = z.object({
  tag: z.string(),
  status: z.literal('installed'),
});

export const localAiRmOutputSchema = z.object({
  tag: z.string(),
  status: z.literal('removed'),
});

export const localAiDaemonStopOutputSchema = z.object({
  stopped: z.boolean(),
});

export const dependencyStatusSchema = z.object({
  name: z.string(),
  available: z.boolean(),
  version: z.string().nullable(),
  source: z.union([
    z.literal('bundled'),
    z.literal('configured'),
    z.literal('managed'),
    z.literal('system'),
  ]).nullable(),
  path: z.string().nullable(),
  installHint: z.string(),
  warning: z.string().optional(),
  engine: whisperEngineSchema.optional(),
});

export const doctorWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export const readinessComponentSchema = z.object({
  kind: z.enum(['analyzer', 'transcriber']),
  name: z.string(),
  available: z.boolean(),
  message: z.string(),
  suggestedAction: z.string().nullable(),
  warning: z.string().nullable().default(null),
});

export const readinessOutputSchema = z.object({
  ready: z.boolean(),
  analyzer: readinessComponentSchema.extend({
    kind: z.literal('analyzer'),
    family: analyzerProviderFamilySchema,
    providerId: z.string(),
    model: z.string().nullable().default(null),
  }),
  transcriber: readinessComponentSchema.extend({
    kind: z.literal('transcriber'),
    mode: z.enum(WHISPER_MODES),
    model: z.enum(WHISPER_MODEL_NAMES).nullable(),
    engine: whisperEngineSchema.nullable().default(null),
    binaryPath: z.string().nullable().default(null),
  }),
  missingPieces: z.array(readinessComponentSchema),
  suggestedAction: z.string().nullable(),
});

export const readinessInputSchema = z.object({
  folder: canonicalPathString().optional(),
  scope: z.literal('home').optional(),
  refresh: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
}).refine((input) => input.folder === undefined || input.scope === undefined, {
  message: 'folder and home scope are mutually exclusive',
});

export const doctorOutputSchema = z.object({
  dependencies: z.array(dependencyStatusSchema),
  harnesses: z.array(harnessProviderTestOutputSchema),
  machine: machineSchema,
  recommendedLocalModel: z.string().nullable(),
  allAvailable: z.boolean(),
  warnings: z.array(doctorWarningSchema).default([]),
  credentials: credentialsBackendStatusSchema,
  configured: readinessOutputSchema,
});

export const checkOutputSchema = z.object({
  hasNestedDatabases: z.boolean(),
  nestedPaths: z.array(z.string()),
  ownNestedPaths: z.array(z.string()),
  basePath: z.string(),
  scannedDirectories: z.number().int().nonnegative(),
});

export const jobStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']);
export const jobKindSchema = z.enum([
  'process',
  'process_drive',
  'variant_projection',
  'whisper_download',
  'whisper_runtime_install',
  'local_ai_pull',
  'face_artifact_download',
  'faces_index',
  'faces_recluster',
  'faces_exemplars',
  'materialize',
  'thumbnails',
  'gps_backfill',
  'photo_scan',
  'photo_proxies',
  'photo_grid_thumbs',
  'photo_process',
  'photo_gps_backfill',
  'photo_import_libra',
  'backup',
  'restore',
]);
export const jobProgressStepSchema = z.enum([
  'run-started',
  'folder-started',
  'folder-done',
  'file-skipped',
  'run-summary',
  'extracting_frames',
  'extracting_audio',
  'transcribing_audio',
  'analyzing_with_claude',
  'renaming_video',
  'skipping_rename',
  'downloading',
  'runtime_setup',
  'model_download',
  'faces_scanning',
  'faces_extracting_frames',
  'faces_detecting',
  'faces_file_failed',
  'faces_clustering',
  'faces_done',
  'faces_pass_skipped',
  'faces_waiting',
  'artifact_reused',
  'catalog_index_skipped',
  'catalog_snapshot_skipped',
  'batch_submitted',
  'batch_poll',
  'batch_completed',
  'batch_uploads_retained',
  'batch_orphan_jobs',
  'batch_model_changed',
  'budget_cap_reached',
  'materialize_file',
  'thumbnails_scanning',
  'thumbnails_file',
  'thumbnails_done',
  'gps_timeline_loaded',
  'gps_backfill_file',
  'gps_backfill_done',
  'photo-file',
  'photo-file-skipped',
  'photo-folder-skipped',
  'photo-exif-failed',
  'photo-run-summary',
  'photo-proxies-scanning',
  'photo-proxy',
  'photo-proxy-failed',
  'photo-proxies-skipped',
  'photo-proxies-summary',
  'photo-grid-thumbs-scanning',
  'photo-grid-thumb',
  'photo-grid-thumb-failed',
  'photo-grid-thumbs-summary',
  'photo-analysis-scanning',
  'photo-analysis-batch-started',
  'photo-analysed',
  'photo-analysis-failed',
  'photo-analysis-usage',
  'photo-process-summary',
  'photo-faces-scanning',
  'photo-faces-detecting',
  'photo-faces-file-failed',
  'photo-faces-summary',
  'photo-faces-skipped',
  'photo-import-libra-scanning',
  'photo-import-libra-summary',
  'idle',
  'fingerprinting',
  'snapshotting',
  'archiving',
  'encrypting',
  'uploading',
  'pruning',
  'verifying',
  'decrypting',
  'restoring',
]);

export const jobProgressSchema = z.object({
  step: jobProgressStepSchema,
  percentage: z.number().min(0).max(100).optional(),
  current: z.number().int().nonnegative().optional(),
  total: z.number().int().positive().optional(),
  stepNumber: z.number().int().positive().optional(),
  totalSteps: z.number().int().positive().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const sequencedJobProgressSchema = z.object({
  sequence: z.number().int().positive(),
  progress: jobProgressSchema,
});

export const facesIndexFailureSchema = z.object({
  path: z.string().min(1),
  fingerprint: z.string().min(1),
  code: z.enum(ERROR_CODES),
  message: z.string(),
});

export const facesIndexOutputSchema = z.object({
  root: z.string().min(1),
  foldersMatched: z.number().int().nonnegative(),
  filesInScope: z.number().int().nonnegative(),
  filesScanned: z.number().int().nonnegative(),
  filesIndexed: z.number().int().nonnegative(),
  observationsAdded: z.number().int().nonnegative(),
  rejectedLowQuality: z.number().int().nonnegative().default(0),
  peopleCreated: z.number().int().nonnegative(),
  filesFailed: z.number().int().nonnegative().default(0),
  failures: z.array(facesIndexFailureSchema).default([]),
  aborted: z.boolean().default(false),
  photo: z.object({
    inScope: z.number().int().nonnegative(),
    scanned: z.number().int().nonnegative(),
    indexed: z.number().int().nonnegative(),
    observationsAdded: z.number().int().nonnegative(),
    rejectedLowQuality: z.number().int().nonnegative().default(0),
    failed: z.number().int().nonnegative(),
  }).default({ inScope: 0, scanned: 0, indexed: 0, observationsAdded: 0, rejectedLowQuality: 0, failed: 0 }),
});

export const jobResultSchema = z.union([
  processCompletedOutputSchema,
  driveRunSummarySchema,
  whisperModelDownloadOutputSchema,
  whisperRuntimeInstallOutputSchema,
  localAiPullOutputSchema,
  faceArtifactsStatusOutputSchema,
  facesIndexOutputSchema,
  materializeSummarySchema,
  photoScanSummarySchema,
  photoProxiesSummarySchema,
  photoGridThumbsSummarySchema,
  photoProcessSummarySchema,
  thumbnailsSummarySchema,
  facesReclusterOutputSchema,
  facesExemplarsOutputSchema,
  remoteBackupSchema,
  backupRestoreOutputSchema,
  photoGpsBackfillSummarySchema,
  photoImportLibraSummarySchema,
  gpsBackfillSummarySchema,
]);

export const jobOutputSchema = z.object({
  jobId: z.string(),
  kind: jobKindSchema,
  status: jobStatusSchema,
  progress: jobProgressSchema.nullable(),
  progressEvents: z.array(sequencedJobProgressSchema),
  result: jobResultSchema.optional(),
  error: z
    .object({
      code: z.enum(ERROR_CODES),
      message: z.string(),
      details: z.unknown().optional(),
    })
    .nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const jobsListOutputSchema = z.object({
  jobs: z.array(jobOutputSchema),
});

export const jobCancelOutputSchema = z.object({
  jobId: z.string(),
  cancelled: z.boolean(),
});

export const indexStatusFolderSchema = z.object({
  folderId: folderIdSchema,
  currentPath: z.string().min(1),
  displayName: z.string(),
});

export const indexStatusOutputSchema = z.object({
  databasePath: z.string(),
  counts: z.object({
    folders: z.number().int().nonnegative(),
    files: z.number().int().nonnegative(),
    analyses: z.number().int().nonnegative(),
  }),
  folders: z.array(indexStatusFolderSchema),
  latestRun: z.object({
    runId: z.string().min(1),
    root: z.string().min(1),
    startedAt: z.string(),
    finishedAt: z.string().nullable(),
    foldersTotal: z.number().int().nonnegative(),
    foldersDone: z.number().int().nonnegative(),
    filesDone: z.number().int().nonnegative(),
    filesSkipped: z.number().int().nonnegative(),
    filesFailed: z.number().int().nonnegative(),
    lastActivityAt: z.string(),
  }).nullable(),
  currentMonthSpend: z.object({
    kind: z.literal('estimate'),
    provider: z.literal('gemini'),
    month: z.string().regex(/^\d{4}-\d{2}$/),
    entries: z.number().int().nonnegative(),
    estimatedCostUsd: z.number().nonnegative(),
  }),
});

export const indexRebuildOutputSchema = z.object({
  databasePath: z.string(),
  reconciledFolders: z.number().int().nonnegative(),
  importedFiles: z.number().int().nonnegative(),
  folders: z.array(indexStatusFolderSchema),
});

export const indexForgetInputSchema = z.object({
  fingerprint: z.string().min(1),
});

export const indexForgetOutputSchema = z.object({
  fingerprint: z.string().min(1),
  deleted: z.boolean(),
  folderId: folderIdSchema.nullable(),
  snapshotSkipped: z.boolean(),
});

export const tagsListOutputSchema = z.object({
  tags: z.array(z.object({
    name: z.string().min(1),
    count: z.number().int().nonnegative(),
  })),
});

export const tagsAliasInputSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

export const tagsAliasOutputSchema = z.object({
  alias: z.string().min(1),
  canonical: z.string().min(1),
  remappedFiles: z.number().int().nonnegative(),
});

export const tagsSuggestAliasesOutputSchema = z.object({
  proposals: z.array(z.object({
    from: z.string().min(1),
    to: z.string().min(1),
    fromCount: z.number().int().nonnegative(),
    toCount: z.number().int().nonnegative(),
    rule: z.enum(TAG_ALIAS_RULES),
    canonicalLocked: z.boolean(),
  })),
});

const csvList = z.preprocess(
  (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string' || value.length === 0) return [];
    return value.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  },
  z.array(z.string().min(1)),
);

const queryBooleanTriState = z.preprocess(
  (value) => {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
  },
  z.boolean().optional(),
);

export const SEARCH_SORTS = ['relevance', 'captured_desc', 'captured_asc', 'name_asc'] as const;

export const searchInputSchema = z.object({
  query: z.string().min(1).optional(),
  tags: csvList.default([]),
  people: csvList.default([]),
  place: z.string().min(1).optional(),
  from: z.iso.date().or(z.iso.datetime()).optional(),
  to: z.iso.date().or(z.iso.datetime()).optional(),
  hasGps: queryBooleanTriState,
  folderId: folderIdSchema.optional(),
  sort: z.enum(SEARCH_SORTS).optional(),
  thumbnails: z.enum(['ensure', 'existing']).default('ensure'),
  limit: queryInteger(50, 1, 200),
  offset: queryInteger(0, 0, 100_000),
});

export const OFFLINE_REASONS = ['drive-disconnected', 'file-missing'] as const;
export const offlineReasonSchema = z.enum(OFFLINE_REASONS);

export const searchResultSchema = z.object({
  fingerprint: z.string().min(1),
  variantCount: z.number().int().nonnegative(),
  fileName: z.string().min(1),
  finalName: z.string().nullable(),
  description: z.string().nullable(),
  snippet: z.string(),
  thumbnailPath: z.string().nullable(),
  gridThumbnailPath: z.string().nullable().default(null),
  tags: z.array(z.string()),
  folder: z.object({
    folderId: folderIdSchema,
    currentPath: z.string().min(1),
    displayName: z.string(),
    online: z.boolean(),
    offlineReason: offlineReasonSchema.nullable().default(null),
  }),
  gps: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }).nullable(),
  missing: z.boolean(),
  capturedAt: z.iso.datetime().nullable(),
  place: catalogPlaceSchema.nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
});

export const searchOutputSchema = z.object({
  query: z.string().nullable(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  results: z.array(searchResultSchema),
});

export const libraryPreviewInputSchema = z.object({
  fingerprint: z.string().min(1),
});

export const libraryPreviewPersonSchema = z.object({
  personId: z.string().min(1),
  displayName: z.string().nullable(),
});

export const libraryPreviewOutputSchema = z.object({
  fingerprint: z.string().min(1),
  path: z.string().min(1),
  fileName: z.string().min(1),
  size: z.number().int().nonnegative(),
  sizeFormatted: z.string(),
  durationS: z.number().nonnegative().nullable(),
  durationFormatted: z.string().nullable(),
  transcript: z.string().nullable(),
  transcriptSegments: z.array(transcriptSegmentSchema).nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  rotation: z.number().nullable(),
  people: z.array(libraryPreviewPersonSchema),
  analysis: z.object({
    label: z.string().min(1),
    createdAt: z.iso.datetime(),
  }).nullable().default(null),
});

export const collectionMediaSchema = z.enum(['all', 'video', 'photo']);

export const collectionVideoItemSchema = searchResultSchema.extend({
  media: z.literal('video'),
});

export const collectionPhotoItemSchema = z.object({
  media: z.literal('photo'),
  fingerprint: photoFingerprintSchema,
  fileName: z.string().min(1),
  currentPath: z.string().min(1),
  ext: photoExtensionSchema,
  capturedAt: z.string().nullable(),
  description: z.string().nullable(),
  snippet: z.string(),
  tags: z.array(z.string()),
  variantCount: z.number().int().nonnegative(),
  missingAt: z.number().nullable(),
  thumbPath: z.string().nullable(),
  gridThumbPath: z.string().nullable(),
  proxyPath: z.string().nullable(),
});

export const collectionItemSchema = z.discriminatedUnion('media', [
  collectionVideoItemSchema,
  collectionPhotoItemSchema,
]);

export const collectionInputSchema = z.object({
  query: z.string().min(1).optional(),
  tags: csvList.default([]),
  people: csvList.default([]),
  place: z.string().min(1).optional(),
  from: z.iso.date().or(z.iso.datetime()).optional(),
  to: z.iso.date().or(z.iso.datetime()).optional(),
  hasGps: queryBooleanTriState,
  folderId: folderIdSchema.optional(),
  sort: z.enum(SEARCH_SORTS).optional(),
  media: collectionMediaSchema.default('all'),
  hideUnavailable: queryBoolean,
  limit: queryInteger(50, 1, 200),
  cursor: z.string().optional(),
});

export const collectionOutputSchema = z.object({
  query: z.string().nullable(),
  media: collectionMediaSchema,
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  videoTotal: z.number().int().nonnegative(),
  photoTotal: z.number().int().nonnegative(),
  mediaTotals: z.object({
    all: z.number().int().nonnegative(),
    video: z.number().int().nonnegative(),
    photo: z.number().int().nonnegative(),
  }),
  count: z.number().int().nonnegative(),
  items: z.array(collectionItemSchema),
  nextCursor: z.string().nullable(),
});

export const catalogLocationPlaceSchema = z.object({
  name: z.string().min(1),
  region: z.string().nullable(),
  country: z.string().nullable(),
  countryCode: z.string().length(2).nullable(),
  distanceM: z.number().nonnegative(),
  dataset: z.string().min(1),
});

export const catalogLocationSchema = z.object({
  fingerprint: z.string().min(1),
  media: z.enum(['video', 'photo']).default('video'),
  fileName: z.string().min(1),
  finalName: z.string().nullable(),
  thumbPath: z.string().nullable().default(null),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  missing: z.boolean(),
  folder: z.object({
    folderId: folderIdSchema,
    currentPath: z.string().min(1),
    displayName: z.string(),
    online: z.boolean(),
  }),
  source: z.enum(['camera', 'timeline', 'manual']).nullable(),
  accuracyM: z.number().nonnegative().nullable(),
  intervalKind: z.enum(['visit', 'activity', 'path']).nullable(),
  place: catalogLocationPlaceSchema.nullable(),
}).strict();

export const catalogLocationsOutputSchema = z.object({
  totalFiles: z.number().int().nonnegative(),
  locatedFiles: z.number().int().nonnegative(),
  totalPhotos: z.number().int().nonnegative().default(0),
  locatedPhotos: z.number().int().nonnegative().default(0),
  locations: z.array(catalogLocationSchema),
}).strict();

export const libraryFacetTagSchema = z.object({
  name: z.string().min(1),
  count: z.number().int().nonnegative(),
}).strict();

export const libraryFacetPersonSchema = z.object({
  personId: z.string().min(1),
  displayName: z.string().nullable(),
  count: z.number().int().nonnegative(),
  fallbackIndex: z.number().int().nonnegative().default(0),
}).strict();

export const libraryFacetPlaceSchema = z.object({
  name: z.string().min(1),
  country: z.string().nullable(),
  countryCode: z.string().nullable(),
  count: z.number().int().nonnegative(),
}).strict();

export const libraryFacetYearSchema = z.object({
  year: z.string().min(4),
  count: z.number().int().nonnegative(),
}).strict();

export const libraryFacetFolderSchema = z.object({
  folderId: folderIdSchema,
  displayName: z.string(),
  currentPath: z.string().min(1),
  online: z.boolean(),
  count: z.number().int().nonnegative(),
}).strict();

export const libraryFacetsOutputSchema = z.object({
  tags: z.array(libraryFacetTagSchema),
  people: z.array(libraryFacetPersonSchema),
  places: z.array(libraryFacetPlaceSchema),
  years: z.array(libraryFacetYearSchema),
  folders: z.array(libraryFacetFolderSchema),
  counts: z.object({
    total: z.number().int().nonnegative(),
    withGps: z.number().int().nonnegative(),
    withoutCaptureDate: z.number().int().nonnegative(),
    missing: z.number().int().nonnegative(),
    offlineFolders: z.number().int().nonnegative(),
  }).strict(),
}).strict();

const variantLocatorSchema = z.object({
  videoPath: canonicalPathString().optional(),
  fingerprint: z.string().min(1).optional(),
}).strict().refine(
  (input) => (input.videoPath === undefined) !== (input.fingerprint === undefined),
  { message: 'Exactly one of videoPath or fingerprint is required' },
);

export const variantsListInputSchema = variantLocatorSchema;

export const variantMutationInputSchema = variantLocatorSchema.safeExtend({
  configId: configIdSchema,
});

export const variantSelectInputSchema = variantMutationInputSchema.safeExtend({
  deferProjection: z.boolean().optional(),
});

export const variantFolderDefaultInputSchema = z.object({
  folderPath: canonicalPathString(),
  configId: configIdSchema.nullable(),
}).strict();

export const translationImportInputSchema = z.object({
  ndjsonPath: canonicalPathString(),
  dryRun: z.boolean().default(false),
  select: z.boolean().default(true),
}).strict();

export const translationImportProgressRowSchema = z.object({
  line: z.number().int().positive(),
  fingerprint: z.string().min(1).nullable(),
  sourceConfigId: configIdSchema.nullable(),
  configId: configIdSchema.nullable(),
  outcome: z.enum(['created', 'updated', 'skipped']),
  reason: z.string().nullable(),
}).strict();

export const translationImportOutputSchema = z.object({
  ndjsonPath: canonicalPathString(),
  dryRun: z.boolean(),
  select: z.boolean(),
  total: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  invalid: z.number().int().nonnegative(),
  selected: z.number().int().nonnegative(),
  rows: z.array(translationImportProgressRowSchema),
}).strict();

export const variantArtifactsSchema = z.object({
  framesDirectory: z.string().min(1).nullable(),
  transcriptPath: z.string().min(1).nullable(),
  summaryPath: z.string().min(1),
}).strict();

export const variantDetailsSchema = z.object({
  configId: configIdSchema,
  descriptor: configDescriptorSchema.nullable(),
  label: z.string().min(1),
  createdAt: z.iso.datetime(),
  analyzer: z.string().nullable(),
  model: z.string().nullable(),
  usage: z.record(z.string(), z.json()).nullable(),
  estimatedCostUsd: z.number().nonnegative().nullable(),
  artifacts: variantArtifactsSchema,
  selected: z.boolean(),
  finalName: z.string().nullable(),
  description: z.string().nullable(),
  transcript: z.string().nullable(),
  language: z.string().nullable(),
  tags: z.array(z.string()),
}).strict();

export const variantsListOutputSchema = z.object({
  fingerprint: z.string().min(1),
  videoPath: z.string().min(1),
  folderPath: z.string().min(1),
  folderDefaultConfigId: configIdSchema.nullable(),
  currentConfig: z.object({
    configId: configIdSchema,
    descriptor: configDescriptorSchema,
  }).strict(),
  variants: z.array(variantDetailsSchema),
}).strict();

export const variantSelectOutputSchema = z.object({
  fingerprint: z.string().min(1),
  configId: configIdSchema,
}).strict();

export const variantDeleteOutputSchema = z.object({
  fingerprint: z.string().min(1),
  configId: configIdSchema,
  selectedConfigId: configIdSchema,
}).strict();

export const variantFolderDefaultOutputSchema = z.object({
  folderId: folderIdSchema,
  defaultConfigId: configIdSchema.nullable(),
  resolvedConfigId: configIdSchema,
}).strict();

export const facesIndexInputSchema = z.object({
  root: canonicalPathString(),
});

export const facePersonSchema = z.object({
  personId: z.string().min(1),
  displayName: z.string().nullable(),
  kind: z.literal('face'),
  createdAt: z.iso.datetime(),
  centroid: z.array(z.number()).length(128),
  exemplarCount: z.number().int().nonnegative(),
  observationCount: z.number().int().nonnegative(),
  videoCount: z.number().int().nonnegative(),
  photoCount: z.number().int().nonnegative(),
  exemplarCropPath: z.string().min(1).nullable(),
  exemplarCropPaths: z.array(z.string().min(1)),
});

export const facesPeopleOutputSchema = z.object({
  people: z.array(facePersonSchema),
});

export const facesNameInputSchema = z.object({
  personId: z.string().min(1),
  displayName: z.string().trim().min(1),
});

export const facesNameOutputSchema = z.object({
  personId: z.string().min(1),
  displayName: z.string().min(1),
  affectedFingerprints: z.array(z.string()),
});

export const facesMergeInputSchema = z.object({
  fromPersonId: z.string().min(1),
  toPersonId: z.string().min(1),
});

export const facesMergeOutputSchema = z.object({
  fromPersonId: z.string().min(1),
  toPersonId: z.string().min(1),
  movedObservations: z.number().int().nonnegative(),
  affectedFingerprints: z.array(z.string()),
});

export const facesForgetInputSchema = z.object({
  personId: z.string().min(1),
  force: z.boolean().default(false),
});

export const facesForgetOutputSchema = z.object({
  personId: z.string().min(1),
  deleted: z.boolean(),
  cropPathsDeleted: z.number().int().nonnegative(),
  affectedFingerprints: z.array(z.string()),
});

export const facesPurgeInputSchema = forceInputSchema;

export const facesPurgeOutputSchema = z.object({
  peopleDeleted: z.number().int().nonnegative(),
  observationsDeleted: z.number().int().nonnegative(),
  cropPathsDeleted: z.number().int().nonnegative(),
});

export const facesStatusOutputSchema = z.object({
  enabled: z.boolean(),
  artifactsReady: z.boolean(),
  people: z.number().int().nonnegative(),
  observations: z.number().int().nonnegative(),
  assignedObservations: z.number().int().nonnegative(),
  unassignedObservations: z.number().int().nonnegative(),
  filesIndexed: z.number().int().nonnegative(),
  videosIndexed: z.number().int().nonnegative(),
  photosWithFaces: z.number().int().nonnegative(),
  photosProcessed: z.number().int().nonnegative(),
  staleVersionFiles: z.number().int().nonnegative(),
  stalePhotoFiles: z.number().int().nonnegative(),
});

export const facesReclusterInputSchema = z.object({
  dryRun: z.boolean().default(false),
});

export const facesExemplarsInputSchema = z.object({
  dryRun: z.boolean().default(false),
  limit: z.number().int().positive().nullable().default(null),
});

export interface RouteDescriptor<Input extends z.ZodTypeAny, Output extends z.ZodTypeAny> {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  input: Input;
  output: Output;
}

export const API_ROUTES = {
  health: { method: 'GET', path: '/api/health', input: emptyInputSchema, output: healthOutputSchema },
  healthLive: { method: 'GET', path: '/api/health/live', input: emptyInputSchema, output: healthLiveOutputSchema },
  healthReady: { method: 'GET', path: '/api/health/ready', input: emptyInputSchema, output: healthReadyOutputSchema },
  catalogLockStatus: { method: 'GET', path: '/api/catalog-lock', input: emptyInputSchema, output: catalogLockOutputSchema },
  catalogLockRetry: { method: 'POST', path: '/api/catalog-lock/retry', input: emptyInputSchema, output: catalogLockOutputSchema },
  scan: { method: 'GET', path: '/api/scan', input: scanInputSchema, output: scanOutputSchema },
  catalogTree: { method: 'GET', path: '/api/catalog-tree', input: folderInputSchema, output: catalogTreeOutputSchema },
  catalogTreeFolder: { method: 'GET', path: '/api/catalog-tree/folder', input: folderInputSchema, output: catalogTreeFolderOutputSchema },
  catalogFolder: { method: 'GET', path: '/api/catalog-folder', input: folderInputSchema, output: catalogFolderOutputSchema },
  catalogLocations: {
    method: 'GET',
    path: '/api/catalog/locations',
    input: emptyInputSchema,
    output: catalogLocationsOutputSchema,
  },
  libraryFacets: { method: 'GET', path: '/api/library/facets', input: emptyInputSchema, output: libraryFacetsOutputSchema },
  catalogTreeAbsent: { method: 'GET', path: '/api/catalog-tree/absent', input: folderInputSchema, output: catalogTreeAbsentOutputSchema },
  process: { method: 'POST', path: '/api/process', input: processInputSchema, output: jobAcceptedOutputSchema },
  processDrive: { method: 'POST', path: '/api/process-drive', input: processDriveInputSchema, output: jobAcceptedOutputSchema },
  materialize: { method: 'POST', path: '/api/materialize', input: materializeInputSchema, output: jobAcceptedOutputSchema },
  thumbnail: { method: 'POST', path: '/api/thumbnail', input: thumbnailInputSchema, output: thumbnailOutputSchema },
  thumbnails: { method: 'POST', path: '/api/thumbnails', input: thumbnailsInputSchema, output: jobAcceptedOutputSchema },
  gpsBackfill: { method: 'POST', path: '/api/gps/backfill', input: gpsBackfillInputSchema, output: jobAcceptedOutputSchema },
  status: { method: 'GET', path: '/api/status', input: optionalFolderInputSchema, output: statusOutputSchema },
  resetAll: { method: 'POST', path: '/api/reset/all', input: resetAllInputSchema, output: resetAllOutputSchema },
  resetSingle: {
    method: 'POST',
    path: '/api/reset/single',
    input: resetSingleInputSchema,
    output: resetSingleOutputSchema,
  },
  configGet: { method: 'GET', path: '/api/config', input: configGetInputSchema, output: configGetOutputSchema },
  configSet: { method: 'POST', path: '/api/config', input: configSetInputSchema, output: configSetOutputSchema },
  configUnset: {
    method: 'DELETE',
    path: '/api/config',
    input: configUnsetInputSchema,
    output: configUnsetOutputSchema,
  },
  credentialSet: {
    method: 'POST',
    path: '/api/credentials',
    input: credentialSetInputSchema,
    output: credentialSetOutputSchema,
  },
  credentialDelete: {
    method: 'DELETE',
    path: '/api/credentials',
    input: credentialDeleteInputSchema,
    output: credentialDeleteOutputSchema,
  },
  providersList: {
    method: 'GET',
    path: '/api/providers',
    input: emptyInputSchema,
    output: providersListOutputSchema,
  },
  providerTest: {
    method: 'POST',
    path: '/api/providers/test',
    input: providerTestInputSchema,
    output: providerTestOutputSchema,
  },
  whisperModelsList: {
    method: 'GET',
    path: '/api/models/whisper',
    input: emptyInputSchema,
    output: whisperModelsListOutputSchema,
  },
  whisperModelDownload: {
    method: 'POST',
    path: '/api/models/whisper/download',
    input: whisperModelDownloadInputSchema,
    output: jobAcceptedOutputSchema,
  },
  whisperModelDelete: {
    method: 'DELETE',
    path: '/api/models/whisper',
    input: whisperModelDeleteInputSchema,
    output: whisperModelDeleteOutputSchema,
  },
  whisperModelUse: {
    method: 'POST',
    path: '/api/models/whisper/use',
    input: whisperModelInputSchema,
    output: whisperModelUseOutputSchema,
  },
  whisperRuntimeStatus: {
    method: 'GET',
    path: '/api/models/whisper-runtime',
    input: emptyInputSchema,
    output: whisperRuntimeStatusOutputSchema,
  },
  whisperRuntimeInstall: {
    method: 'POST',
    path: '/api/models/whisper-runtime/install',
    input: emptyInputSchema,
    output: jobAcceptedOutputSchema,
  },
  faceArtifactsStatus: {
    method: 'GET',
    path: '/api/models/faces',
    input: emptyInputSchema,
    output: faceArtifactsStatusOutputSchema,
  },
  faceArtifactsInstall: {
    method: 'POST',
    path: '/api/models/faces/install',
    input: faceArtifactsInstallInputSchema,
    output: jobAcceptedOutputSchema,
  },
  localAiRequirements: {
    method: 'GET',
    path: '/api/models/local-ai/requirements',
    input: emptyInputSchema,
    output: localAiRequirementsOutputSchema,
  },
  localAiPull: {
    method: 'POST',
    path: '/api/models/local-ai/pull',
    input: localAiTagInputSchema,
    output: jobAcceptedOutputSchema,
  },
  localAiRm: {
    method: 'DELETE',
    path: '/api/models/local-ai',
    input: localAiTagInputSchema,
    output: localAiRmOutputSchema,
  },
  localAiDaemonStop: {
    method: 'POST',
    path: '/api/models/local-ai/daemon-stop',
    input: emptyInputSchema,
    output: localAiDaemonStopOutputSchema,
  },
  doctor: { method: 'GET', path: '/api/doctor', input: emptyInputSchema, output: doctorOutputSchema },
  readiness: { method: 'GET', path: '/api/readiness', input: readinessInputSchema, output: readinessOutputSchema },
  check: { method: 'GET', path: '/api/check', input: folderInputSchema, output: checkOutputSchema },
  jobStatus: { method: 'GET', path: '/api/jobs/status', input: jobIdInputSchema, output: jobOutputSchema },
  jobsList: { method: 'GET', path: '/api/jobs', input: emptyInputSchema, output: jobsListOutputSchema },
  jobCancel: { method: 'POST', path: '/api/jobs/cancel', input: jobIdInputSchema, output: jobCancelOutputSchema },
  backupList: { method: 'GET', path: '/api/backup/list', input: backupListInputSchema, output: backupListOutputSchema },
  backupRestore: { method: 'POST', path: '/api/backup/restore', input: backupRestoreInputSchema, output: jobAcceptedOutputSchema },
  backupRun: { method: 'POST', path: '/api/backup/run', input: backupRunInputSchema, output: jobAcceptedOutputSchema },
  backupStatus: { method: 'GET', path: '/api/backup/status', input: backupStatusInputSchema, output: backupStatusOutputSchema },
  backupConnect: { method: 'POST', path: '/api/backup/connect', input: backupConnectInputSchema, output: backupConnectOutputSchema },
  backupTest: { method: 'POST', path: '/api/backup/test', input: backupTestInputSchema, output: backupTestOutputSchema },
  backupEnable: { method: 'POST', path: '/api/backup/enable', input: backupEnableInputSchema, output: backupEnableOutputSchema },
  backupDisable: { method: 'POST', path: '/api/backup/disable', input: backupDisableInputSchema, output: backupDisableOutputSchema },
  backupRecoveryKeyExport: {
    method: 'POST',
    path: '/api/backup/recovery-key/export',
    input: backupRecoveryKeyExportInputSchema,
    output: backupRecoveryKeyExportOutputSchema,
  },
  backupRecoveryKeyConfirm: {
    method: 'POST',
    path: '/api/backup/recovery-key/confirm',
    input: backupRecoveryKeyConfirmInputSchema,
    output: backupRecoveryKeyConfirmOutputSchema,
  },
  backupRecoveryKeyImport: {
    method: 'POST',
    path: '/api/backup/recovery-key/import',
    input: backupRecoveryKeyImportInputSchema,
    output: backupRecoveryKeyImportOutputSchema,
  },
  backupConnectCancel: {
    method: 'POST',
    path: '/api/backup/connect/cancel',
    input: backupConnectCancelInputSchema,
    output: backupConnectCancelOutputSchema,
  },
  indexStatus: { method: 'GET', path: '/api/index/status', input: emptyInputSchema, output: indexStatusOutputSchema },
  indexRebuild: { method: 'POST', path: '/api/index/rebuild', input: emptyInputSchema, output: indexRebuildOutputSchema },
  indexForget: { method: 'POST', path: '/api/index/forget', input: indexForgetInputSchema, output: indexForgetOutputSchema },
  tagsList: { method: 'GET', path: '/api/tags', input: emptyInputSchema, output: tagsListOutputSchema },
  tagsAlias: { method: 'POST', path: '/api/tags/alias', input: tagsAliasInputSchema, output: tagsAliasOutputSchema },
  tagsSuggestAliases: { method: 'GET', path: '/api/tags/suggest-aliases', input: emptyInputSchema, output: tagsSuggestAliasesOutputSchema },
  searchQuery: { method: 'GET', path: '/api/search', input: searchInputSchema, output: searchOutputSchema },
  libraryPreview: {
    method: 'GET',
    path: '/api/library/preview',
    input: libraryPreviewInputSchema,
    output: libraryPreviewOutputSchema,
  },
  libraryCollection: {
    method: 'GET',
    path: '/api/library/collection',
    input: collectionInputSchema,
    output: collectionOutputSchema,
  },
  variantsList: {
    method: 'GET',
    path: '/api/variants',
    input: variantsListInputSchema,
    output: variantsListOutputSchema,
  },
  variantsSelect: {
    method: 'POST',
    path: '/api/variants/select',
    input: variantSelectInputSchema,
    output: variantSelectOutputSchema,
  },
  variantsDelete: {
    method: 'POST',
    path: '/api/variants/delete',
    input: variantMutationInputSchema,
    output: variantDeleteOutputSchema,
  },
  variantsFolderDefault: {
    method: 'POST',
    path: '/api/variants/folder-default',
    input: variantFolderDefaultInputSchema,
    output: variantFolderDefaultOutputSchema,
  },
  variantsImportTranslation: {
    method: 'POST',
    path: '/api/variants/import-translation',
    input: translationImportInputSchema,
    output: translationImportOutputSchema,
  },
  facesIndex: { method: 'POST', path: '/api/faces/index', input: facesIndexInputSchema, output: jobAcceptedOutputSchema },
  facesPeople: { method: 'GET', path: '/api/faces/people', input: emptyInputSchema, output: facesPeopleOutputSchema },
  facesName: { method: 'POST', path: '/api/faces/name', input: facesNameInputSchema, output: facesNameOutputSchema },
  facesMerge: { method: 'POST', path: '/api/faces/merge', input: facesMergeInputSchema, output: facesMergeOutputSchema },
  facesForget: { method: 'POST', path: '/api/faces/forget', input: facesForgetInputSchema, output: facesForgetOutputSchema },
  facesPurge: { method: 'POST', path: '/api/faces/purge', input: facesPurgeInputSchema, output: facesPurgeOutputSchema },
  facesStatus: { method: 'GET', path: '/api/faces/status', input: emptyInputSchema, output: facesStatusOutputSchema },
  facesRecluster: {
    method: 'POST',
    path: '/api/faces/recluster',
    input: facesReclusterInputSchema,
    output: jobAcceptedOutputSchema,
  },
  facesExemplars: {
    method: 'POST',
    path: '/api/faces/exemplars',
    input: facesExemplarsInputSchema,
    output: jobAcceptedOutputSchema,
  },
  photosScan: {
    method: 'POST',
    path: '/api/photos/scan',
    input: photosScanInputSchema,
    output: jobAcceptedOutputSchema,
  },
  photosStatus: {
    method: 'GET',
    path: '/api/photos/status',
    input: photosStatusInputSchema,
    output: photosStatusOutputSchema,
  },
  photosForget: {
    method: 'POST',
    path: '/api/photos/forget',
    input: photosForgetInputSchema,
    output: photosForgetOutputSchema,
  },
  photosProxies: {
    method: 'POST',
    path: '/api/photos/proxies',
    input: photoProxiesInputSchema,
    output: jobAcceptedOutputSchema,
  },
  photosGridThumbs: {
    method: 'POST',
    path: '/api/photos/grid-thumbs',
    input: photoGridThumbsInputSchema,
    output: jobAcceptedOutputSchema,
  },
  photosProcess: {
    method: 'POST',
    path: '/api/photos/process',
    input: photosProcessInputSchema,
    output: jobAcceptedOutputSchema,
  },
  photosGpsBackfill: {
    method: 'POST',
    path: '/api/photos/gps/backfill',
    input: photoGpsBackfillInputSchema,
    output: jobAcceptedOutputSchema,
  },
  photosImportLibra: {
    method: 'POST',
    path: '/api/photos/import-libra',
    input: photoImportLibraInputSchema,
    output: jobAcceptedOutputSchema,
  },
  photosTree: {
    method: 'GET',
    path: '/api/photos/tree',
    input: photosTreeInputSchema,
    output: photosTreeOutputSchema,
  },
  photosFolderTree: {
    method: 'GET',
    path: '/api/photos/tree/folders',
    input: photosFolderTreeInputSchema,
    output: photosFolderTreeOutputSchema,
  },
  photosTreeFolder: {
    method: 'GET',
    path: '/api/photos/tree/folder',
    input: photosTreeFolderInputSchema,
    output: photosTreeFolderOutputSchema,
  },
  photosList: {
    method: 'GET',
    path: '/api/photos/list',
    input: photosListInputSchema,
    output: photosListOutputSchema,
  },
  photosDetail: {
    method: 'GET',
    path: '/api/photos/detail',
    input: photosDetailInputSchema,
    output: photosDetailOutputSchema,
  },
  photosSearch: {
    method: 'GET',
    path: '/api/photos/search',
    input: photosSearchInputSchema,
    output: photosSearchOutputSchema,
  },
  photosVariantsList: {
    method: 'GET',
    path: '/api/photos/variants',
    input: photosVariantsListInputSchema,
    output: photosVariantsListOutputSchema,
  },
  photosVariantsSelect: {
    method: 'POST',
    path: '/api/photos/variants/select',
    input: photosVariantsSelectInputSchema,
    output: photosVariantsSelectOutputSchema,
  },
  photosVariantsDelete: {
    method: 'POST',
    path: '/api/photos/variants/delete',
    input: photosVariantsDeleteInputSchema,
    output: photosVariantsDeleteOutputSchema,
  },
  photosVariantsFolderDefault: {
    method: 'POST',
    path: '/api/photos/variants/folder-default',
    input: photosVariantsFolderDefaultInputSchema,
    output: photosVariantsFolderDefaultOutputSchema,
  },
} as const satisfies Record<string, RouteDescriptor<z.ZodTypeAny, z.ZodTypeAny>>;

export type HttpMethod = (typeof API_ROUTES)[keyof typeof API_ROUTES]['method'];
export type ReadMethod = Extract<HttpMethod, 'GET'>;
export type WriteMethod = Exclude<HttpMethod, ReadMethod>;

export const API_PATHS = {
  health: API_ROUTES.health.path,
  healthLive: API_ROUTES.healthLive.path,
  healthReady: API_ROUTES.healthReady.path,
  catalogLockStatus: API_ROUTES.catalogLockStatus.path,
  catalogLockRetry: API_ROUTES.catalogLockRetry.path,
  scan: API_ROUTES.scan.path,
  catalogTree: API_ROUTES.catalogTree.path,
  catalogTreeFolder: API_ROUTES.catalogTreeFolder.path,
  catalogFolder: API_ROUTES.catalogFolder.path,
  catalogLocations: API_ROUTES.catalogLocations.path,
  libraryFacets: API_ROUTES.libraryFacets.path,
  process: API_ROUTES.process.path,
  processDrive: API_ROUTES.processDrive.path,
  materialize: API_ROUTES.materialize.path,
  thumbnail: API_ROUTES.thumbnail.path,
  thumbnails: API_ROUTES.thumbnails.path,
  gpsBackfill: API_ROUTES.gpsBackfill.path,
  status: API_ROUTES.status.path,
  resetAll: API_ROUTES.resetAll.path,
  resetSingle: API_ROUTES.resetSingle.path,
  configGet: API_ROUTES.configGet.path,
  configSet: API_ROUTES.configSet.path,
  configUnset: API_ROUTES.configUnset.path,
  providersList: API_ROUTES.providersList.path,
  providerTest: API_ROUTES.providerTest.path,
  whisperModelsList: API_ROUTES.whisperModelsList.path,
  whisperModelDownload: API_ROUTES.whisperModelDownload.path,
  whisperModelDelete: API_ROUTES.whisperModelDelete.path,
  whisperModelUse: API_ROUTES.whisperModelUse.path,
  whisperRuntimeStatus: API_ROUTES.whisperRuntimeStatus.path,
  whisperRuntimeInstall: API_ROUTES.whisperRuntimeInstall.path,
  faceArtifactsStatus: API_ROUTES.faceArtifactsStatus.path,
  faceArtifactsInstall: API_ROUTES.faceArtifactsInstall.path,
  localAiRequirements: API_ROUTES.localAiRequirements.path,
  localAiPull: API_ROUTES.localAiPull.path,
  localAiRm: API_ROUTES.localAiRm.path,
  localAiDaemonStop: API_ROUTES.localAiDaemonStop.path,
  doctor: API_ROUTES.doctor.path,
  readiness: API_ROUTES.readiness.path,
  check: API_ROUTES.check.path,
  jobStatus: API_ROUTES.jobStatus.path,
  jobsList: API_ROUTES.jobsList.path,
  jobCancel: API_ROUTES.jobCancel.path,
  backupList: API_ROUTES.backupList.path,
  backupRestore: API_ROUTES.backupRestore.path,
  backupRun: API_ROUTES.backupRun.path,
  backupStatus: API_ROUTES.backupStatus.path,
  backupConnect: API_ROUTES.backupConnect.path,
  backupTest: API_ROUTES.backupTest.path,
  backupEnable: API_ROUTES.backupEnable.path,
  backupDisable: API_ROUTES.backupDisable.path,
  backupRecoveryKeyExport: API_ROUTES.backupRecoveryKeyExport.path,
  backupRecoveryKeyConfirm: API_ROUTES.backupRecoveryKeyConfirm.path,
  backupRecoveryKeyImport: API_ROUTES.backupRecoveryKeyImport.path,
  backupConnectCancel: API_ROUTES.backupConnectCancel.path,
  indexStatus: API_ROUTES.indexStatus.path,
  indexRebuild: API_ROUTES.indexRebuild.path,
  indexForget: API_ROUTES.indexForget.path,
  tagsList: API_ROUTES.tagsList.path,
  tagsAlias: API_ROUTES.tagsAlias.path,
  tagsSuggestAliases: API_ROUTES.tagsSuggestAliases.path,
  searchQuery: API_ROUTES.searchQuery.path,
  libraryCollection: API_ROUTES.libraryCollection.path,
  variantsList: API_ROUTES.variantsList.path,
  variantsSelect: API_ROUTES.variantsSelect.path,
  variantsDelete: API_ROUTES.variantsDelete.path,
  variantsFolderDefault: API_ROUTES.variantsFolderDefault.path,
  variantsImportTranslation: API_ROUTES.variantsImportTranslation.path,
  facesIndex: API_ROUTES.facesIndex.path,
  facesPeople: API_ROUTES.facesPeople.path,
  facesName: API_ROUTES.facesName.path,
  facesMerge: API_ROUTES.facesMerge.path,
  facesForget: API_ROUTES.facesForget.path,
  facesPurge: API_ROUTES.facesPurge.path,
  facesStatus: API_ROUTES.facesStatus.path,
  facesRecluster: API_ROUTES.facesRecluster.path,
  facesExemplars: API_ROUTES.facesExemplars.path,
  photosScan: API_ROUTES.photosScan.path,
  photosStatus: API_ROUTES.photosStatus.path,
  photosForget: API_ROUTES.photosForget.path,
  photosProxies: API_ROUTES.photosProxies.path,
  photosGridThumbs: API_ROUTES.photosGridThumbs.path,
  photosProcess: API_ROUTES.photosProcess.path,
  photosGpsBackfill: API_ROUTES.photosGpsBackfill.path,
  photosImportLibra: API_ROUTES.photosImportLibra.path,
  photosTree: API_ROUTES.photosTree.path,
  photosFolderTree: API_ROUTES.photosFolderTree.path,
  photosTreeFolder: API_ROUTES.photosTreeFolder.path,
  photosList: API_ROUTES.photosList.path,
  photosDetail: API_ROUTES.photosDetail.path,
  photosSearch: API_ROUTES.photosSearch.path,
  photosVariantsList: API_ROUTES.photosVariantsList.path,
  photosVariantsSelect: API_ROUTES.photosVariantsSelect.path,
  photosVariantsDelete: API_ROUTES.photosVariantsDelete.path,
  photosVariantsFolderDefault: API_ROUTES.photosVariantsFolderDefault.path,
} as const;
