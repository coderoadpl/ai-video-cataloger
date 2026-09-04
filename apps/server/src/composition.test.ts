import { describe, expect, it } from 'vitest';

import { googleOAuthAvailable, resolveGoogleOAuthClientId, resolveGoogleOAuthClientSecret } from './composition.js';

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

describe('composition Google OAuth client secret resolution', () => {
  it.each([
    [{}, {}, ''],
    [{}, { AVC_GOOGLE_OAUTH_CLIENT_SECRET: 'env-secret' }, 'env-secret'],
    [{ googleOAuthClientSecret: 'config-secret' }, { AVC_GOOGLE_OAUTH_CLIENT_SECRET: 'env-secret' }, 'config-secret'],
    [{ googleOAuthClientSecret: '' }, { AVC_GOOGLE_OAUTH_CLIENT_SECRET: 'env-secret' }, ''],
  ] as const)('resolves the composed OAuth client secret', (config, env, expected) => {
    expect(resolveGoogleOAuthClientSecret(config, env)).toBe(expected);
  });
});

describe('composition Google OAuth availability', () => {
  it.each([
    ['id', 'secret', true],
    ['id', '', false],
    ['', 'secret', false],
    [' ', 'secret', false],
    ['id', ' ', false],
  ] as const)('requires a non-empty client id and client secret', (clientId, clientSecret, expected) => {
    expect(googleOAuthAvailable(clientId, clientSecret)).toBe(expected);
  });
});
