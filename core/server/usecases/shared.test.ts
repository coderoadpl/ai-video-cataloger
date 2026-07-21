import { describe, expect, it } from 'vitest';

import { parseSummary, summaryDataSchema } from './shared.js';

const summary = {
  schemaVersion: 1,
  description: 'A useful description',
  suggestedFilename: 'useful-description',
  fullAnalysis: 'DESCRIPTION: A useful description\nFILENAME: useful-description',
  analyzedAt: '2026-07-14T12:00:00.000Z',
} as const;

describe('shared summary data contract', () => {
  it('validates and parses the persisted summary shape through the same contract', () => {
    expect(summaryDataSchema.parse(summary)).toEqual({ ...summary, tags: [] });
    expect(parseSummary(JSON.stringify(summary))).toEqual({ ...summary, tags: [] });
  });

  it('rejects malformed persisted summaries', () => {
    const malformed = { ...summary, suggestedFilename: 42 };

    expect(summaryDataSchema.safeParse(malformed).success).toBe(false);
    expect(parseSummary(JSON.stringify(malformed))).toBeNull();
  });
});
