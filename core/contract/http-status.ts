import type { ErrorCode } from '@core/domain/index.js';

export const HTTP_STATUS_BY_ERROR_CODE: Record<ErrorCode, number> = {
  validation: 400,
  not_found: 404,
  conflict: 409,
  internal: 500,
};

export const EXIT_CODE_BY_ERROR_CODE: Record<ErrorCode, number> = {
  validation: 2,
  not_found: 5,
  conflict: 6,
  internal: 10,
};
