import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { buildApp, handleUnhandledError } from './app.js';
import { createInMemoryDeps } from './test-support/in-memory-deps.js';

describe('unhandled error mapping', () => {
  it('maps a thrown error to the closed-union contract envelope, not bare text', async () => {
    const app = new Hono();
    app.onError(handleUnhandledError);
    app.get('/boom', () => {
      throw new Error('kaboom');
    });

    const response = await app.request('/boom');

    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: 'internal', message: 'kaboom' },
    });
  });

  it('registers the handler on the composed app', async () => {
    const app = buildApp(createInMemoryDeps({ version: '1.0.0' }));
    app.get('/__test_throw', () => {
      throw new Error('composed boom');
    });

    const response = await app.request('/__test_throw');

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: 'internal', message: 'composed boom' },
    });
  });
});
