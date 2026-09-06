import { describe, expect, it } from 'vitest';

import { defaultMergeTarget, mergeNameChoices, mergePlanFor, type MergeCandidate } from './merge-target.js';

const candidate = (personId: string, displayName: string | null, observationCount: number): MergeCandidate =>
  ({ personId, displayName, observationCount });

describe('merge target rule', () => {
  it('has no target below two selected people', () => {
    expect(defaultMergeTarget([])).toBeNull();
    expect(defaultMergeTarget([candidate('a', 'Alex', 9)])).toBeNull();
  });

  it('picks the only named person even when another selection is far larger', () => {
    const named = candidate('b', 'Alex', 2);

    expect(defaultMergeTarget([candidate('a', null, 40), named, candidate('c', null, 30)])).toBe(named);
  });

  it('picks the largest person when nothing is named, keeping the first on a tie', () => {
    const first = candidate('a', null, 5);

    expect(defaultMergeTarget([first, candidate('b', null, 5)])).toBe(first);
    expect(defaultMergeTarget([first, candidate('b', null, 6)])?.personId).toBe('b');
  });

  it('defaults to the largest named person when several are named', () => {
    const selected = [candidate('a', 'Alex', 3), candidate('b', 'Blake', 12), candidate('c', null, 90)];

    expect(mergeNameChoices(selected).map((person) => person.personId)).toEqual(['a', 'b']);
    expect(defaultMergeTarget(selected)?.personId).toBe('b');
  });

  it('offers no name choice when at most one person is named', () => {
    expect(mergeNameChoices([candidate('a', 'Alex', 3), candidate('b', null, 1)])).toHaveLength(1);
  });

  it('plans every other selected person as a merge source', () => {
    const selected = [candidate('a', null, 4), candidate('b', 'Alex', 2), candidate('c', null, 1)];

    const plan = mergePlanFor(selected, 'b');

    expect(plan?.target.personId).toBe('b');
    expect(plan?.sources.map((person) => person.personId)).toEqual(['a', 'c']);
  });

  it('rejects a plan for an unselected target or a single selection', () => {
    expect(mergePlanFor([candidate('a', null, 4), candidate('b', null, 2)], 'z')).toBeNull();
    expect(mergePlanFor([candidate('a', null, 4)], 'a')).toBeNull();
  });
});
