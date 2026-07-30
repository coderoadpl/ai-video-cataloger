import {
  appError,
  ok,
  type AppError,
  type Result,
} from '@core/domain/index.js';
import {
  JOB_CANCELLED_ERROR_MESSAGE,
  type JobExecutionContext,
  type JobKind,
  type JobProgress,
  type JobRecord,
  type JobsPort,
} from '@core/server/index.js';

export interface InProcessJobsPortOptions {
  nowIso?: () => string;
  nextId?: () => string;
}

const MAX_TERMINAL_RECORDS = 200;
const MAX_PROGRESS_EVENTS = 500;

export class InProcessJobsPort implements JobsPort {
  private readonly records = new Map<string, JobRecord>();
  private readonly nowIso: () => string;
  private readonly nextId: () => string;
  private readonly controllers = new Map<string, AbortController>();
  private readonly cancellationRequests = new Set<string>();
  private readonly settleCallbacks = new Map<string, Array<() => void | Promise<void>>>();
  private readonly heldClaims = new Set<string>();
  private readonly waiters = new Map<string, Array<() => void>>();
  private nextNumber = 1;

  constructor(options: InProcessJobsPortOptions = {}) {
    this.nowIso = options.nowIso ?? (() => new Date().toISOString());
    this.nextId = options.nextId ?? (() => {
      const jobId = `job-${this.nextNumber}`;
      this.nextNumber += 1;
      return jobId;
    });
  }

  enqueue(input: {
    kind: JobKind;
    payload: unknown;
    resourceKey?: string | undefined;
    run?: (context: JobExecutionContext) => Promise<Result<unknown, AppError>>;
  }): Promise<Result<{ jobId: string }, AppError>> {
    if (input.resourceKey !== undefined && this.isResourceBusy(input.resourceKey)) {
      return Promise.resolve({
        ok: false,
        error: appError('conflict', `A ${input.kind} job is already running for ${input.resourceKey}`),
      });
    }
    const jobId = this.nextId();
    const now = this.nowIso();
    this.records.set(jobId, {
      jobId,
      kind: input.kind,
      status: 'queued',
      progress: null,
      progressEvents: [],
      error: null,
      createdAt: now,
      updatedAt: now,
      resourceKey: input.resourceKey,
    });
    const run = input.run;
    if (run === undefined) {
      this.records.delete(jobId);
      return Promise.resolve({ ok: false, error: appError('internal', `Job ${jobId} has no run function`) });
    }
    void Promise.resolve().then(() => this.runJob(jobId, run));
    return Promise.resolve(ok({ jobId }));
  }

  get(jobId: string): Promise<Result<JobRecord | null, AppError>> {
    return Promise.resolve(ok(this.records.get(jobId) ?? null));
  }

  list(): Promise<Result<JobRecord[], AppError>> {
    return Promise.resolve(ok([...this.records.values()]));
  }

  cancel(jobId: string): Promise<Result<{ jobId: string; cancelled: boolean }, AppError>> {
    const record = this.records.get(jobId);
    if (record === undefined) return Promise.resolve(ok({ jobId, cancelled: false }));
    if (isTerminal(record)) return Promise.resolve(ok({ jobId, cancelled: false }));
    this.cancellationRequests.add(jobId);
    this.controllers.get(jobId)?.abort();
    return Promise.resolve(ok({ jobId, cancelled: true }));
  }

  onSettled(jobId: string, callback: () => void | Promise<void>): void {
    const record = this.records.get(jobId);
    if (record !== undefined && isTerminal(record)) {
      void callback();
      return;
    }
    const existing = this.settleCallbacks.get(jobId) ?? [];
    existing.push(callback);
    this.settleCallbacks.set(jobId, existing);
  }

  acquireResource(key: string, signal?: AbortSignal | undefined): Promise<Result<() => void, AppError>> {
    if (signal?.aborted === true) return Promise.resolve({ ok: false, error: cancellationError() });
    if (!this.isResourceBusy(key)) {
      this.heldClaims.add(key);
      return Promise.resolve(ok(this.claimRelease(key)));
    }
    return new Promise((resolve) => {
      const waiter = (): void => {
        this.heldClaims.add(key);
        resolve(ok(this.claimRelease(key)));
      };
      const queue = this.waiters.get(key) ?? [];
      queue.push(waiter);
      this.waiters.set(key, queue);
      if (signal !== undefined) {
        signal.addEventListener('abort', () => {
          const pending = this.waiters.get(key);
          if (pending === undefined) return;
          const index = pending.indexOf(waiter);
          if (index === -1) return;
          pending.splice(index, 1);
          resolve({ ok: false, error: cancellationError() });
        }, { once: true });
      }
    });
  }

  private isResourceBusy(key: string): boolean {
    if (this.heldClaims.has(key)) return true;
    return [...this.records.values()].some((record) => record.resourceKey === key && !isTerminal(record));
  }

  private claimRelease(key: string): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.heldClaims.delete(key);
      this.wakeNextWaiter(key);
    };
  }

  private wakeNextWaiter(key: string): void {
    const queue = this.waiters.get(key);
    if (queue === undefined || queue.length === 0) return;
    const next = queue.shift();
    if (queue.length === 0) this.waiters.delete(key);
    next?.();
  }

  private async runJob(
    jobId: string,
    run: (context: JobExecutionContext) => Promise<Result<unknown, AppError>>,
  ): Promise<void> {
    const queued = this.records.get(jobId);
    if (queued === undefined || queued.status === 'cancelled') {
      this.fireSettleCallbacks(jobId);
      return;
    }
    this.records.set(jobId, { ...queued, status: 'running', updatedAt: this.nowIso() });

    const controller = new AbortController();
    this.controllers.set(jobId, controller);
    if (this.cancellationRequests.has(jobId)) controller.abort();

    const result = await runSafely(run, {
      signal: controller.signal,
      reportProgress: (progress) => this.reportProgress(jobId, progress),
    });

    const current = this.records.get(jobId);
    this.controllers.delete(jobId);
    if (current === undefined) {
      this.fireSettleCallbacks(jobId);
      return;
    }
    const cancelled = this.cancellationRequests.delete(jobId) && !result.ok;
    this.records.set(jobId, {
      ...current,
      status: result.ok ? 'completed' : cancelled ? 'cancelled' : 'failed',
      result: result.ok ? result.value : undefined,
      error: result.ok || cancelled ? null : result.error,
      updatedAt: this.nowIso(),
    });
    this.fireSettleCallbacks(jobId);
    this.evictOldTerminalRecords();
    if (current.resourceKey !== undefined) this.wakeNextWaiter(current.resourceKey);
  }

  private fireSettleCallbacks(jobId: string): void {
    const callbacks = this.settleCallbacks.get(jobId);
    if (callbacks === undefined) return;
    this.settleCallbacks.delete(jobId);
    for (const callback of callbacks) void callback();
  }

  private reportProgress(jobId: string, progress: JobProgress): Promise<Result<void, AppError>> {
    const record = this.records.get(jobId);
    if (record === undefined) {
      return Promise.resolve({ ok: false, error: appError('not_found', `Job not found: ${jobId}`) });
    }
    if (record.status === 'cancelled') {
      return Promise.resolve({ ok: false, error: cancellationError() });
    }
    if (isTerminal(record)) {
      return Promise.resolve({ ok: false, error: appError('processing_error', `Job is already ${record.status}`) });
    }
    if (this.cancellationRequests.has(jobId)) {
      return Promise.resolve({ ok: false, error: cancellationError() });
    }
    const sequence = (record.progressEvents.at(-1)?.sequence ?? 0) + 1;
    const progressEvents = [...record.progressEvents, { sequence, progress }].slice(-MAX_PROGRESS_EVENTS);
    this.records.set(jobId, { ...record, status: 'running', progress, progressEvents, updatedAt: this.nowIso() });
    return Promise.resolve(ok(undefined));
  }

  private evictOldTerminalRecords(): void {
    const terminalIds = [...this.records.values()].filter(isTerminal).map((record) => record.jobId);
    for (const jobId of terminalIds.slice(0, -MAX_TERMINAL_RECORDS)) this.records.delete(jobId);
  }
}

const runSafely = async (
  run: (context: JobExecutionContext) => Promise<Result<unknown, AppError>>,
  context: JobExecutionContext,
): Promise<Result<unknown, AppError>> => {
  try {
    return await run(context);
  } catch (cause) {
    return { ok: false, error: appError('internal', 'Job failed unexpectedly', cause) };
  }
};

const cancellationError = (): AppError =>
  appError('processing_error', JOB_CANCELLED_ERROR_MESSAGE);

const isTerminal = (record: JobRecord): boolean =>
  record.status === 'completed' || record.status === 'failed' || record.status === 'cancelled';
