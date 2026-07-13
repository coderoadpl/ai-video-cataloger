import { isTerminalJobStatus, type JobOutput } from '@core/client/index.js';

export interface RunJobOptions {
  /** Fetches a fresh job snapshot (a bound `job` query via `fetchQuery`). */
  fetchJob: (jobId: string) => Promise<JobOutput>;
  /** Resolves after `ms`; injectable so tests run without real timers. */
  delay: (ms: number) => Promise<void>;
  intervalMs?: number;
  onSnapshot?: (job: JobOutput) => void;
}

const DEFAULT_INTERVAL_MS = 1000;

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Drives a single model-management job (whisper download, local-AI pull) to a
 * terminal status and returns the final snapshot, surfacing each snapshot so the
 * modal's progress bar can advance (Delta 5). The catalog processing island has
 * its own batch-aware poller; a model download is a lone job, so this stays a
 * flat loop scoped to this island.
 */
export const runJobToTerminal = async (jobId: string, options: RunJobOptions): Promise<JobOutput> => {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  let snapshot = await options.fetchJob(jobId);
  options.onSnapshot?.(snapshot);

  while (!isTerminalJobStatus(snapshot.status)) {
    await options.delay(intervalMs);
    snapshot = await options.fetchJob(jobId);
    options.onSnapshot?.(snapshot);
  }

  return snapshot;
};
