import { describe, expect, it } from 'vitest';

import { resolveGoogleOAuthClientId } from './composition.js';

describe('composition Google OAuth client id resolution', () => {
  it.each([
    [{}, {}, ''],
    [{}, { AVC_GOOGLE_OAUTH_CLIENT_ID: 'env-client' }, 'env-client'],
    [{ googleOAuthClientId: 'config-client' }, { AVC_GOOGLE_OAUTH_CLIENT_ID: 'env-client' }, 'config-client'],
    [{ googleOAuthClientId: '' }, { AVC_GOOGLE_OAUTH_CLIENT_ID: 'env-client' }, ''],
  ] as const)('resolves the composed OAuth client id', (config, env, expected) => {
    expect(resolveGoogleOAuthClientId(config, env)).toBe(expected);
  });
});
