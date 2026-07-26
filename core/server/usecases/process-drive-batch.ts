import {
  appError,
  ok,
  type AnalyzerProviderConfig,
  type AppError,
  type Result,
} from '@core/domain/index.js';

import {
  JOB_CANCELLED_ERROR_MESSAGE,
  type AnalyzerBatchPort,
  type AnalyzerBatchRequest,
  type AnalyzerBatchStatus,
  type JobExecutionContext,
  type ProcessJobStep,
} from '../ports.js';

const POLL_BASE_MS = 5_000;
const POLL_MAX_MS = 300_000;
const POLL_ATTEMPT_LIMIT = 2_000;

export const reportStep = (
  progress: JobExecutionContext | undefined,
  step: ProcessJobStep,
  data: Record<string, unknown>,
): Promise<Result<void, AppError>> => {
  if (progress === undefined) return Promise.resolve(ok(undefined));
  return progress.reportProgress({ step, data });
};

export const batchPollDelayMs = (attempt: number): number =>
  Math.min(POLL_BASE_MS * Math.pow(2, attempt), POLL_MAX_MS);

export interface EnsureBatchJobInput {
  analyzerBatch: AnalyzerBatchPort;
  provider: AnalyzerProviderConfig;
  displayName: string;
  requests: readonly AnalyzerBatchRequest[];
  submittedBefore: boolean;
  signal?: AbortSignal | undefined;
}

export const ensureBatchJob = async (
  input: EnsureBatchJobInput,
): Promise<Result<{ jobName: string; reattached: boolean }, AppError>> => {
  if (input.submittedBefore) {
    const found = await input.analyzerBatch.findBatchByDisplayName({
      provider: input.provider,
      displayName: input.displayName,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (!found.ok) return found;
    if (found.value !== null) return ok({ jobName: found.value, reattached: true });
  }
  const submitted = await input.analyzerBatch.submitBatch({
    provider: input.provider,
    displayName: input.displayName,
    requests: input.requests,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  if (!submitted.ok) return submitted;
  return ok({ jobName: submitted.value.jobName, reattached: false });
};

export interface AwaitBatchResultsInput {
  analyzerBatch: AnalyzerBatchPort;
  provider: AnalyzerProviderConfig;
  jobName: string;
  requestKeys: readonly string[];
  progress?: JobExecutionContext | undefined;
  sleep: (milliseconds: number) => Promise<void>;
  pollDelayMs?: ((attempt: number) => number) | undefined;
}

export const awaitBatchResults = async (
  input: AwaitBatchResultsInput,
): Promise<Result<AnalyzerBatchStatus, AppError>> => {
  const delayMs = input.pollDelayMs ?? batchPollDelayMs;
  for (let attempt = 0; attempt < POLL_ATTEMPT_LIMIT; attempt += 1) {
    if (input.progress?.signal.aborted === true) {
      return { ok: false, error: appError('processing_error', JOB_CANCELLED_ERROR_MESSAGE) };
    }
    const status = await input.analyzerBatch.batchStatus({
      provider: input.provider,
      jobName: input.jobName,
      requestKeys: input.requestKeys,
      ...(input.progress === undefined ? {} : { signal: input.progress.signal }),
    });
    if (!status.ok) return status;
    const reported = await reportStep(input.progress, 'batch_poll', {
      jobName: input.jobName,
      state: status.value.state,
      attempt: attempt + 1,
      requestCount: input.requestKeys.length,
    });
    if (!reported.ok) return reported;
    if (status.value.state !== 'pending' && status.value.state !== 'running') return ok(status.value);
    await sleepUntilCancelled(input.sleep, delayMs(attempt), input.progress?.signal);
  }
  return { ok: false, error: appError('provider_error', `Gemini batch job ${input.jobName} did not finish before the poll limit`) };
};

// The backoff reaches five minutes, and a cancel that waits it out reads as a hung app.
const sleepUntilCancelled = (
  sleep: (milliseconds: number) => Promise<void>,
  milliseconds: number,
  signal: AbortSignal | undefined,
): Promise<void> => {
  if (signal === undefined) return sleep(milliseconds);
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const settle = (): void => {
      signal.removeEventListener('abort', settle);
      resolve();
    };
    signal.addEventListener('abort', settle, { once: true });
    void sleep(milliseconds).then(settle, settle);
  });
};

export const batchJobFailureError = (jobName: string, status: AnalyzerBatchStatus): AppError =>
  appError(
    'provider_error',
    `Gemini batch job ${jobName} ended as ${status.state}${status.message === null ? '' : `: ${status.message}`}. `
    + 'Re-run the same root to submit a new batch.',
  );

export const expiredBatchFileError = (jobName: string): AppError =>
  appError(
    'provider_error',
    `Gemini no longer holds batch job ${jobName} or its uploaded files (they live 48 hours). `
    + 'Re-run the same root to upload and submit again.',
  );
