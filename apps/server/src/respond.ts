import { type z } from 'zod';

import { HTTP_STATUS_BY_ERROR_CODE, toEnvelope } from '@core/contract/index.js';
import { appError, err, type AppError, type Result } from '@core/domain/index.js';

import { recordAppError } from './telemetry.js';

export const respond = (result: Result<unknown, AppError>, outputSchema: z.ZodTypeAny): Response => {
  const parsed = result.ok ? outputSchema.safeParse(result.value) : null;
  const finalResult =
    result.ok && parsed !== null && !parsed.success
      ? err(appError('internal', 'Response data does not match the contract'))
      : result;
  const envelope = toEnvelope(finalResult);
  if (!envelope.ok) recordAppError(envelope.error);
  const status = envelope.ok ? 200 : HTTP_STATUS_BY_ERROR_CODE[envelope.error.code];
  return new Response(JSON.stringify(envelope), {
    status,
    headers: {
      'content-type': 'application/json',
      ...(envelope.ok ? {} : { 'cache-control': 'no-store' }),
    },
  });
};
