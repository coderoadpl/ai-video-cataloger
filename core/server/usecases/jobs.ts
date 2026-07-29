import {
  appError,
  ok,
  type AppError,
  type Result,
  type WhisperLanguage,
  type WhisperModelName,
} from '@core/domain/index.js';

import type { FileSystemPort, GlobalCatalogStore, JobRecord, JobsPort } from '../ports.js';
import { checkProcessPrerequisites, processVideoPipeline, type ProcessDeps } from './process.js';
import { processDrive, type ProcessDriveInput } from './process-drive.js';
import { materializeCatalog, type MaterializeInput } from './materialize.js';

export interface JobsDeps extends Partial<ProcessDeps> {
  jobs: JobsPort;
}

export interface ProcessInput {
  videoPath: string;
  frames: number;
  framesExplicit?: boolean | undefined;
  skipRename: boolean;
  skipRenameExplicit?: boolean | undefined;
  verbose: boolean;
  timeout: number;
  timeoutExplicit?: boolean | undefined;
  whisper: 'local' | 'api' | 'skip';
  whisperExplicit?: boolean | undefined;
  whisperModel: WhisperModelName;
  whisperModelExplicit?: boolean | undefined;
  whisperLanguage?: WhisperLanguage | undefined;
  whisperLanguageExplicit?: boolean | undefined;
  analyzer?: 'claude' | 'local' | 'api' | undefined;
  localModel?: string | undefined;
  force?: boolean | undefined;
  batch?: { current: number; total: number } | undefined;
}

export const enqueueProcess = async (
  deps: JobsDeps,
  input: ProcessInput,
): Promise<Result<{ jobId: string }, AppError>> => {
  if (
    deps.catalogs === undefined ||
    deps.config === undefined ||
    deps.fs === undefined ||
    deps.media === undefined ||
    deps.transcriber === undefined ||
    deps.analyzer === undefined
  ) {
    return { ok: false, error: appError('internal', 'Process job dependencies are incomplete') };
  }
  const resourceKey = deps.fs.resolve(input.videoPath);
  const listed = await deps.jobs.list();
  if (!listed.ok) return listed;
  const duplicate = listed.value.some((job) =>
    job.kind === 'process'
    && (job.status === 'queued' || job.status === 'running')
    && job.resourceKey === resourceKey);
  if (duplicate) {
    return { ok: false, error: appError('conflict', `A process job is already running for ${resourceKey}`) };
  }
  const processDeps: ProcessDeps = {
    catalogs: deps.catalogs,
    config: deps.config,
    fs: deps.fs,
    media: deps.media,
    transcriber: deps.transcriber,
    analyzer: deps.analyzer,
    ...(deps.globalCatalog === undefined ? {} : { globalCatalog: deps.globalCatalog }),
    ...(deps.spendLedger === undefined ? {} : { spendLedger: deps.spendLedger }),
  };
  const prerequisites = await checkProcessPrerequisites(processDeps, input);
  if (!prerequisites.ok) return prerequisites;
  return deps.jobs.enqueue({
    kind: 'process',
    payload: input,
    resourceKey,
    run: (context) => processVideoPipeline(processDeps, input, context),
  });
};

export const enqueueProcessDrive = async (
  deps: JobsDeps,
  input: ProcessDriveInput,
): Promise<Result<{ jobId: string }, AppError>> => {
  if (
    deps.catalogs === undefined ||
    deps.config === undefined ||
    deps.fs === undefined ||
    deps.media === undefined ||
    deps.transcriber === undefined ||
    deps.analyzer === undefined ||
    deps.globalCatalog === undefined
  ) {
    return { ok: false, error: appError('internal', 'Drive process job dependencies are incomplete') };
  }
  const resourceKey = deps.fs.resolve(input.root);
  const processDeps: ProcessDeps = {
    catalogs: deps.catalogs,
    config: deps.config,
    fs: deps.fs,
    media: deps.media,
    transcriber: deps.transcriber,
    analyzer: deps.analyzer,
    ...(deps.analyzerBatch === undefined ? {} : { analyzerBatch: deps.analyzerBatch }),
    globalCatalog: deps.globalCatalog,
    ...(deps.spendLedger === undefined ? {} : { spendLedger: deps.spendLedger }),
    ...(deps.downloads === undefined ? {} : { downloads: deps.downloads }),
    ...(deps.faceEngine === undefined ? {} : { faceEngine: deps.faceEngine }),
  };
  return deps.jobs.enqueue({
    kind: 'process_drive',
    payload: input,
    resourceKey,
    run: (context) => processDrive(processDeps, input, context),
  });
};

export const enqueueMaterialize = async (
  deps: JobsDeps,
  input: MaterializeInput,
): Promise<Result<{ jobId: string }, AppError>> => {
  if (deps.fs === undefined || deps.globalCatalog === undefined) {
    return { ok: false, error: appError('internal', 'Materialize job dependencies are incomplete') };
  }
  const fs: FileSystemPort = deps.fs;
  const globalCatalog: GlobalCatalogStore = deps.globalCatalog;
  const resourceKey = fs.resolve(input.root);
  return deps.jobs.enqueue({
    kind: 'materialize',
    payload: input,
    resourceKey,
    run: (context) => materializeCatalog({ fs, globalCatalog }, input, context),
  });
};

export const getJobStatus = async (
  deps: JobsDeps,
  input: { jobId: string },
): Promise<Result<JobRecord, AppError>> => {
  const job = await deps.jobs.get(input.jobId);
  if (!job.ok) return job;
  if (job.value === null) return { ok: false, error: appError('not_found', `Job not found: ${input.jobId}`) };
  return ok(job.value);
};

export const listJobs = async (deps: JobsDeps): Promise<Result<{ jobs: JobRecord[] }, AppError>> => {
  const jobs = await deps.jobs.list();
  if (!jobs.ok) return jobs;
  return ok({ jobs: jobs.value });
};

export const cancelJob = async (
  deps: JobsDeps,
  input: { jobId: string },
): Promise<Result<{ jobId: string; cancelled: boolean }, AppError>> =>
  deps.jobs.cancel(input.jobId);
