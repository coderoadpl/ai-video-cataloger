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
      readonly filesFailed: number;
    }
  | { readonly kind: 'fileSkipped'; readonly level: 'info'; readonly filename: string }
  | { readonly kind: 'snapshotSkipped'; readonly level: 'info'; readonly folder: string }
  | {
      readonly kind: 'runComplete';
      readonly level: 'info';
      readonly foldersDone: number;
      readonly foldersTotal: number;
      readonly filesDone: number;
      readonly filesSkipped: number;
      readonly filesFailed: number;
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

export interface DriveEventOutcome {
  readonly counts: DriveCounts;
  readonly messages: readonly DriveMessage[];
  readonly folderProgress: DriveProgressView | null;
  readonly fileProgress: FileProgressView | null;
  readonly folderComplete: boolean;
  readonly skippedPath: string | null;
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
      messages: [{ kind: 'fileSkipped', level: 'info', filename: basename(video) }],
      skippedPath: video,
    };
  }

  if (step === 'catalog_snapshot_skipped') {
    return {
      ...idle(counts),
      messages: [{ kind: 'snapshotSkipped', level: 'info', folder: strField(data, 'folder') }],
    };
  }

  if (step === 'run-summary') {
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
          filesFailed: numField(data, 'filesFailed'),
        },
      ],
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
