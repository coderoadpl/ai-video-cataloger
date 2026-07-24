import { isTerminalJobStatus } from '@core/client/index.js';

export { isPending, messageOf } from './helpers.js';
export type { ProcessVideo } from './helpers.js';
export { toProgressModel } from './progress.js';
export type { ProgressModel } from './progress.js';
export { emptyDriveCounts, reduceDriveEvent } from './drive-events.js';
export type {
  DriveCounts,
  DriveEventOutcome,
  DriveEventProgress,
  DriveMessage,
  DriveProgressView,
  FileProgressView,
  LogLevel,
} from './drive-events.js';

export interface ProcessingDescriptors<TProcess, TProcessDrive, TCancel, TJob> {
  readonly process: TProcess;
  readonly processDrive: TProcessDrive;
  readonly cancel: TCancel;
  readonly job: TJob;
}

export interface ProcessingCoreDeps<TProcess, TProcessDrive, TCancel, TJob> {
  readonly descriptors: ProcessingDescriptors<TProcess, TProcessDrive, TCancel, TJob>;
}

export interface ProcessingCore<TProcess, TProcessDrive, TCancel, TJob> {
  readonly descriptors: ProcessingDescriptors<TProcess, TProcessDrive, TCancel, TJob>;
  isTerminal(status: Parameters<typeof isTerminalJobStatus>[0]): boolean;
}

export const createProcessingCore = <TProcess, TProcessDrive, TCancel, TJob>(
  deps: ProcessingCoreDeps<TProcess, TProcessDrive, TCancel, TJob>,
): ProcessingCore<TProcess, TProcessDrive, TCancel, TJob> => ({
  descriptors: deps.descriptors,
  isTerminal: (status) => isTerminalJobStatus(status),
});
