export const DRIVE_EVENT_STEPS = [
  'run-started',
  'folder-started',
  'folder-done',
  'run-summary',
  'batch_submitted',
  'batch_poll',
  'batch_completed',
  'batch_uploads_retained',
  'batch_orphan_jobs',
  'batch_model_changed',
  'budget_cap_reached',
] as const;

export type DriveEventStep = (typeof DRIVE_EVENT_STEPS)[number];

export const isDriveEventStep = (step: string): step is DriveEventStep =>
  DRIVE_EVENT_STEPS.some((candidate) => candidate === step);

export const driveEventLine = (type: DriveEventStep, data: unknown, timestamp: string): string => {
  const payload = typeof data === 'object' && data !== null ? data : {};
  return `${JSON.stringify({ type, timestamp, ...payload })}\n`;
};
