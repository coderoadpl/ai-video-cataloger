import { actions } from '../../api.js';

import { createProcessingCore } from './core/index.js';

export {
  emptyDriveCounts,
  isPending,
  messageOf,
  reduceDriveEvent,
  toProgressModel,
} from './core/index.js';
export type { DriveMessage, DriveProgressView, ProcessVideo } from './core/index.js';

const core = createProcessingCore({
  descriptors: {
    process: actions.processVideo,
    processDrive: actions.processDrive,
    cancel: actions.cancelJob,
    job: actions.job,
  },
});

export const { process, processDrive, cancel, job } = core.descriptors;
export const isTerminalJobStatus = core.isTerminal;
