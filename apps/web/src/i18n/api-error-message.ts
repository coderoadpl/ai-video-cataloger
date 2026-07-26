import { ApiError } from '@core/client/index.js';

import type { Dictionary } from './dictionary.js';

export const apiErrorMessage = (error: unknown, dictionary: Dictionary): string => {
  if (error instanceof ApiError) {
    return error.appError.code === 'keychain_unavailable'
      ? dictionary.credentials.keychainUnavailable
      : error.appError.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
};
