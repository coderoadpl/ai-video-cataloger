import { describe, expect, it } from 'vitest';

import { err, ok, type AppError, type Result } from '@core/domain/index.js';

import { envelopeSchema, looseEnvelopeSchema, toEnvelope } from './envelope.js';
import { healthOutputSchema } from './routes.js';

describe('envelope', () => {
  it('toEnvelope maps an ok Result to an ok envelope', () => {
    const result: Result<{ status: 'ok'; version: string }, AppError> = ok({
      status: 'ok',
      version: '0.1.0',
    });
    expect(toEnvelope(result)).toEqual({ ok: true, data: { status: 'ok', version: '0.1.0' } });
  });

  it('toEnvelope maps an err Result to an error envelope', () => {
    const result: Result<never, AppError> = err({ code: 'not_found', message: 'gone' });
    expect(toEnvelope(result)).toEqual({ ok: false, error: { code: 'not_found', message: 'gone' } });
  });

  it('parses a well-formed ok envelope through a typed schema', () => {
    const schema = envelopeSchema(healthOutputSchema);
    const parsed = schema.parse({ ok: true, data: { status: 'ok', version: '0.1.0' } });
    expect(parsed.ok).toBe(true);
  });

  it('rejects an ok envelope whose data violates the route schema', () => {
    const schema = envelopeSchema(healthOutputSchema);
    expect(schema.safeParse({ ok: true, data: { status: 'degraded', version: '0.1.0' } }).success).toBe(
      false,
    );
  });

  it('looseEnvelopeSchema accepts unknown data but requires a valid error shape', () => {
    expect(looseEnvelopeSchema.safeParse({ ok: true, data: { anything: 1 } }).success).toBe(true);
    expect(looseEnvelopeSchema.safeParse({ ok: false, error: { message: 'no code' } }).success).toBe(
      false,
    );
  });
});
