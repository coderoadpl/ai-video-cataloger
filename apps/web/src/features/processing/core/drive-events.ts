import type { JobOutput } from '@core/client/index.js';

export type DriveEventProgress = JobOutput['progressEvents'][number]['progress'];

export type LogLevel = 'info' | 'success' | 'error';

export type DriveMessage =
  | { readonly kind: 'runStarted'; readonly level: 'info'; readonly folders: number; readonly files: number }
  | { readonly kind: 'folderStarted'; readonly level: 'info'; readonly path: string; readonly files: number }
  | {
      readonly kind: 'folderDone';
      readonly level: 'success';
      readonly path: string;
      readonly filesDone: number;
      readonly filesSkipped: number;
      readonly filesDuplicateSkipped: number;
      readonly filesFailed: number;
    }
  | {
      readonly kind: 'budgetCapReached';
      readonly level: 'info';
      readonly month: string;
      readonly budgetUsd: number;
      readonly estimatedSpendUsd: number;
    }
  | {
      readonly kind: 'fileSkipped';
      readonly level: 'info';
      readonly filename: string;
      readonly reason: 'already-analyzed' | 'duplicate';
    }
  | { readonly kind: 'snapshotSkipped'; readonly level: 'info'; readonly folder: string }
  | { readonly kind: 'batchUploadsRetained'; readonly level: 'info'; readonly retained: number }
  | { readonly kind: 'batchOrphanJobs'; readonly level: 'info'; readonly jobNames: readonly string[] }
  | { readonly kind: 'batchModelChanged'; readonly level: 'info'; readonly jobModel: string; readonly resolvedModel: string }
  | {
      readonly kind: 'runComplete';
      readonly level: 'info';
      readonly foldersDone: number;
      readonly foldersTotal: number;
      readonly filesDone: number;
      readonly filesSkipped: number;
      readonly filesDuplicateSkipped: number;
      readonly filesFailed: number;
      readonly estimatedCostUsd: number | null;
      readonly costedFiles: number;
    }
  | { readonly kind: 'batchSubmitted'; readonly level: 'info'; readonly requestCount: number; readonly reattached: boolean }
  | { readonly kind: 'batchPoll'; readonly level: 'info'; readonly state: string; readonly requestCount: number }
  | {
      readonly kind: 'batchCompleted';
      readonly level: 'success';
      readonly succeeded: number;
      readonly failed: number;
    }
  | {
      readonly kind: 'fileProgress';
      readonly level: 'info';
      readonly current: number;
      readonly total: number;
      readonly step: string;
      readonly filename: string;
    };

export interface DriveCounts {
  currentFolder: number;
  totalFolders: number;
  filesDone: number;
  filesSkipped: number;
}

export interface DriveProgressView {
  currentFolder: number;
  totalFolders: number;
  filesDone: number;
  filesSkipped: number;
}

export interface FileProgressView {
  currentIndex: number;
  totalCount: number;
  currentFilename: string;
}

export interface BatchWaitView {
  readonly requestCount: number;
  readonly state: string;
}

export interface DriveEventOutcome {
  readonly counts: DriveCounts;
  readonly messages: readonly DriveMessage[];
  readonly folderProgress: DriveProgressView | null;
  readonly fileProgress: FileProgressView | null;
  readonly folderComplete: boolean;
  readonly skippedPath: string | null;
  readonly batchWait?: BatchWaitView | null;
}

export const emptyDriveCounts = (): DriveCounts => ({
  currentFolder: 0,
  totalFolders: 0,
  filesDone: 0,
  filesSkipped: 0,
});

const PER_FILE_STEPS = new Set([
  'extracting_frames',
  'extracting_audio',
  'transcribing_audio',
  'analyzing_with_claude',
  'renaming_video',
  'skipping_rename',
]);

const basename = (path: string): string => path.split(/[\\/]/).pop() ?? path;

const numField = (data: Record<string, unknown> | undefined, key: string): number => {
  const value = data?.[key];
  return typeof value === 'number' ? value : 0;
};

const strField = (data: Record<string, unknown> | undefined, key: string): string => {
  const value = data?.[key];
  return typeof value === 'string' ? value : '';
};

const strListField = (data: Record<string, unknown> | undefined, key: string): string[] => {
  const value = data?.[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const recordField = (data: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined => {
  const value = data?.[key];
  return isRecord(value) ? value : undefined;
};

const idle = (counts: DriveCounts): DriveEventOutcome => ({
  counts,
  messages: [],
  folderProgress: null,
  fileProgress: null,
  folderComplete: false,
  skippedPath: null,
});

export const reduceDriveEvent = (
  progress: DriveEventProgress,
  counts: DriveCounts,
): DriveEventOutcome => {
  const { step, data } = progress;

  if (step === 'run-started') {
    const next = { ...counts, totalFolders: numField(data, 'foldersTotal') };
    return {
      ...idle(next),
      messages: [
        { kind: 'runStarted', level: 'info', folders: next.totalFolders, files: numField(data, 'filesTotal') },
      ],
    };
  }

  if (step === 'folder-started') {
    const next = { ...counts, currentFolder: counts.currentFolder + 1 };
    return {
      ...idle(next),
      messages: [
        { kind: 'folderStarted', level: 'info', path: strField(data, 'path'), files: numField(data, 'filesTotal') },
      ],
      folderProgress: { ...next },
    };
  }

  if (step === 'folder-done') {
    const next = {
      ...counts,
      filesDone: counts.filesDone + numField(data, 'filesDone'),
      filesSkipped: counts.filesSkipped + numField(data, 'filesSkipped'),
    };
    return {
      ...idle(next),
      messages: [
        {
          kind: 'folderDone',
          level: 'success',
          path: strField(data, 'path'),
          filesDone: numField(data, 'filesDone'),
          filesSkipped: numField(data, 'filesSkipped'),
          filesDuplicateSkipped: numField(data, 'filesDuplicateSkipped'),
          filesFailed: numField(data, 'filesFailed'),
        },
      ],
      folderProgress: { ...next },
      folderComplete: true,
    };
  }

  if (step === 'file-skipped') {
    const video = strField(data, 'video');
    return {
      ...idle(counts),
      messages: [{
        kind: 'fileSkipped',
        level: 'info',
        filename: basename(video),
        reason: data?.['reason'] === 'duplicate' ? 'duplicate' : 'already-analyzed',
      }],
      skippedPath: video,
    };
  }

  if (step === 'catalog_snapshot_skipped') {
    return {
      ...idle(counts),
      messages: [{ kind: 'snapshotSkipped', level: 'info', folder: strField(data, 'folder') }],
    };
  }

  if (step === 'batch_submitted') {
    return {
      ...idle(counts),
      messages: [
        {
          kind: 'batchSubmitted',
          level: 'info',
          requestCount: numField(data, 'requestCount'),
          reattached: data?.reattached === true,
        },
      ],
      batchWait: { requestCount: numField(data, 'requestCount'), state: 'submitted' },
    };
  }

  if (step === 'batch_poll') {
    return {
      ...idle(counts),
      messages: [
        {
          kind: 'batchPoll',
          level: 'info',
          state: strField(data, 'state'),
          requestCount: numField(data, 'requestCount'),
        },
      ],
      batchWait: { requestCount: numField(data, 'requestCount'), state: strField(data, 'state') },
    };
  }

  if (step === 'batch_uploads_retained') {
    return {
      ...idle(counts),
      messages: [{ kind: 'batchUploadsRetained', level: 'info', retained: numField(data, 'retained') }],
    };
  }

  if (step === 'batch_orphan_jobs') {
    return {
      ...idle(counts),
      messages: [{ kind: 'batchOrphanJobs', level: 'info', jobNames: strListField(data, 'jobNames') }],
    };
  }

  if (step === 'batch_model_changed') {
    return {
      ...idle(counts),
      messages: [
        {
          kind: 'batchModelChanged',
          level: 'info',
          jobModel: strField(data, 'jobModel'),
          resolvedModel: strField(data, 'resolvedModel'),
        },
      ],
    };
  }

  if (step === 'batch_completed') {
    return {
      ...idle(counts),
      messages: [
        {
          kind: 'batchCompleted',
          level: 'success',
          succeeded: numField(data, 'succeeded'),
          failed: numField(data, 'failed'),
        },
      ],
      batchWait: null,
    };
  }

  if (step === 'run-summary') {
    const estimateRecord = recordField(data, 'costEstimate');
    return {
      ...idle(counts),
      messages: [
        {
          kind: 'runComplete',
          level: 'info',
          foldersDone: numField(data, 'foldersDone'),
          foldersTotal: numField(data, 'foldersTotal'),
          filesDone: numField(data, 'filesDone'),
          filesSkipped: numField(data, 'filesSkipped'),
          filesDuplicateSkipped: numField(data, 'filesDuplicateSkipped'),
          filesFailed: numField(data, 'filesFailed'),
          estimatedCostUsd: estimateRecord === undefined ? null : numField(estimateRecord, 'estimatedCostUsd'),
          costedFiles: numField(estimateRecord, 'files'),
        },
      ],
    };
  }

  if (step === 'budget_cap_reached') {
    return {
      ...idle(counts),
      messages: [{
        kind: 'budgetCapReached',
        level: 'info',
        month: strField(data, 'month'),
        budgetUsd: numField(data, 'budgetUsd'),
        estimatedSpendUsd: numField(data, 'estimatedSpendUsd'),
      }],
    };
  }

  if (PER_FILE_STEPS.has(step)) {
    const filename = basename(strField(data, 'video'));
    const current = progress.current ?? 0;
    const total = progress.total ?? 0;
    return {
      ...idle(counts),
      messages: [{ kind: 'fileProgress', level: 'info', current, total, step, filename }],
      fileProgress: { currentIndex: current, totalCount: total, currentFilename: filename },
    };
  }

  return idle(counts);
};
