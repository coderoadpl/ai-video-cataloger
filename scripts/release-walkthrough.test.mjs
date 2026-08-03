import { describe, expect, it } from 'vitest';

import { blockingSkips, TOLERATED_SKIPS } from './release-walkthrough.mjs';

describe('blockingSkips', () => {
  it('excludes the tolerated allowlist from the blocking set', () => {
    const results = [
      { name: 'first-run-wizard', status: 'skipped', note: 'no first-run wizard on this profile' },
      { name: 'library-preview', status: 'skipped', note: 'no library tile to preview' },
      { name: 'analyze', status: 'skipped', note: 'analyzer not configured in this home' },
      { name: 'launch', status: 'ok', note: '' },
    ];

    expect(blockingSkips(results).map((step) => step.name)).toEqual(['analyze']);
  });

  it('reports no blocking skips when every skip is tolerated', () => {
    const results = [...TOLERATED_SKIPS].map((name) => ({ name, status: 'skipped', note: '' }));

    expect(blockingSkips(results)).toEqual([]);
  });
});
