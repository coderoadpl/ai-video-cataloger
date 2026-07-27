import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../package.json', () => ({ default: { version: '9.8.7-test' } }));

describe('application version composition', () => {
  it('uses package metadata as the default server version', async () => {
    const { createDeps } = await import('../../server/src/composition.js');

    expect(createDeps({ dbDriver: 'memory' }).version).toBe('9.8.7-test');
  }, 30_000);
});
