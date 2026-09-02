import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ok, type AppError, type BackupManifest, type Result } from '@core/domain/index.js';
import type { SecretsAvailability, SecretsStore } from '@core/server/index.js';
import { InMemoryConfig } from '../../test/server/usecases/test-fakes.js';

import {
  GOOGLE_SERVICE_ACCOUNT_KEY_ACCOUNT,
  GoogleServiceAccountBackupDestination,
} from './google-service-account-destination.js';
import { GOOGLE_DRIVE_FILE_SCOPE } from './google-oauth-destination.js';

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

const jwtPayloadSchema = z.object({
  iss: z.string(),
  scope: z.string(),
  aud: z.string(),
  iat: z.number(),
  exp: z.number(),
}).passthrough();

describe('Google service-account backup destination', () => {
  it('rejects malformed key JSON without storing it', async () => {
    const secrets = new MemorySecrets();
    const destination = new GoogleServiceAccountBackupDestination({
      config: new InMemoryConfig(),
      secrets,
    });

    expect(await destination.importKeyJson('{"type":"authorized_user"}')).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
    expect(secrets.values.size).toBe(0);
  });

  it('stores the whole validated key and signs a drive.file JWT without delegation', async () => {
    const config = new InMemoryConfig();
    const secrets = new MemorySecrets();
    await config.set({ kind: 'home' }, 'backup_shared_drive_id', 'drive-1');
    await config.set({ kind: 'home' }, 'backup_folder_id', 'folder-1');
    const keyJson = serviceAccountKey();
    const payloads: Array<z.output<typeof jwtPayloadSchema>> = [];
    const requests: string[] = [];
    const destination = new GoogleServiceAccountBackupDestination({
      config,
      secrets,
      driveBaseUrl: 'https://drive.example.test/drive/v3',
      uploadBaseUrl: 'https://drive.example.test/upload/drive/v3',
      fetchImpl: fakeGoogle(payloads, requests),
    });

    expect(await destination.importKeyJson(keyJson)).toMatchObject({ ok: true });
    expect(secrets.values.get(GOOGLE_SERVICE_ACCOUNT_KEY_ACCOUNT)).toBe(keyJson);
    expect(await config.get({ kind: 'home' }, 'backup_service_account_fingerprint')).toMatchObject({
      ok: true,
      value: expect.stringMatching(/^sha256:[0-9a-f]{12}$/),
    });
    expect(await destination.test(new AbortController().signal)).toEqual(ok({
      accountEmail: 'backup@example.com',
      driveName: 'Company Archive',
      folderName: 'Backups',
      remainingQuotaBytes: null,
    }));
    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.scope).toBe(GOOGLE_DRIVE_FILE_SCOPE);
    expect(payloads[0] === undefined || 'sub' in payloads[0]).toBe(false);
    expect(requests.every((url) => !url.includes('/files') || url.includes('supportsAllDrives=true'))).toBe(true);
    expect(requests.some((url) => url.includes('driveId=drive-1'))).toBe(true);
  });

  it('refuses a folder outside the configured Shared Drive', async () => {
    const config = new InMemoryConfig();
    const secrets = new MemorySecrets();
    await config.set({ kind: 'home' }, 'backup_shared_drive_id', 'drive-1');
    await config.set({ kind: 'home' }, 'backup_folder_id', 'folder-other');
    const destination = new GoogleServiceAccountBackupDestination({
      config,
      secrets,
      driveBaseUrl: 'https://drive.example.test/drive/v3',
      uploadBaseUrl: 'https://drive.example.test/upload/drive/v3',
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        if (url.hostname === 'oauth.example.test') return Response.json({ access_token: 'access-token', expires_in: 3600 });
        return Response.json({ id: 'folder-other', name: 'Wrong', driveId: 'drive-2' });
      },
    });
    await destination.importKeyJson(serviceAccountKey());

    expect(await destination.ensureFolder(new AbortController().signal)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  });

  it('requires Content manager or Manager membership', async () => {
    const config = new InMemoryConfig();
    const secrets = new MemorySecrets();
    await config.set({ kind: 'home' }, 'backup_shared_drive_id', 'drive-1');
    await config.set({ kind: 'home' }, 'backup_folder_id', 'folder-1');
    const destination = new GoogleServiceAccountBackupDestination({
      config,
      secrets,
      driveBaseUrl: 'https://drive.example.test/drive/v3',
      uploadBaseUrl: 'https://drive.example.test/upload/drive/v3',
      fetchImpl: fakeGoogle([], [], 'writer'),
    });
    await destination.importKeyJson(serviceAccountKey());

    expect(await destination.test(new AbortController().signal)).toMatchObject({
      ok: false,
      error: {
        code: 'validation',
        message: expect.stringContaining('Content manager'),
      },
    });
  });

  it('streams an uploaded backup through list, download, and remove', async () => {
    const config = new InMemoryConfig();
    const secrets = new MemorySecrets();
    await config.set({ kind: 'home' }, 'backup_shared_drive_id', 'drive-1');
    await config.set({ kind: 'home' }, 'backup_folder_id', 'folder-1');
    const destination = new GoogleServiceAccountBackupDestination({
      config,
      secrets,
      driveBaseUrl: 'https://drive.example.test/drive/v3',
      uploadBaseUrl: 'https://drive.example.test/upload/drive/v3',
      fetchImpl: fakeGoogle([], []),
    });
    await destination.importKeyJson(serviceAccountKey());
    const directory = await mkdtemp(path.join(tmpdir(), 'avc-service-account-'));
    try {
      const sourcePath = path.join(directory, 'source.avcbak');
      const destinationPath = path.join(directory, 'download.avcbak');
      await writeFile(sourcePath, 'encrypted archive');
      const manifest = {
        formatVersion: 1,
        tier: 'critical',
        createdAt: '2026-09-02T12:00:00.000Z',
        appVersion: '1.2.3',
        schemaVersions: { globalCatalog: 7, photos: 3 },
        contentFingerprint: 'a'.repeat(64),
        totalBytes: 17,
        files: [],
        folders: [],
      } satisfies BackupManifest;
      expect(await destination.upload({ sourcePath, name: 'archive.avcbak', manifest }, new AbortController().signal)).toMatchObject({ ok: true });
      expect(await destination.list('critical', new AbortController().signal)).toMatchObject({ ok: true });
      expect(await destination.download('backup-1', destinationPath, new AbortController().signal)).toEqual(ok({ sizeBytes: 17 }));
      expect(await readFile(destinationPath, 'utf8')).toBe('encrypted archive');
      expect(await destination.remove('backup-1', new AbortController().signal)).toEqual(ok({ removed: true }));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

const serviceAccountKey = (): string => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return JSON.stringify({
    type: 'service_account',
    client_email: 'backup@example.com',
    private_key: privateKey,
    private_key_id: 'key-1',
    token_uri: 'https://oauth.example.test/token',
  });
};

const fakeGoogle = (
  payloads: Array<z.output<typeof jwtPayloadSchema>>,
  requests: string[],
  role = 'fileOrganizer',
): typeof fetch => async (input, init) => {
  const url = new URL(String(input));
  requests.push(url.toString());
  if (url.hostname === 'oauth.example.test') {
    const body = init?.body instanceof URLSearchParams
      ? init.body
      : new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
    const assertion = body.get('assertion') ?? '';
    const payload = assertion.split('.')[1] ?? '';
    const parsed = jwtPayloadSchema.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    if (!parsed.success) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    payloads.push(parsed.data);
    return Response.json({ access_token: 'access-token', expires_in: 3600 });
  }
  if (url.pathname.endsWith('/files/folder-1')) return Response.json({ id: 'folder-1', name: 'Backups', driveId: 'drive-1' });
  if (url.pathname.endsWith('/files/backup-1') && url.searchParams.get('alt') === null && init?.method !== 'DELETE') {
    return Response.json({ id: 'backup-1', parents: ['folder-1'], driveId: 'drive-1' });
  }
  if (url.pathname.endsWith('/drives/drive-1')) return Response.json({ id: 'drive-1', name: 'Company Archive' });
  if (url.pathname.endsWith('/permissions')) {
    return Response.json({ permissions: [{ emailAddress: 'backup@example.com', role, type: 'user' }] });
  }
  if (url.pathname.endsWith('/files') && !url.pathname.includes('/upload/') && (init?.method === undefined || init.method === 'GET')) {
    return Response.json({ files: [{
      id: 'backup-1',
      name: 'archive.avcbak',
      size: '17',
      createdTime: '2026-09-02T12:00:00.000Z',
      appProperties: {
        tier: 'critical',
        createdAt: '2026-09-02T12:00:00.000Z',
        appVersion: '1.2.3',
        schemaGlobalCatalog: '7',
        schemaPhotos: '3',
      },
    }] });
  }
  if (url.pathname.includes('/upload/') && init?.method === 'POST') {
    return Response.json({ id: 'backup-1', name: 'archive.avcbak', size: '17' });
  }
  if (url.pathname.endsWith('/files/backup-1') && url.searchParams.get('alt') === 'media') {
    return new Response('encrypted archive');
  }
  if (url.pathname.endsWith('/files/backup-1') && init?.method === 'DELETE') return new Response(null, { status: 204 });
  return Response.json({ error: { message: 'unexpected fake request' } }, { status: 500 });
};
