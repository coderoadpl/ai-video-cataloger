import { isTerminalJobStatus, type JobOutput } from '@core/client/index.js';

export interface JobPoller {
  /** Fetches the current job snapshot (a bound `job` query via `fetchQuery`). */
  fetchJob: (jobId: string) => Promise<JobOutput>;
  /** Resolves after `ms`; injectable so tests run without real timers. */
  delay: (ms: number) => Promise<void>;
  /** Poll interval between non-terminal snapshots (default 1000ms). */
  intervalMs?: number;
  /** Called with every snapshot, including the terminal one. */
  onSnapshot?: (job: JobOutput) => void;
  /** When it returns true between polls, stop early and return the last snapshot. */
  shouldStop?: () => boolean;
}

const DEFAULT_INTERVAL_MS = 1000;

/**
 * Polls a job to a terminal status and returns the final snapshot. Terminality
 * is decided by `core/client`'s `isTerminalJobStatus`, so the loop stops exactly
 * when the job is completed/failed/cancelled — the poll-helper contract the
 * renderer's progress overlay is driven by (Delta 5). Every snapshot is surfaced
 * via `onSnapshot` so progress can update between polls.
 */
export const pollJobUntilTerminal = async (jobId: string, poller: JobPoller): Promise<JobOutput> => {
  const intervalMs = poller.intervalMs ?? DEFAULT_INTERVAL_MS;
  let snapshot = await poller.fetchJob(jobId);
  poller.onSnapshot?.(snapshot);

  while (!isTerminalJobStatus(snapshot.status)) {
    if (poller.shouldStop?.() === true) return snapshot;
    await poller.delay(intervalMs);
    snapshot = await poller.fetchJob(jobId);
    poller.onSnapshot?.(snapshot);
  }

  return snapshot;
};
