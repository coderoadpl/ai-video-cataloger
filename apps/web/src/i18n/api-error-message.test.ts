import { describe, expect, it } from 'vitest';

import { ApiError } from '@core/client/index.js';
import { appError } from '@core/domain/index.js';

import { en, pl } from './dictionary.js';
import { apiErrorMessage } from './api-error-message.js';

describe('apiErrorMessage', () => {
  it('explains an unreachable keychain instead of repeating the server sentence', () => {
    const error = new ApiError(appError('keychain_unavailable', 'The macOS Keychain could not be read'));

    expect(apiErrorMessage(error, en)).toBe(en.credentials.keychainUnavailable);
    expect(apiErrorMessage(error, pl)).toBe(pl.credentials.keychainUnavailable);
  });

  it('passes every other server message through', () => {
    expect(apiErrorMessage(new ApiError(appError('missing_api_key', 'No key stored')), en)).toBe('No key stored');
    expect(apiErrorMessage(new Error('boom'), en)).toBe('boom');
    expect(apiErrorMessage('boom', en)).toBe('boom');
  });
});
