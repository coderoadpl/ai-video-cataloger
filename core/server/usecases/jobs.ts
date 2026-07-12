import { appError, ok, type AppError, type Result } from '@core/domain/index.js';

import type { JobRecord, JobsPort } from '../ports.js';
import { processVideoPipeline, type ProcessDeps } from './process.js';

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
  whisperModel: 'tiny' | 'base' | 'small' | 'medium' | 'large-v3';
  whisperModelExplicit?: boolean | undefined;
  analyzer?: 'claude' | 'local' | undefined;
  localModel?: string | undefined;
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
    return deps.jobs.enqueue({ kind: 'process', payload: input });
  }
  const processDeps: ProcessDeps = {
    catalogs: deps.catalogs,
    config: deps.config,
    fs: deps.fs,
    media: deps.media,
    transcriber: deps.transcriber,
    analyzer: deps.analyzer,
  };
  return deps.jobs.enqueue({
    kind: 'process',
    payload: input,
    run: (context) => processVideoPipeline(processDeps, input, context),
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
