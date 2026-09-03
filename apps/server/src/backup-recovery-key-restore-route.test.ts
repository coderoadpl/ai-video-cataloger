import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createBackupEncryptionKey } from '@adapters/backup/envelope.js';
import { MemoryBackupDestination } from '@adapters/backup/memory-destination.js';
import { JsonConfigStore, SqlJsGlobalCatalogStore, SqlJsPhotosStore } from '@adapters/db/index.js';
import { NodeFileSystemPort } from '@adapters/fs/index.js';
import { API_ROUTES, looseEnvelopeSchema } from '@core/contract/index.js';
import { BACKUP_ENCRYPTION_KEY_ACCOUNT, ok, type AppError, type Result } from '@core/domain/index.js';
import type { JobRecord, JobsPort, SecretsAvailability, SecretsStore } from '@core/server/index.js';

import { createBackupLifecycle, type BackupLifecycle } from './backup-lifecycle.js';
import { createApp, type App } from './create-app.js';
import { createInMemoryDeps } from './test-support/in-memory-deps.js';

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

describe('POST /api/backup/restore on a Mac whose Keychain holds no backup key', () => {
  it('restores the archive from the pasted recovery key and refuses without it', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'avc-recovery-restore-'));
    await mkdir(path.join(home, '.ai-video-cataloger'), { recursive: true });
    const configStore = new JsonConfigStore({ homeDirectory: home });
    await configStore.set({ kind: 'home' }, 'backup_enabled', 'true');
    await configStore.set({ kind: 'home' }, 'backup_account_email', 'person@example.com');
    await configStore.set({ kind: 'home' }, 'backup_keep_last', '13');
    const secrets = new MemorySecrets();
    const created = await createBackupEncryptionKey(secrets);
    if (!created.ok) throw new Error(created.error.message);
    const composed: { lifecycle: BackupLifecycle | null } = { lifecycle: null };
    const app = createApp({ dbDriver: 'memory', processName: 'cli' }, (config) => {
      const deps = createInMemoryDeps(config);
      const destination = new MemoryBackupDestination();
      composed.lifecycle = createBackupLifecycle({
        homeDirectory: home,
        appVersion: '0.6.25',
        fs: new NodeFileSystemPort({ homeDirectory: home, workingDirectory: home }),
        globalCatalog: new SqlJsGlobalCatalogStore({ homeDirectory: home }),
        photos: new SqlJsPhotosStore({ homeDirectory: home }),
        config: configStore,
        secrets,
        jobs: deps.jobs,
        fileSave: { save: () => Promise.resolve(ok(null)) },
        destination: () => Promise.resolve(ok(destination)),
        googleOAuthAvailable: true,
      });
      return { ...deps, restoreBackup: (input) => composed.lifecycle?.restore(input) ?? deps.restoreBackup(input) };
    });

    try {
      const lifecycle = composed.lifecycle;
      if (lifecycle === null) throw new Error('the lifecycle was not composed');
      const backedUp = await lifecycle.run({ tier: 'critical' });
      expect(backedUp).toMatchObject({ ok: true });
      if (!backedUp.ok) return;
      await waitForJob(app.jobs, backedUp.value.jobId);
      const listed = await lifecycle.list(null, new AbortController().signal);
      if (!listed.ok) throw new Error(listed.error.message);
      const remoteId = listed.value.backups[0]?.remoteId ?? '';
      await configStore.set({ kind: 'home' }, 'backup_keep_last', '21');
      secrets.values.delete(BACKUP_ENCRYPTION_KEY_ACCOUNT);

      const refused = await restoreJob(app, { remoteId });
      expect(refused.error).toMatchObject({ code: 'recovery_key_required' });

      const restored = await restoreJob(app, { remoteId, recoveryKey: created.value.recoveryKey });
      expect(restored.status).toBe('completed');
      expect(await readFile(path.join(home, '.ai-video-cataloger', 'config.json'), 'utf8')).toContain('"backup_keep_last": "13"');
    } finally {
      await app.dispose();
    }
  }, 60_000);
});

const restoreJob = async (
  app: App,
  body: { remoteId: string; recoveryKey?: string },
): Promise<JobRecord> => {
  const response = await app.honoApp.request(API_ROUTES.backupRestore.path, {
    method: API_ROUTES.backupRestore.method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const envelope = looseEnvelopeSchema.parse(await response.json());
  if (!envelope.ok) throw new Error(`restore was not accepted: ${envelope.error.code}`);
  const accepted = API_ROUTES.backupRestore.output.parse(envelope.data);
  return waitForJob(app.jobs, accepted.jobId);
};

const waitForJob = async (jobs: JobsPort, jobId: string): Promise<JobRecord> => {
  for (let attempt = 0; attempt < 3000; attempt += 1) {
    const record = await jobs.get(jobId);
    if (record.ok && record.value !== null && (record.value.status === 'completed' || record.value.status === 'failed')) {
      return record.value;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`job ${jobId} never settled`);
};
