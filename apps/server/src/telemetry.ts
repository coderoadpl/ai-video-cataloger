import { trace } from '@opentelemetry/api';

import type { AppError } from '@core/domain/index.js';

export const recordAppError = (error: AppError): void => {
  const span = trace.getActiveSpan();
  if (span === undefined) return;
  span.addEvent('app.error', { 'error.code': error.code, 'error.message': error.message });
};
