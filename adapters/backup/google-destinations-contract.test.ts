import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ok, type AppError, type BackupManifest, type Result } from '@core/domain/index.js';
import type { BackupDestinationPort, SecretsAvailability, SecretsStore } from '@core/server/index.js';
import { InMemoryConfig } from '../../test/server/usecases/test-fakes.js';

import { GOOGLE_REFRESH_TOKEN_ACCOUNT, GoogleOAuthBackupDestination } from './google-oauth-destination.js';
import { GoogleServiceAccountBackupDestination } from './google-service-account-destination.js';

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

describe('Google backup destination port contract', () => {
  it.each(['google_oauth', 'service_account'] as const)('runs the same provider-agnostic suite for %s', async (provider) => {
    const config = new InMemoryConfig();
    const secrets = new MemorySecrets();
    await config.set({ kind: 'home' }, 'backup_folder_id', 'folder-1');
    let destination: BackupDestinationPort;
    if (provider === 'google_oauth') {
      secrets.values.set(GOOGLE_REFRESH_TOKEN_ACCOUNT, 'refresh-token');
      destination = new GoogleOAuthBackupDestination({
        config,
        secrets,
        clientId: 'client',
        clientSecret: 'secret',
        tokenUrl: 'https://oauth.example.test/token',
        driveBaseUrl: 'https://drive.example.test/drive/v3',
        uploadBaseUrl: 'https://drive.example.test/upload/drive/v3',
        fetchImpl: fakeGoogle,
        openExternal: () => Promise.resolve(),
      });
    } else {
      await config.set({ kind: 'home' }, 'backup_shared_drive_id', 'drive-1');
      const service = new GoogleServiceAccountBackupDestination({
        config,
        secrets,
        driveBaseUrl: 'https://drive.example.test/drive/v3',
        uploadBaseUrl: 'https://drive.example.test/upload/drive/v3',
        fetchImpl: fakeGoogle,
      });
      await service.importKeyJson(serviceAccountKey());
      destination = service;
    }

    await exerciseDestination(destination);
  });
});

const exerciseDestination = async (destination: BackupDestinationPort): Promise<void> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'avc-google-contract-'));
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
    expect(await destination.list('critical', new AbortController().signal)).toMatchObject({
      ok: true,
      value: [{ remoteId: 'backup-1', tier: 'critical' }],
    });
    expect(await destination.upload({ sourcePath, name: 'archive.avcbak', manifest }, new AbortController().signal)).toMatchObject({
      ok: true,
      value: { remoteId: 'backup-1', tier: 'critical' },
    });
    expect(await destination.download('backup-1', destinationPath, new AbortController().signal)).toEqual(ok({ sizeBytes: 17 }));
    expect(await readFile(destinationPath, 'utf8')).toBe('encrypted archive');
    expect(await destination.remove('backup-1', new AbortController().signal)).toEqual(ok({ removed: true }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

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

const fakeGoogle: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname === 'oauth.example.test') return Response.json({ access_token: 'access-token', expires_in: 3600 });
  if (url.pathname.endsWith('/files/folder-1')) return Response.json({ id: 'folder-1', name: 'Backups', driveId: 'drive-1', trashed: false });
  if (url.pathname.endsWith('/files/backup-1') && url.searchParams.get('alt') === null && init?.method !== 'DELETE') {
    return Response.json({ id: 'backup-1', parents: ['folder-1'], driveId: 'drive-1' });
  }
  if (url.pathname.endsWith('/files') && !url.pathname.includes('/upload/')) {
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
  if (url.pathname.endsWith('/files/backup-1') && url.searchParams.get('alt') === 'media') return new Response('encrypted archive');
  if (url.pathname.endsWith('/files/backup-1') && init?.method === 'DELETE') return new Response(null, { status: 204 });
  return Response.json({ error: { message: 'unexpected fake request' } }, { status: 500 });
};
