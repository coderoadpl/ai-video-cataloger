import { describe, expect, it } from 'vitest';

import { driveFacesSummaryLine } from './drive-faces-summary.js';

const ranFaces = {
  ran: true,
  skippedReason: null,
  filesIndexed: 3,
  observationsAdded: 12,
  peopleCreated: 2,
  error: null,
};

const skipped = (skippedReason: string, error: { code: string; message: string } | null = null) => ({
  ran: false,
  skippedReason,
  filesIndexed: 0,
  observationsAdded: 0,
  peopleCreated: 0,
  error,
});

describe('driveFacesSummaryLine', () => {
  it('reports the counts of a completed pass', () => {
    expect(driveFacesSummaryLine(ranFaces)).toBe('faces: indexed 3 file(s), 12 observation(s), 2 new person(s)');
  });

  it('names --skip-faces as the reason and the recovery command', () => {
    expect(driveFacesSummaryLine(skipped('flag')))
      .toBe('faces: NOT indexed (--skip-faces) — run "ai-video-cataloger faces index <root>" to build them');
  });

  it('points at the install command when the models are missing', () => {
    expect(driveFacesSummaryLine(skipped('artifacts_missing'))).toBe(
      'faces: NOT indexed (face models are not installed) — run "ai-video-cataloger models faces install", '
        + 'then "ai-video-cataloger faces index <root>"',
    );
  });

  it('reports an unavailable engine without a recovery command', () => {
    expect(driveFacesSummaryLine(skipped('unavailable')))
      .toBe('faces: NOT indexed (the face engine is unavailable in this build)');
  });

  it('tells a cancelled run to re-run the same root', () => {
    expect(driveFacesSummaryLine(skipped('cancelled')))
      .toBe('faces: NOT indexed (run cancelled) — re-run the same root to finish');
  });

  it('surfaces the failing pass error message', () => {
    expect(driveFacesSummaryLine(skipped('failed', { code: 'provider_error', message: 'engine crashed' }))).toBe(
      'faces: NOT indexed (engine crashed) — run "ai-video-cataloger faces index <root>"',
    );
  });

  it('falls back to a generic message when a failed pass carries no error', () => {
    expect(driveFacesSummaryLine(skipped('failed'))).toBe(
      'faces: NOT indexed (the faces pass failed) — run "ai-video-cataloger faces index <root>"',
    );
  });

  it('returns null when faces is absent from the run summary', () => {
    expect(driveFacesSummaryLine(undefined)).toBeNull();
  });

  it('returns null for a malformed value', () => {
    expect(driveFacesSummaryLine({ ran: 'yes' })).toBeNull();
  });
});
