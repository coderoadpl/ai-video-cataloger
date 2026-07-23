import { z } from 'zod';

import {
  ANALYZER_BACKENDS,
  CONFIG_DEFAULTS,
  ERROR_CODES,
  FILE_ARTIFACT_IDS,
  LOCAL_AI_MODEL_TAGS,
  LOCAL_AI_SUPPORT_LEVELS,
  VIDEO_STATUSES,
  WHISPER_MODEL_NAMES,
  WHISPER_MODES,
  analyzerProviderConfigSchema,
  analyzerProviderDescriptorSchema,
  configKeySchema,
  videoStatusSchema,
} from '@core/domain/index.js';

export const healthOutputSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
});

const emptyInputSchema = z.object({});
const folderInputSchema = z.object({ folder: z.string().min(1) });
const optionalFolderInputSchema = z.object({ folder: z.string().min(1).optional() });
const videoPathInputSchema = z.object({ videoPath: z.string().min(1) });
const forceInputSchema = z.object({ force: z.boolean().default(false) });
const jobIdInputSchema = z.object({ jobId: z.string().min(1) });
const queryInteger = (fallback: number, min: number, max: number) =>
  z.preprocess(
    (value) => typeof value === 'string' && value.length > 0 ? Number.parseInt(value, 10) : value,
    z.number().int().min(min).max(max).default(fallback),
  );

export const summarySchema = z.object({
  schemaVersion: z.literal(1),
  description: z.string(),
  suggestedFilename: z.string(),
  fullAnalysis: z.string(),
  tags: z.array(z.string()).default([]),
  analyzedAt: z.string(),
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
  videos: z.array(scanVideoSchema),
  pendingCount: z.number().int().nonnegative(),
  processedCount: z.number().int().nonnegative(),
});

export const catalogTreeOutputSchema = z.object({
  root: z.string(),
  folders: z.array(catalogTreeFolderSchema),
  pendingTotal: z.number().int().nonnegative(),
  processedTotal: z.number().int().nonnegative(),
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
  analyzer: z.enum([...ANALYZER_BACKENDS, 'api']).optional(),
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
  ...(input.analyzer === undefined ? {} : { analyzer: input.analyzer }),
  ...(input.localModel === undefined ? {} : { localModel: input.localModel }),
  ...(input.force === undefined ? {} : { force: input.force }),
  ...(input.batch === undefined ? {} : { batch: input.batch }),
}));

export const processDriveInputSchema = z.object({
  root: z.string().min(1),
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
  analyzer: z.enum([...ANALYZER_BACKENDS, 'api']).optional(),
  localModel: z.string().min(1).optional(),
  force: z.boolean().optional(),
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
  ...(input.analyzer === undefined ? {} : { analyzer: input.analyzer }),
  ...(input.localModel === undefined ? {} : { localModel: input.localModel }),
  ...(input.force === undefined ? {} : { force: input.force }),
}));

export const jobAcceptedOutputSchema = z.object({
  jobId: z.string(),
});

export const processCompletedOutputSchema = z.object({
  video: z.string(),
  path: z.string(),
  status: z.literal('completed'),
});

export const driveRunFailureSchema = z.object({
  path: z.string().min(1),
  scope: z.enum(['folder', 'file']),
  code: z.enum(ERROR_CODES),
  message: z.string(),
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
  filesFailed: z.number().int().nonnegative(),
  elapsedMs: z.number().int().nonnegative(),
  failures: z.array(driveRunFailureSchema),
});

export const thumbnailInputSchema = videoPathInputSchema.merge(forceInputSchema);

export const thumbnailOutputSchema = z.object({
  video: z.string(),
  path: z.string(),
  thumbnailPath: z.string(),
  generated: z.boolean(),
  skipped: z.boolean(),
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
  folder: z.string().min(1).optional(),
  filename: z.string().min(1),
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
  folder: z.string().min(1).optional(),
  key: configKeySchema.nullable().default(null),
});

export const storedConfigSchema = z.object({
  whisper_binary_path: z.string().nullable(),
  whisper_model: z.string().nullable(),
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
  output_language: z.string().nullable(),
  ui_language: z.string().nullable(),
});

export const storedConfigDefaultsSchema = z.object({
  whisper_binary_path: z.string(),
  whisper_model: z.string(),
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
  output_language: z.string(),
  ui_language: z.string(),
});

export const configValueSourcesSchema = z.object({
  whisper_binary_path: z.enum(['folder', 'home', 'default']),
  whisper_model: z.enum(['folder', 'home', 'default']),
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
  output_language: z.enum(['folder', 'home', 'default']),
  ui_language: z.enum(['folder', 'home', 'default']),
});

export const configEntrySchema = z.object({
  key: configKeySchema,
  value: z.string().nullable(),
  defaultValue: z.string(),
  description: z.string(),
  effectiveValue: z.string(),
  source: z.enum(['folder', 'home', 'default']),
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
  folder: z.string().min(1).optional(),
  key: configKeySchema,
  value: z.string(),
});

export const configSetOutputSchema = z.object({
  key: configKeySchema,
  value: z.string(),
  previousValue: z.string().nullable(),
});

export const credentialSetInputSchema = z.object({
  providerId: z.string().trim().min(1),
  credential: z.string().min(1),
});

export const credentialSetOutputSchema = z.object({
  providerId: z.string().min(1),
  stored: z.literal(true),
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

export const whisperModelDeleteInputSchema = whisperModelDownloadInputSchema;

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
  url: z.string().url(),
  license: z.string().min(1),
  path: z.string().min(1),
  downloaded: z.boolean(),
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
});

export const readinessOutputSchema = z.object({
  ready: z.boolean(),
  analyzer: readinessComponentSchema.extend({
    kind: z.literal('analyzer'),
    family: z.enum(['api', 'harness', 'local']),
    providerId: z.string(),
  }),
  transcriber: readinessComponentSchema.extend({
    kind: z.literal('transcriber'),
    mode: z.enum(WHISPER_MODES),
    model: z.enum(WHISPER_MODEL_NAMES).nullable(),
  }),
  missingPieces: z.array(readinessComponentSchema),
  suggestedAction: z.string().nullable(),
});

export const readinessInputSchema = z.object({
  folder: z.string().min(1).optional(),
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
  configured: readinessOutputSchema,
});

export const checkOutputSchema = z.object({
  hasNestedDatabases: z.boolean(),
  nestedPaths: z.array(z.string()),
  basePath: z.string(),
  scannedDirectories: z.number().int().nonnegative(),
});

export const jobStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']);
export const jobKindSchema = z.enum([
  'process',
  'process_drive',
  'whisper_download',
  'whisper_runtime_install',
  'local_ai_pull',
  'face_artifact_download',
  'faces_index',
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
  'faces_clustering',
  'faces_done',
  'catalog_index_skipped',
]);

export const jobProgressSchema = z.object({
  step: jobProgressStepSchema,
  percentage: z.number().min(0).max(100).optional(),
  current: z.number().int().nonnegative().optional(),
  total: z.number().int().positive().optional(),
  stepNumber: z.number().int().positive().optional(),
  totalSteps: z.number().int().positive().optional(),
  data: z.record(z.unknown()).optional(),
});

export const sequencedJobProgressSchema = z.object({
  sequence: z.number().int().positive(),
  progress: jobProgressSchema,
});

export const jobResultSchema = z.union([
  processCompletedOutputSchema,
  driveRunSummarySchema,
  whisperModelDownloadOutputSchema,
  whisperRuntimeInstallOutputSchema,
  localAiPullOutputSchema,
  faceArtifactsStatusOutputSchema,
  z.object({
    root: z.string().min(1),
    filesScanned: z.number().int().nonnegative(),
    filesIndexed: z.number().int().nonnegative(),
    observationsAdded: z.number().int().nonnegative(),
    peopleCreated: z.number().int().nonnegative(),
  }),
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
  folderId: z.string().min(1),
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
  folderId: z.string().uuid().nullable(),
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

export const searchInputSchema = z.object({
  query: z.string().min(1),
  limit: queryInteger(50, 1, 200),
  offset: queryInteger(0, 0, 100_000),
});

export const searchResultSchema = z.object({
  fingerprint: z.string().min(1),
  fileName: z.string().min(1),
  finalName: z.string().nullable(),
  description: z.string().nullable(),
  snippet: z.string(),
  tags: z.array(z.string()),
  folder: z.object({
    folderId: z.string().uuid(),
    currentPath: z.string().min(1),
    displayName: z.string(),
    online: z.boolean(),
  }),
  gps: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }).nullable(),
  missing: z.boolean(),
});

export const searchOutputSchema = z.object({
  query: z.string(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
  results: z.array(searchResultSchema),
});

export const facesIndexInputSchema = z.object({
  root: z.string().min(1),
});

export const facePersonSchema = z.object({
  personId: z.string().min(1),
  displayName: z.string().nullable(),
  kind: z.literal('face'),
  createdAt: z.string().datetime(),
  centroid: z.array(z.number()).length(128),
  exemplarCount: z.number().int().nonnegative(),
  observationCount: z.number().int().nonnegative(),
  exemplarCropPath: z.string().min(1).nullable(),
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
  staleVersionFiles: z.number().int().nonnegative(),
});

export interface RouteDescriptor<Input extends z.ZodTypeAny, Output extends z.ZodTypeAny> {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  input: Input;
  output: Output;
}

export const API_ROUTES = {
  health: { method: 'GET', path: '/api/health', input: emptyInputSchema, output: healthOutputSchema },
  scan: { method: 'GET', path: '/api/scan', input: folderInputSchema, output: scanOutputSchema },
  catalogTree: { method: 'GET', path: '/api/catalog-tree', input: folderInputSchema, output: catalogTreeOutputSchema },
  process: { method: 'POST', path: '/api/process', input: processInputSchema, output: jobAcceptedOutputSchema },
  processDrive: { method: 'POST', path: '/api/process-drive', input: processDriveInputSchema, output: jobAcceptedOutputSchema },
  thumbnail: { method: 'POST', path: '/api/thumbnail', input: thumbnailInputSchema, output: thumbnailOutputSchema },
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
  credentialSet: {
    method: 'POST',
    path: '/api/credentials',
    input: credentialSetInputSchema,
    output: credentialSetOutputSchema,
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
  indexStatus: { method: 'GET', path: '/api/index/status', input: emptyInputSchema, output: indexStatusOutputSchema },
  indexRebuild: { method: 'POST', path: '/api/index/rebuild', input: emptyInputSchema, output: indexRebuildOutputSchema },
  indexForget: { method: 'POST', path: '/api/index/forget', input: indexForgetInputSchema, output: indexForgetOutputSchema },
  tagsList: { method: 'GET', path: '/api/tags', input: emptyInputSchema, output: tagsListOutputSchema },
  tagsAlias: { method: 'POST', path: '/api/tags/alias', input: tagsAliasInputSchema, output: tagsAliasOutputSchema },
  searchQuery: { method: 'GET', path: '/api/search', input: searchInputSchema, output: searchOutputSchema },
  facesIndex: { method: 'POST', path: '/api/faces/index', input: facesIndexInputSchema, output: jobAcceptedOutputSchema },
  facesPeople: { method: 'GET', path: '/api/faces/people', input: emptyInputSchema, output: facesPeopleOutputSchema },
  facesName: { method: 'POST', path: '/api/faces/name', input: facesNameInputSchema, output: facesNameOutputSchema },
  facesMerge: { method: 'POST', path: '/api/faces/merge', input: facesMergeInputSchema, output: facesMergeOutputSchema },
  facesForget: { method: 'POST', path: '/api/faces/forget', input: facesForgetInputSchema, output: facesForgetOutputSchema },
  facesPurge: { method: 'POST', path: '/api/faces/purge', input: facesPurgeInputSchema, output: facesPurgeOutputSchema },
  facesStatus: { method: 'GET', path: '/api/faces/status', input: emptyInputSchema, output: facesStatusOutputSchema },
} as const satisfies Record<string, RouteDescriptor<z.ZodTypeAny, z.ZodTypeAny>>;

export type HttpMethod = (typeof API_ROUTES)[keyof typeof API_ROUTES]['method'];
export type ReadMethod = Extract<HttpMethod, 'GET'>;
export type WriteMethod = Exclude<HttpMethod, ReadMethod>;

export const API_PATHS = {
  health: API_ROUTES.health.path,
  scan: API_ROUTES.scan.path,
  catalogTree: API_ROUTES.catalogTree.path,
  process: API_ROUTES.process.path,
  processDrive: API_ROUTES.processDrive.path,
  thumbnail: API_ROUTES.thumbnail.path,
  status: API_ROUTES.status.path,
  resetAll: API_ROUTES.resetAll.path,
  resetSingle: API_ROUTES.resetSingle.path,
  configGet: API_ROUTES.configGet.path,
  configSet: API_ROUTES.configSet.path,
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
  indexStatus: API_ROUTES.indexStatus.path,
  indexRebuild: API_ROUTES.indexRebuild.path,
  indexForget: API_ROUTES.indexForget.path,
  tagsList: API_ROUTES.tagsList.path,
  tagsAlias: API_ROUTES.tagsAlias.path,
  searchQuery: API_ROUTES.searchQuery.path,
  facesIndex: API_ROUTES.facesIndex.path,
  facesPeople: API_ROUTES.facesPeople.path,
  facesName: API_ROUTES.facesName.path,
  facesMerge: API_ROUTES.facesMerge.path,
  facesForget: API_ROUTES.facesForget.path,
  facesPurge: API_ROUTES.facesPurge.path,
  facesStatus: API_ROUTES.facesStatus.path,
} as const;
