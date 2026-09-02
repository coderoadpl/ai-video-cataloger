import { describe, expect, it, vi } from 'vitest';

import { ok, type AppError, type Result } from '@core/domain/index.js';
import type { SecretsAvailability, SecretsStore } from '@core/server/index.js';
import { InMemoryConfig } from '../../test/server/usecases/test-fakes.js';

import {
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_REFRESH_TOKEN_ACCOUNT,
  GoogleOAuthBackupDestination,
} from './google-oauth-destination.js';

class MemorySecrets implements SecretsStore {
  readonly values = new Map<string, string>();
  availability(): Promise<SecretsAvailability> {
    return Promise.resolve('available');
  }
  get(account: string): Promise<Result<string | null, AppError>> {
    return Promise.resolve(ok(this.values.get(account) ?? null));
  }
  set(account: string, secret: string): Promise<Result<void, AppError>> {
    this.values.set(account, secret);
    return Promise.resolve(ok(undefined));
  }
  delete(account: string): Promise<Result<{ existed: boolean }, AppError>> {
    return Promise.resolve(ok({ existed: this.values.delete(account) }));
  }
}

describe('Google OAuth backup destination', () => {
  it('uses loopback PKCE, drive.file, stores refresh credentials, and tests the folder', async () => {
    const config = new InMemoryConfig();
    const secrets = new MemorySecrets();
    const requests: string[] = [];
    const fetchImpl = fakeGoogle(requests);
    const opened: string[] = [];
    const destination = new GoogleOAuthBackupDestination({
      config,
      secrets,
      clientId: 'desktop-client-id',
      clientSecret: 'desktop-client-secret',
      authorizationUrl: 'https://accounts.example.test/auth',
      tokenUrl: 'https://oauth.example.test/token',
      driveBaseUrl: 'https://drive.example.test/drive/v3',
      uploadBaseUrl: 'https://drive.example.test/upload/drive/v3',
      fetchImpl,
      openExternal: async (url) => {
        opened.push(url);
        const consent = new URL(url);
        const redirect = consent.searchParams.get('redirect_uri');
        const state = consent.searchParams.get('state');
        if (redirect === null || state === null) throw new Error('Missing OAuth callback data');
        queueMicrotask(() => {
          void fetch(`${redirect}?code=authorization-code&state=${state}`);
        });
      },
    });

    expect(await destination.connect(new AbortController().signal)).toMatchObject({
      ok: true,
      value: { accountEmail: 'user@example.com', folderName: 'AI Video Cataloger Backups' },
    });
    const consent = new URL(opened[0] ?? '');
    expect(new URL(consent.searchParams.get('redirect_uri') ?? '').hostname).toBe('127.0.0.1');
    expect(consent.searchParams.get('scope')).toBe(GOOGLE_DRIVE_FILE_SCOPE);
    expect(consent.searchParams.get('code_challenge_method')).toBe('S256');
    expect(consent.searchParams.get('state')).toHaveLength(43);
    expect(secrets.values.get(GOOGLE_REFRESH_TOKEN_ACCOUNT)).toBe('refresh-token');
    expect(await config.get({ kind: 'home' }, 'backup_folder_id')).toEqual(ok('folder-1'));
    expect(await config.get({ kind: 'home' }, 'backup_account_email')).toEqual(ok('user@example.com'));

    expect(await destination.test(new AbortController().signal)).toMatchObject({
      ok: true,
      value: {
        accountEmail: 'user@example.com',
        folderName: 'AI Video Cataloger Backups',
        remainingQuotaBytes: 9000,
      },
    });
    expect(requests.some((url) => url.includes('supportsAllDrives'))).toBe(false);
    expect(requests.some((url) => url.includes('driveId='))).toBe(false);
  });

  it('maps a revoked refresh token to backup_auth_required without opening the browser', async () => {
    const config = new InMemoryConfig();
    const secrets = new MemorySecrets();
    secrets.values.set(GOOGLE_REFRESH_TOKEN_ACCOUNT, 'revoked');
    await config.set({ kind: 'home' }, 'backup_folder_id', 'folder-1');
    const openExternal = vi.fn(() => Promise.resolve());
    const destination = new GoogleOAuthBackupDestination({
      config,
      secrets,
      clientId: 'client',
      clientSecret: 'secret',
      tokenUrl: 'https://oauth.example.test/token',
      driveBaseUrl: 'https://drive.example.test/drive/v3',
      uploadBaseUrl: 'https://drive.example.test/upload/drive/v3',
      fetchImpl: () => Promise.resolve(Response.json({ error: 'invalid_grant' }, { status: 400 })),
      openExternal,
    });

    expect(await destination.test(new AbortController().signal)).toMatchObject({
      ok: false,
      error: { code: 'backup_auth_required' },
    });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('closes an unanswered loopback listener after the configured timeout', async () => {
    const destination = new GoogleOAuthBackupDestination({
      config: new InMemoryConfig(),
      secrets: new MemorySecrets(),
      clientId: 'client',
      clientSecret: 'secret',
      authTimeoutMs: 1,
      openExternal: () => Promise.resolve(),
    });

    expect(await destination.connect(new AbortController().signal)).toMatchObject({
      ok: false,
      error: { code: 'backup_auth_required' },
    });
  });
});

const fakeGoogle = (requests: string[]): typeof fetch => async (input, init) => {
  const url = new URL(String(input));
  requests.push(url.toString());
  if (url.pathname.endsWith('/token')) {
    return Response.json({ access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600, token_type: 'Bearer' });
  }
  if (url.pathname.endsWith('/about')) {
    return Response.json({ user: { emailAddress: 'user@example.com' }, storageQuota: { limit: '10000', usage: '1000' } });
  }
  if (url.pathname.endsWith('/files') && init?.method === 'POST' && !url.pathname.includes('/upload/')) {
    return Response.json({ id: 'folder-1', name: 'AI Video Cataloger Backups' });
  }
  if (url.pathname.endsWith('/files') && init?.method !== 'POST') return Response.json({ files: [] });
  if (url.pathname.includes('/upload/') && init?.method === 'POST') {
    return Response.json({ id: 'test-file', name: 'connection-test.bin', size: '1024' });
  }
  if (init?.method === 'DELETE') return new Response(null, { status: 204 });
  return Response.json({ error: { message: 'unexpected fake request' } }, { status: 500 });
};
