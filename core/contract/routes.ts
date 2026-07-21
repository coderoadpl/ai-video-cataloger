import { z } from 'zod';

import {
  ANALYZER_BACKENDS,
  CONFIG_DEFAULTS,
  ERROR_CODES,
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

export const summarySchema = z.object({
  schemaVersion: z.literal(1),
  description: z.string(),
  suggestedFilename: z.string(),
  fullAnalysis: z.string(),
  tags: z.array(z.string()).default([]),
  analyzedAt: z.string(),
});

export const scanVideoArtifactsSchema = z.object({
  framePaths: z.array(z.string()).nullable(),
  transcriptContent: z.string().nullable(),
  transcriptPath: z.string().nullable(),
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

export const jobAcceptedOutputSchema = z.object({
  jobId: z.string(),
});

export const processCompletedOutputSchema = z.object({
  video: z.string(),
  path: z.string(),
  status: z.literal('completed'),
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
  configured: readinessOutputSchema,
});

export const checkOutputSchema = z.object({
  hasNestedDatabases: z.boolean(),
  nestedPaths: z.array(z.string()),
  basePath: z.string(),
  scannedDirectories: z.number().int().nonnegative(),
});

export const jobStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']);
export const jobKindSchema = z.enum(['process', 'whisper_download', 'whisper_runtime_install', 'local_ai_pull']);
export const jobProgressStepSchema = z.enum([
  'extracting_frames',
  'extracting_audio',
  'transcribing_audio',
  'analyzing_with_claude',
  'renaming_video',
  'skipping_rename',
  'downloading',
  'runtime_setup',
  'model_download',
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
  whisperModelDownloadOutputSchema,
  whisperRuntimeInstallOutputSchema,
  localAiPullOutputSchema,
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
});

export const indexRebuildOutputSchema = z.object({
  databasePath: z.string(),
  reconciledFolders: z.number().int().nonnegative(),
  importedFiles: z.number().int().nonnegative(),
  folders: z.array(indexStatusFolderSchema),
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

export interface RouteDescriptor<Input extends z.ZodTypeAny, Output extends z.ZodTypeAny> {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  input: Input;
  output: Output;
}

export const API_ROUTES = {
  health: { method: 'GET', path: '/api/health', input: emptyInputSchema, output: healthOutputSchema },
  scan: { method: 'GET', path: '/api/scan', input: folderInputSchema, output: scanOutputSchema },
  process: { method: 'POST', path: '/api/process', input: processInputSchema, output: jobAcceptedOutputSchema },
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
  tagsList: { method: 'GET', path: '/api/tags', input: emptyInputSchema, output: tagsListOutputSchema },
  tagsAlias: { method: 'POST', path: '/api/tags/alias', input: tagsAliasInputSchema, output: tagsAliasOutputSchema },
} as const satisfies Record<string, RouteDescriptor<z.ZodTypeAny, z.ZodTypeAny>>;

export type HttpMethod = (typeof API_ROUTES)[keyof typeof API_ROUTES]['method'];
export type ReadMethod = Extract<HttpMethod, 'GET'>;
export type WriteMethod = Exclude<HttpMethod, ReadMethod>;

export const API_PATHS = {
  health: API_ROUTES.health.path,
  scan: API_ROUTES.scan.path,
  process: API_ROUTES.process.path,
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
  tagsList: API_ROUTES.tagsList.path,
  tagsAlias: API_ROUTES.tagsAlias.path,
} as const;
