import { describe, expect, it } from 'vitest';

import { checkHealth } from './health.js';

describe('checkHealth', () => {
  it('reports ok with the composed version', () => {
    const result = checkHealth({ version: '1.2.3' });
    expect(result).toEqual({ ok: true, value: { status: 'ok', version: '1.2.3' } });
  });
});
