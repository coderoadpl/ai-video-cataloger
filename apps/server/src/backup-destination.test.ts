import { describe, expect, it } from 'vitest';

import { MemoryBackupDestination } from '@adapters/backup/memory-destination.js';
import { ok, type AppError, type Result } from '@core/domain/index.js';
import type { SecretsAvailability, SecretsStore } from '@core/server/index.js';
import { InMemoryConfig } from '../../../test/server/usecases/test-fakes.js';

import { createGoogleBackupDestination } from './backup-destination.js';

class MemorySecrets implements SecretsStore {
  availability(): Promise<SecretsAvailability> {
    return Promise.resolve('available');
  }
  get(): Promise<Result<string | null, AppError>> {
    return Promise.resolve(ok(null));
  }
  set(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }
  delete(): Promise<Result<{ existed: boolean }, AppError>> {
    return Promise.resolve(ok({ existed: false }));
  }
}

describe('backup destination composition', () => {
  it.each([
    ['google_oauth', 'google_oauth'],
    ['service_account', 'service_account'],
  ] as const)('selects %s only at the composition boundary', async (configured, expected) => {
    const config = new InMemoryConfig();
    await config.set({ kind: 'home' }, 'backup_provider', configured);
    const selected = await createGoogleBackupDestination({
      config,
      secrets: new MemorySecrets(),
      oauthClientId: 'client',
      oauthClientSecret: 'secret',
      openExternal: () => Promise.resolve(),
    });

    expect(selected).toMatchObject({ ok: true });
    if (selected.ok) expect(selected.value.describe()).toMatchObject({ ok: true, value: { provider: expected } });
  });

  it('keeps use-cases provider-agnostic through the shared port', () => {
    expect(new MemoryBackupDestination().describe()).toMatchObject({ ok: true, value: { provider: 'memory' } });
  });
});
