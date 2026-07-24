import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { appError, err, ok } from '@core/domain/index.js';

import { respond } from './respond.js';

const schema = z.object({ value: z.number() });

describe('respond', () => {
  it('serializes an ok result that matches the output schema at 200', async () => {
    const response = respond(ok({ value: 1 }), schema);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBeNull();
    expect(await response.json()).toEqual({ ok: true, data: { value: 1 } });
  });

  it('downgrades an ok result that violates the output schema to an internal error', async () => {
    const response = respond(ok({ value: 'not-a-number' }), schema);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'internal' } });
  });

  it('maps an error result to its status and pins no-store on the response', async () => {
    const response = respond(err(appError('unavailable', 'Not ready')), schema);

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  });
});
