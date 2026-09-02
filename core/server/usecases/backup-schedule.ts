import { ok, type AppError, type BackupState, type Result } from '@core/domain/index.js';

import type { JobRecord } from '../ports.js';
import { BACKUP_CONFLICTING_JOB_KINDS } from './backup-run.js';

export type BackupScheduleReason =
  | 'not-enabled'
  | 'no-change'
  | 'too-soon'
  | 'due'
  | 'catch-up'
  | 'blocked-by-job';

export interface BackupScheduleState {
  enabled: boolean;
  fingerprint: string;
  lastSuccessFingerprint: string | null;
  lastSuccessAt: string | null;
  blockedByJob: boolean;
}

export type BackupScheduleDecision = {
  action: 'run' | 'skip';
  reason: BackupScheduleReason;
};

export interface ScheduledBackupEvaluationDeps {
  enabled(): Promise<Result<boolean, AppError>>;
  fingerprint(): Promise<Result<string, AppError>>;
  readState(): Promise<Result<BackupState | null, AppError>>;
  listJobs(): Promise<Result<JobRecord[], AppError>>;
  enqueue(): Promise<Result<{ jobId: string }, AppError>>;
  now(): Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export const decideBackup = (state: BackupScheduleState, now: Date): BackupScheduleDecision => {
  if (!state.enabled) return { action: 'skip', reason: 'not-enabled' };
  if (state.fingerprint === state.lastSuccessFingerprint) return { action: 'skip', reason: 'no-change' };
  if (state.blockedByJob) return { action: 'skip', reason: 'blocked-by-job' };
  if (state.lastSuccessAt === null) return { action: 'run', reason: 'due' };
  const elapsed = now.getTime() - new Date(state.lastSuccessAt).getTime();
  if (!Number.isFinite(elapsed) || elapsed < DAY_MS) return { action: 'skip', reason: 'too-soon' };
  if (elapsed > DAY_MS * 2) return { action: 'run', reason: 'catch-up' };
  return { action: 'run', reason: 'due' };
};

export const evaluateScheduledBackup = async (
  deps: ScheduledBackupEvaluationDeps,
): Promise<Result<BackupScheduleDecision, AppError>> => {
  const enabled = await deps.enabled();
  if (!enabled.ok) return enabled;
  if (!enabled.value) return ok({ action: 'skip', reason: 'not-enabled' });
  const jobs = await deps.listJobs();
  if (!jobs.ok) return jobs;
  const blockedByJob = jobs.value.some((job) =>
    (job.status === 'queued' || job.status === 'running')
    && (job.kind === 'backup' || BACKUP_CONFLICTING_JOB_KINDS.has(job.kind)));
  if (blockedByJob) return ok({ action: 'skip', reason: 'blocked-by-job' });
  const fingerprint = await deps.fingerprint();
  if (!fingerprint.ok) return fingerprint;
  const state = await deps.readState();
  if (!state.ok) return state;
  const decision = decideBackup({
    enabled: true,
    fingerprint: fingerprint.value,
    lastSuccessFingerprint: state.value?.lastFingerprint ?? null,
    lastSuccessAt: state.value?.lastSuccessAt ?? null,
    blockedByJob: false,
  }, deps.now());
  if (decision.action === 'skip') return ok(decision);
  const enqueued = await deps.enqueue();
  if (!enqueued.ok) {
    return enqueued.error.code === 'conflict'
      ? ok({ action: 'skip', reason: 'blocked-by-job' })
      : enqueued;
  }
  return ok(decision);
};

export const startBackupSchedule = (evaluate: () => Promise<void>): { stop(): void } => {
  let running = false;
  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await evaluate();
    } finally {
      running = false;
    }
  };
  void run().catch(() => undefined);
  const timer = setInterval(() => {
    void run().catch(() => undefined);
  }, HOUR_MS);
  timer.unref();
  return { stop: () => clearInterval(timer) };
};
