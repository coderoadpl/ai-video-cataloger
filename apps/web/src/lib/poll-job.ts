export interface JobPoller<T> {
  fetchJob: (jobId: string) => Promise<T>;
  delay: (ms: number) => Promise<void>;
  intervalMs?: number;
  isTerminal: (snapshot: T) => boolean;
  onSnapshot?: (job: T) => void;
  shouldStop?: () => boolean;
}

const DEFAULT_INTERVAL_MS = 1000;

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const pollJobUntilTerminal = async <T>(jobId: string, poller: JobPoller<T>): Promise<T> => {
  const intervalMs = poller.intervalMs ?? DEFAULT_INTERVAL_MS;
  let snapshot = await poller.fetchJob(jobId);
  poller.onSnapshot?.(snapshot);

  while (!poller.isTerminal(snapshot)) {
    if (poller.shouldStop?.() === true) return snapshot;
    await poller.delay(intervalMs);
    snapshot = await poller.fetchJob(jobId);
    poller.onSnapshot?.(snapshot);
  }

  return snapshot;
};
