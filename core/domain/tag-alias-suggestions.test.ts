import { describe, expect, it } from 'vitest';

import { proposeTagAliases, type TagAliasProposal } from './tag-alias-suggestions.js';

const FIXTURE_TAGS = [
  { name: 'kamper', count: 373 },
  { name: 'kampery', count: 63 },
  { name: 'pies', count: 26 },
  { name: 'pieski', count: 5 },
  { name: 'psy', count: 50 },
  { name: 'fjord', count: 40 },
  { name: 'fiord', count: 37 },
  { name: 'camper-van', count: 89 },
  { name: 'campervan', count: 7 },
  { name: 'storm-clouds', count: 89 },
  { name: 'storm-cloud', count: 12 },
  { name: 'gardena', count: 1 },
  { name: 'garden', count: 5 },
  { name: 'nordka', count: 1 },
  { name: 'nord', count: 1 },
  { name: 'maty', count: 1 },
  { name: 'mati', count: 8 },
  { name: 'archer', count: 1 },
  { name: 'archery', count: 2 },
];

const proposalFor = (proposals: readonly TagAliasProposal[], from: string): TagAliasProposal | undefined =>
  proposals.find((proposal) => proposal.from === from);

describe('proposeTagAliases', () => {
  it('directs a pair by the higher count for each rule family', () => {
    const proposals = proposeTagAliases({ tags: FIXTURE_TAGS, aliases: [] });

    expect(proposalFor(proposals, 'kampery')).toMatchObject({ to: 'kamper', rule: 'pl-plural' });
    expect(proposalFor(proposals, 'storm-cloud')).toMatchObject({ to: 'storm-clouds', rule: 'en-plural' });
    expect(proposalFor(proposals, 'campervan')).toMatchObject({ to: 'camper-van', rule: 'normalization' });
    expect(proposalFor(proposals, 'fiord')).toMatchObject({ to: 'fjord', rule: 'spelling-variant' });
  });

  it('proposes curated Polish irregular pairs into the highest-count form', () => {
    const proposals = proposeTagAliases({ tags: FIXTURE_TAGS, aliases: [] });

    expect(proposalFor(proposals, 'pies')).toMatchObject({ to: 'psy', rule: 'pl-irregular' });
    expect(proposalFor(proposals, 'pieski')).toMatchObject({ to: 'psy', rule: 'pl-irregular' });
  });

  it('never proposes the measured false positives', () => {
    const proposals = proposeTagAliases({ tags: FIXTURE_TAGS, aliases: [] });

    expect(proposalFor(proposals, 'gardena')).toBeUndefined();
    expect(proposalFor(proposals, 'garden')).toBeUndefined();
    expect(proposalFor(proposals, 'nordka')).toBeUndefined();
    expect(proposalFor(proposals, 'nord')).toBeUndefined();
    expect(proposalFor(proposals, 'maty')).toBeUndefined();
    expect(proposalFor(proposals, 'mati')).toBeUndefined();
  });

  it('honors an existing canonical over the higher count', () => {
    const proposals = proposeTagAliases({
      tags: [{ name: 'psy', count: 50 }, { name: 'pies', count: 200 }],
      aliases: [{ alias: 'dogs', canonical: 'psy' }],
    });

    expect(proposals).toEqual([
      { from: 'pies', to: 'psy', fromCount: 200, toCount: 50, rule: 'pl-irregular', canonicalLocked: true },
    ]);
  });

  it('never proposes reversing an existing alias', () => {
    const proposals = proposeTagAliases({
      tags: [{ name: 'kamper', count: 373 }, { name: 'kampery', count: 63 }],
      aliases: [{ alias: 'kampery', canonical: 'kamper' }],
    });

    expect(proposalFor(proposals, 'kamper')).toBeUndefined();
    expect(proposalFor(proposals, 'kampery')).toBeUndefined();
    expect(proposals).toEqual([]);
  });

  it('is deterministic on equal counts, breaking ties by localeCompare', () => {
    const tags = [{ name: 'camper-park', count: 6 }, { name: 'camperpark', count: 6 }];
    const first = proposeTagAliases({ tags, aliases: [] });
    const second = proposeTagAliases({ tags, aliases: [] });

    expect(first).toEqual(second);
    expect(first).toEqual([
      { from: 'camper-park', to: 'camperpark', fromCount: 6, toCount: 6, rule: 'normalization', canonicalLocked: false },
    ]);
  });

  it('emits a pair reachable by two rules only once, at the higher-precedence rule', () => {
    const tags = [{ name: 'closeup', count: 10 }, { name: 'close-up', count: 40 }];
    const proposals = proposeTagAliases({ tags, aliases: [] });

    expect(proposals).toEqual([
      { from: 'closeup', to: 'close-up', fromCount: 10, toCount: 40, rule: 'normalization', canonicalLocked: false },
    ]);
  });
});
