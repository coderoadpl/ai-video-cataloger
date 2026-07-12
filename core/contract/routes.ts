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
  configKeySchema,
  videoStatusSchema,
} from '@core/domain/index.js';

export const healthOutputSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
});

const emptyInputSchema = z.object({});
const folderInputSchema = z.object({ folder: z.string().min(1) });
const videoPathInputSchema = z.object({ videoPath: z.string().min(1) });
const forceInputSchema = z.object({ force: z.boolean().default(false) });
const jobIdInputSchema = z.object({ jobId: z.string().min(1) });

export const summarySchema = z.object({
  schemaVersion: z.literal(1),
  description: z.string(),
  suggestedFilename: z.string(),
  fullAnalysis: z.string(),
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
  frames: z.number().int().min(1).max(10).default(CONFIG_DEFAULTS.frames),
  skipRename: z.boolean().default(CONFIG_DEFAULTS.skip_rename),
  verbose: z.boolean().default(false),
  timeout: z.number().int().min(30).max(600).default(CONFIG_DEFAULTS.timeout),
  whisper: z.enum(WHISPER_MODES).default(CONFIG_DEFAULTS.whisper_mode),
  whisperModel: z.enum(WHISPER_MODEL_NAMES).default(CONFIG_DEFAULTS.whisper_model),
  analyzer: z.enum(ANALYZER_BACKENDS).optional(),
  localModel: z.string().min(1).optional(),
});

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

export const resetAllInputSchema = forceInputSchema;

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
  key: configKeySchema.nullable().default(null),
});

export const storedConfigSchema = z.object({
  whisper_model: z.string().nullable(),
  whisper_mode: z.string().nullable(),
  frames: z.string().nullable(),
  timeout: z.string().nullable(),
  skip_rename: z.string().nullable(),
  analyzer_backend: z.string().nullable(),
  local_model: z.string().nullable(),
});

export const storedConfigDefaultsSchema = z.object({
  whisper_model: z.string(),
  whisper_mode: z.string(),
  frames: z.string(),
  timeout: z.string(),
  skip_rename: z.string(),
  analyzer_backend: z.string(),
  local_model: z.string(),
});

export const configEntrySchema = z.object({
  key: configKeySchema,
  value: z.string().nullable(),
  defaultValue: z.string(),
  description: z.string(),
});

export const configGetOutputSchema = z.union([
  z.object({
    config: storedConfigSchema,
    defaults: storedConfigDefaultsSchema,
  }),
  configEntrySchema,
]);

export const configSetInputSchema = z.object({
  key: configKeySchema,
  value: z.string(),
});

export const configSetOutputSchema = z.object({
  key: configKeySchema,
  value: z.string(),
  previousValue: z.string().nullable(),
});

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
  source: z.union([z.literal('bundled'), z.literal('system')]).nullable(),
  path: z.string().nullable(),
  installHint: z.string(),
});

export const doctorOutputSchema = z.object({
  dependencies: z.array(dependencyStatusSchema),
  machine: machineSchema,
  recommendedLocalModel: z.string().nullable(),
  allAvailable: z.boolean(),
});

export const checkOutputSchema = z.object({
  hasNestedDatabases: z.boolean(),
  nestedPaths: z.array(z.string()),
  basePath: z.string(),
  scannedDirectories: z.number().int().nonnegative(),
});

export const jobStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']);
export const jobKindSchema = z.enum(['process', 'whisper_download', 'local_ai_pull']);

export const jobProgressSchema = z.object({
  step: z.string(),
  percentage: z.number().min(0).max(100).optional(),
  current: z.number().int().nonnegative().optional(),
  total: z.number().int().positive().optional(),
  data: z.record(z.unknown()).optional(),
});

export const jobResultSchema = z.union([
  processCompletedOutputSchema,
  whisperModelDownloadOutputSchema,
  localAiPullOutputSchema,
]);

export const jobOutputSchema = z.object({
  jobId: z.string(),
  kind: jobKindSchema,
  status: jobStatusSchema,
  progress: jobProgressSchema.nullable(),
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
  status: { method: 'GET', path: '/api/status', input: emptyInputSchema, output: statusOutputSchema },
  resetAll: { method: 'POST', path: '/api/reset/all', input: resetAllInputSchema, output: resetAllOutputSchema },
  resetSingle: {
    method: 'POST',
    path: '/api/reset/single',
    input: resetSingleInputSchema,
    output: resetSingleOutputSchema,
  },
  configGet: { method: 'GET', path: '/api/config', input: configGetInputSchema, output: configGetOutputSchema },
  configSet: { method: 'POST', path: '/api/config', input: configSetInputSchema, output: configSetOutputSchema },
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
  check: { method: 'GET', path: '/api/check', input: folderInputSchema, output: checkOutputSchema },
  jobStatus: { method: 'GET', path: '/api/jobs/status', input: jobIdInputSchema, output: jobOutputSchema },
  jobsList: { method: 'GET', path: '/api/jobs', input: emptyInputSchema, output: jobsListOutputSchema },
  jobCancel: { method: 'POST', path: '/api/jobs/cancel', input: jobIdInputSchema, output: jobCancelOutputSchema },
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
  whisperModelsList: API_ROUTES.whisperModelsList.path,
  whisperModelDownload: API_ROUTES.whisperModelDownload.path,
  whisperModelDelete: API_ROUTES.whisperModelDelete.path,
  whisperModelUse: API_ROUTES.whisperModelUse.path,
  localAiRequirements: API_ROUTES.localAiRequirements.path,
  localAiPull: API_ROUTES.localAiPull.path,
  localAiRm: API_ROUTES.localAiRm.path,
  localAiDaemonStop: API_ROUTES.localAiDaemonStop.path,
  doctor: API_ROUTES.doctor.path,
  check: API_ROUTES.check.path,
  jobStatus: API_ROUTES.jobStatus.path,
  jobsList: API_ROUTES.jobsList.path,
  jobCancel: API_ROUTES.jobCancel.path,
} as const;
