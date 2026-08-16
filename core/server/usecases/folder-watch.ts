import { ok, type AppError, type Result } from '@core/domain/index.js';

import type { FolderWatcherPort, JobKind, JobsPort } from '../ports.js';

const RUN_JOB_KINDS: ReadonlySet<JobKind> = new Set<JobKind>(['process', 'process_drive', 'photo_process']);
const RESUME_POLL_MS = 2000;

export type WatchScheduler = (callback: () => void, delayMs: number) => () => void;

export interface FolderWatchDeps {
  watcher: FolderWatcherPort;
  jobs: Pick<JobsPort, 'list'>;
}

export interface FolderWatchOptions {
  resumePollMs?: number | undefined;
  schedule?: WatchScheduler | undefined;
  onStopped?: ((error: AppError) => void) | undefined;
}

export interface FolderWatchSession {
  stop(): void;
}

const realSchedule: WatchScheduler = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
};

export const isRunActive = async (jobs: Pick<JobsPort, 'list'>): Promise<boolean> => {
  const list = await jobs.list();
  if (!list.ok) return false;
  return list.value.some(
    (job) => RUN_JOB_KINDS.has(job.kind) && (job.status === 'running' || job.status === 'queued'),
  );
};

export const watchCatalogFolder = async (
  deps: FolderWatchDeps,
  root: string,
  onRefresh: () => void,
  options: FolderWatchOptions = {},
): Promise<Result<FolderWatchSession, AppError>> => {
  const resumePollMs = options.resumePollMs ?? RESUME_POLL_MS;
  const schedule = options.schedule ?? realSchedule;
  let stopped = false;
  let pumping = false;
  let releaseWait: (() => void) | null = null;

  const wait = (): Promise<void> =>
    new Promise<void>((resolve) => {
      const cancel = schedule(resolve, resumePollMs);
      releaseWait = () => {
        cancel();
        resolve();
      };
    });

  const refreshWhenIdle = async (): Promise<void> => {
    while (!stopped && (await isRunActive(deps.jobs))) await wait();
    releaseWait = null;
    if (!stopped) onRefresh();
  };

  const requestRefresh = (): void => {
    if (stopped || pumping) return;
    pumping = true;
    void refreshWhenIdle().finally(() => {
      pumping = false;
    });
  };

  const stop = (): void => {
    stopped = true;
    releaseWait?.();
    releaseWait = null;
  };

  const started = await deps.watcher.watch(root, requestRefresh, (error) => {
    stop();
    options.onStopped?.(error);
  });
  if (!started.ok) return started;

  return ok({
    stop: () => {
      stop();
      started.value.close();
    },
  });
};
