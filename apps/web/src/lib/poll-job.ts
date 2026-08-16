export interface JobPoller<T> {
  fetchJob: (jobId: string, signal?: AbortSignal) => Promise<T>;
  delay: (ms: number, signal?: AbortSignal) => Promise<void>;
  intervalMs?: number;
  isTerminal: (snapshot: T) => boolean;
  onSnapshot?: (job: T) => void;
  shouldStop?: () => boolean;
  signal?: AbortSignal | undefined;
}

const DEFAULT_INTERVAL_MS = 1000;

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new DOMException('Polling cancelled', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new DOMException('Polling cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });

export const pollJobUntilTerminal = async <T>(jobId: string, poller: JobPoller<T>): Promise<T> => {
  const intervalMs = poller.intervalMs ?? DEFAULT_INTERVAL_MS;
  const stopped = (): boolean => poller.signal?.aborted === true || poller.shouldStop?.() === true;
  if (poller.signal?.aborted === true) throw new DOMException('Polling cancelled', 'AbortError');
  let snapshot = await poller.fetchJob(jobId, poller.signal);
  poller.onSnapshot?.(snapshot);

  while (!poller.isTerminal(snapshot)) {
    if (stopped()) return snapshot;
    await poller.delay(intervalMs, poller.signal);
    if (stopped()) return snapshot;
    snapshot = await poller.fetchJob(jobId, poller.signal);
    poller.onSnapshot?.(snapshot);
  }

  return snapshot;
};
