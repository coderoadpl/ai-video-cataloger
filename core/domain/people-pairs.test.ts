import { describe, expect, it } from 'vitest';

import { orderObservationPair, orderPersonPair, pairDecisionIsActive, peoplePairDecisionSchema } from './people-pairs.js';

describe('W99 A1 decision domain', () => {
  it('orders unordered ids canonically', () => {
    expect(orderObservationPair('b', 'a')).toEqual(['a', 'b']);
    expect(orderPersonPair('b', 'a')).toEqual(['a', 'b']);
  });
  it.each([
    ['skip', 29, true], ['skip', 30, false], ['skip', 31, false],
    ['same', 365, true], ['different', 365, true],
  ])('expires %s at day %s: %s', (decision, days, active) => {
    const row = peoplePairDecisionSchema.parse({
      obsAId: 'a', obsBId: 'b', personAId: null, personBId: 'person-b',
      decision, decidedAt: '2026-01-01T00:00:00.000Z', source: 'user',
    });
    expect(pairDecisionIsActive(row, new Date(Date.parse(row.decidedAt) + Number(days) * 86400000).toISOString())).toBe(active);
  });
  it('rejects invalid kinds, sources and empty person ids', () => {
    expect(peoplePairDecisionSchema.safeParse({ decision: 'other', source: 'other', personAId: '' }).success).toBe(false);
  });
});
