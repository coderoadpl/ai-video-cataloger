import { describe, expect, it, vi } from 'vitest';
import { scaledTimeout } from '../../../test/helpers/gate-timeout.js';

vi.mock('../../../package.json', () => ({ default: { version: '9.8.7-test' } }));

describe('application version composition', () => {
  it('uses package metadata as the default server version', async () => {
    const { createInMemoryDeps } = await import('../../server/src/test-support/in-memory-deps.js');

    expect(createInMemoryDeps().version).toBe('9.8.7-test');
  }, scaledTimeout(30_000));
});
