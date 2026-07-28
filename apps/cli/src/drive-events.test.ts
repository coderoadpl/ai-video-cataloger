import { describe, expect, it } from 'vitest';

import { driveEventLine, isDriveEventStep } from './drive-events.js';

const TIMESTAMP = '2026-07-29T10:20:30.400Z';

describe('drive NDJSON events', () => {
  it('carries every batch step of a drive run as a typed event, not a generic progress line', () => {
    expect(isDriveEventStep('batch_submitted')).toBe(true);
    expect(isDriveEventStep('batch_poll')).toBe(true);
    expect(isDriveEventStep('batch_completed')).toBe(true);
    expect(isDriveEventStep('batch_uploads_retained')).toBe(true);
    expect(isDriveEventStep('batch_orphan_jobs')).toBe(true);
    expect(isDriveEventStep('batch_model_changed')).toBe(true);
    expect(isDriveEventStep('budget_cap_reached')).toBe(true);
    expect(isDriveEventStep('extracting_frames')).toBe(false);
  });

  it('flattens the step payload next to the type and timestamp', () => {
    const line = driveEventLine('batch_uploads_retained', { jobName: 'batches/42', retained: 3 }, TIMESTAMP);

    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line)).toEqual({
      type: 'batch_uploads_retained',
      timestamp: TIMESTAMP,
      jobName: 'batches/42',
      retained: 3,
    });
  });

  it('names the jobs a resumed run leaves behind and the model a re-attached job was bought with', () => {
    expect(JSON.parse(driveEventLine(
      'batch_orphan_jobs',
      { adoptedJobName: 'batches/99', jobNames: ['batches/42'] },
      TIMESTAMP,
    ))).toEqual({
      type: 'batch_orphan_jobs',
      timestamp: TIMESTAMP,
      adoptedJobName: 'batches/99',
      jobNames: ['batches/42'],
    });
    expect(JSON.parse(driveEventLine(
      'batch_model_changed',
      { jobName: 'batches/42', jobModel: 'gemini-2.5-flash', resolvedModel: 'gemini-3.0-pro' },
      TIMESTAMP,
    ))).toEqual({
      type: 'batch_model_changed',
      timestamp: TIMESTAMP,
      jobName: 'batches/42',
      jobModel: 'gemini-2.5-flash',
      resolvedModel: 'gemini-3.0-pro',
    });
  });

  it('emits only the type and timestamp when a step carries no data', () => {
    expect(JSON.parse(driveEventLine('run-summary', undefined, TIMESTAMP))).toEqual({
      type: 'run-summary',
      timestamp: TIMESTAMP,
    });
  });
});
