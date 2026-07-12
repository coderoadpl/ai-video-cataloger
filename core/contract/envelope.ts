import { z } from 'zod';

import { ERROR_CODES, type AppError, type Result } from '@core/domain/index.js';

export const apiErrorSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  details: z.unknown().optional(),
});

export const envelopeSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), data }),
    z.object({ ok: z.literal(false), error: apiErrorSchema }),
  ]);

/** Envelope with data left unknown; clients parse data with the route schema as a second step. */
export const looseEnvelopeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), error: apiErrorSchema }),
]);

export type Envelope<T> = { ok: true; data: T } | { ok: false; error: AppError };

export const toEnvelope = <T>(result: Result<T, AppError>): Envelope<T> =>
  result.ok ? { ok: true, data: result.value } : { ok: false, error: result.error };
