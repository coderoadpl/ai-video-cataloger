import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GoogleServiceAccountBackupDestination } from '@adapters/backup/google-service-account-destination.js';
import { ok, type AppError, type BackupManifest, type ConfigKey, type Result } from '@core/domain/index.js';
import type { ConfigScope, ConfigStore, SecretsAvailability } from '@core/server/index.js';

// @ts-expect-error -- plain-JS QA tool, deliberately outside the typed build (docs/qa/release-walkthrough.md)
import { FAKE_DRIVE_ID, FAKE_DRIVE_NAME, FAKE_SERVICE_ACCOUNT_EMAIL, serviceAccountKeyJson, startFakeDriveServer } from './fake-drive-server.mjs';

class MemoryConfig implements ConfigStore {
  private readonly values = new Map<string, string>();
  get(scope: ConfigScope, key: ConfigKey): Promise<Result<string | null, AppError>> {
    return Promise.resolve(ok(this.values.get(`${scope.kind}:${key}`) ?? null));
  }
  getAll(): Promise<Result<Partial<Record<ConfigKey, string>>, AppError>> {
    return Promise.resolve(ok({}));
  }
  set(scope: ConfigScope, key: ConfigKey, value: string): Promise<Result<{ previousValue: string | null }, AppError>> {
    const scoped = `${scope.kind}:${key}`;
    const previousValue = this.values.get(scoped) ?? null;
    this.values.set(scoped, value);
    return Promise.resolve(ok({ previousValue }));
  }
  delete(scope: ConfigScope, key: ConfigKey): Promise<Result<{ previousValue: string | null }, AppError>> {
    const scoped = `${scope.kind}:${key}`;
    const previousValue = this.values.get(scoped) ?? null;
    this.values.delete(scoped);
    return Promise.resolve(ok({ previousValue }));
  }
}

class MemorySecrets {
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

const manifest = (createdAt: string): BackupManifest => ({
  formatVersion: 1,
  tier: 'critical',
  createdAt,
  appVersion: '1.2.3',
  schemaVersions: { globalCatalog: 7, photos: 3 },
  contentFingerprint: 'a'.repeat(64),
  totalBytes: 17,
  files: [],
  folders: [],
  keyFingerprint: 'sha256:0123456789ab',
});

describe('fake Drive server', () => {
  let server: Awaited<ReturnType<typeof startFakeDriveServer>>;

  beforeAll(async () => {
    server = await startFakeDriveServer({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  it('carries the real service-account destination through connect, upload, list, download and remove', async () => {
    const config = new MemoryConfig();
    const secrets = new MemorySecrets();
    const destination = new GoogleServiceAccountBackupDestination({
      config,
      secrets,
      driveBaseUrl: server.driveBaseUrl,
      uploadBaseUrl: server.uploadBaseUrl,
    });

    const connected = await destination.connect(
      { keyJson: serviceAccountKeyJson(server.tokenUri), sharedDriveId: FAKE_DRIVE_ID },
      new AbortController().signal,
    );

    expect(connected).toEqual(ok({
      accountEmail: FAKE_SERVICE_ACCOUNT_EMAIL,
      driveName: FAKE_DRIVE_NAME,
      folderName: 'AI Video Cataloger Backups',
      remainingQuotaBytes: null,
    }));

    const directory = await mkdtemp(path.join(tmpdir(), 'avc-fake-drive-'));
    try {
      const sourcePath = path.join(directory, 'source.avcbak');
      const destinationPath = path.join(directory, 'download.avcbak');
      await writeFile(sourcePath, 'encrypted archive');

      const uploaded = await destination.upload(
        { sourcePath, name: 'archive.avcbak', manifest: manifest('2026-09-02T12:00:00.000Z') },
        new AbortController().signal,
      );
      expect(uploaded).toMatchObject({ ok: true, value: { tier: 'critical', sizeBytes: 17 } });
      if (!uploaded.ok) return;

      const listed = await destination.list(null, new AbortController().signal);
      expect(listed).toMatchObject({
        ok: true,
        value: { skipped: 0, backups: [{ remoteId: uploaded.value.remoteId, name: 'archive.avcbak' }] },
      });

      expect(await destination.download(uploaded.value.remoteId, destinationPath, new AbortController().signal))
        .toEqual(ok({ sizeBytes: 17 }));
      expect(await readFile(destinationPath, 'utf8')).toBe('encrypted archive');

      expect(await destination.remove(uploaded.value.remoteId, new AbortController().signal))
        .toEqual(ok({ removed: true }));
      expect(await destination.list(null, new AbortController().signal))
        .toEqual(ok({ backups: [], skipped: 0 }));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('serves a resumable upload back byte-for-byte', async () => {
    const config = new MemoryConfig();
    const secrets = new MemorySecrets();
    const destination = new GoogleServiceAccountBackupDestination({
      config,
      secrets,
      driveBaseUrl: server.driveBaseUrl,
      uploadBaseUrl: server.uploadBaseUrl,
    });
    await destination.connect(
      { keyJson: serviceAccountKeyJson(server.tokenUri), sharedDriveId: FAKE_DRIVE_ID },
      new AbortController().signal,
    );

    const directory = await mkdtemp(path.join(tmpdir(), 'avc-fake-drive-resumable-'));
    try {
      const sourcePath = path.join(directory, 'large.avcbak');
      const destinationPath = path.join(directory, 'large-download.avcbak');
      const bytes = Buffer.alloc(5 * 1024 * 1024 + 1024, 7);
      await writeFile(sourcePath, bytes);

      const uploaded = await destination.upload(
        { sourcePath, name: 'large.avcbak', manifest: { ...manifest('2026-09-03T12:00:00.000Z'), totalBytes: bytes.byteLength } },
        new AbortController().signal,
      );
      expect(uploaded).toMatchObject({ ok: true, value: { sizeBytes: bytes.byteLength } });
      if (!uploaded.ok) return;

      expect(await destination.download(uploaded.value.remoteId, destinationPath, new AbortController().signal))
        .toEqual(ok({ sizeBytes: bytes.byteLength }));
      expect(createHash('sha256').update(await readFile(destinationPath)).digest('hex'))
        .toBe(createHash('sha256').update(bytes).digest('hex'));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
