import type { JobOutput } from '@core/client/index.js';
import { appError, type AppError, type Result } from '@core/domain/index.js';

export interface WaitForJobOptions {
  fetchJob(jobId: string): Promise<Result<JobOutput, AppError>>;
  onProgress(progress: NonNullable<JobOutput['progress']>): void;
  onCompleted(data: unknown): void;
  onError(error: AppError): void;
  now?: () => number;
  delay?: (milliseconds: number) => Promise<void>;
  pollIntervalMs?: number;
  inactivityMs?: number;
}

export const waitForJob = async (jobId: string, options: WaitForJobOptions): Promise<void> => {
  const now = options.now ?? Date.now;
  const delay = options.delay ?? sleep;
  const pollIntervalMs = options.pollIntervalMs ?? 25;
  const inactivityMs = options.inactivityMs ?? 10 * 60 * 1000;
  let lastUpdatedAt: string | null = null;
  let lastActivityAt = now();
  let lastProgressSequence = 0;

  while (true) {
    const job = await options.fetchJob(jobId);
    if (!job.ok) {
      options.onError(job.error);
      return;
    }
    if (job.value.updatedAt !== lastUpdatedAt) {
      lastUpdatedAt = job.value.updatedAt;
      lastActivityAt = now();
    }
    for (const event of job.value.progressEvents) {
      if (event.sequence <= lastProgressSequence) continue;
      lastProgressSequence = event.sequence;
      options.onProgress(event.progress);
    }
    if (job.value.status === 'completed') {
      options.onCompleted(job.value.result);
      return;
    }
    if (job.value.status === 'failed') {
      options.onError(job.value.error ?? appError('internal', 'Job failed without an error'));
      return;
    }
    if (job.value.status === 'cancelled') {
      options.onError(appError('processing_error', 'Job cancelled'));
      return;
    }
    if (job.value.kind !== 'process' && now() - lastActivityAt >= inactivityMs) {
      options.onError(appError('internal', `Job made no progress for 10 minutes: ${jobId}`));
      return;
    }
    await delay(pollIntervalMs);
  }
};

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
