import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { appError, ok, type AppError, type Result } from '@core/domain/index.js';
import type { SecretsAvailability, SecretsStore } from '@core/server/index.js';

import { JsonCredentialsStore, KeychainCredentialsStore, NdjsonMigrationLog } from './index.js';

const roots: string[] = [];

class FakeSecrets implements SecretsStore {
  readonly values = new Map<string, string>();
  readonly deleteCalls: string[] = [];
  failingAccounts = new Set<string>();
  failingDeletes = new Set<string>();
  failingReads = new Set<string>();

  constructor(private readonly available: boolean) {}

  availability(): Promise<SecretsAvailability> {
    return Promise.resolve(this.available ? 'available' : 'unavailable');
  }

  get(account: string): Promise<Result<string | null, AppError>> {
    if (this.failingReads.has(account)) {
      return Promise.resolve({ ok: false, error: appError('internal', 'keychain is locked') });
    }
    return Promise.resolve(ok(this.values.get(account) ?? null));
  }

  set(account: string, secret: string): Promise<Result<void, AppError>> {
    if (this.failingAccounts.has(account)) {
      return Promise.resolve({ ok: false, error: appError('internal', 'keychain is locked') });
    }
    this.values.set(account, secret);
    return Promise.resolve(ok(undefined));
  }

  delete(account: string): Promise<Result<{ existed: boolean }, AppError>> {
    this.deleteCalls.push(account);
    if (this.failingDeletes.has(account)) {
      return Promise.resolve({ ok: false, error: appError('internal', 'keychain is locked') });
    }
    return Promise.resolve(ok({ existed: this.values.delete(account) }));
  }
}

const tempHome = async (): Promise<string> => {
  const home = await mkdtemp(path.join(tmpdir(), 'credentials-store-'));
  roots.push(home);
  return home;
};

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

describe('JsonCredentialsStore', () => {
  it('stores credentials in the home scope with owner-only permissions', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'credentials-store-'));
    roots.push(home);
    const store = new JsonCredentialsStore({ homeDirectory: home });

    expect(await store.set('openrouter', 'secret-value')).toEqual({ ok: true, value: undefined });
    expect(await store.get('openrouter')).toEqual({ ok: true, value: 'secret-value' });

    const filePath = path.join(home, '.ai-video-cataloger', 'credentials.json');
    const mode = (await stat(filePath)).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({ openrouter: 'secret-value' });
  });

  it('returns null for an unknown provider reference', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'credentials-store-'));
    roots.push(home);
    const store = new JsonCredentialsStore({ homeDirectory: home });

    expect(await store.get('missing')).toEqual({ ok: true, value: null });
  });

  it('removes a stored credential and reports the remaining providers', async () => {
    const home = await tempHome();
    const store = new JsonCredentialsStore({ homeDirectory: home });
    await store.set('openai', 'secret-a');
    await store.set('openrouter', 'secret-b');

    expect(await store.delete('openai')).toEqual({ ok: true, value: { cleared: ['file'], retained: [] } });
    expect(await store.get('openai')).toEqual({ ok: true, value: null });
    expect(await store.list()).toEqual({ ok: true, value: ['openrouter'] });
  });

  it('reports an untouched pair of backends for a provider it never held', async () => {
    const home = await tempHome();
    const store = new JsonCredentialsStore({ homeDirectory: home });

    expect(await store.delete('openai')).toEqual({ ok: true, value: { cleared: [], retained: [] } });
  });
});

describe('KeychainCredentialsStore', () => {
  it('resolves from the keychain for a provider the legacy file never held', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    await legacy.set('openrouter', 'legacy-key');
    const secrets = new FakeSecrets(true);
    await secrets.set('openai', 'keychain-key');
    const store = new KeychainCredentialsStore(secrets, legacy);

    expect(await store.get('openai')).toEqual({ ok: true, value: 'keychain-key' });
  });

  it('migrates a plaintext key into the keychain on first access and drops the file', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    await legacy.set('openai', 'legacy-key');
    const secrets = new FakeSecrets(true);
    const store = new KeychainCredentialsStore(secrets, legacy, { migrationLog: new NdjsonMigrationLog({ homeDirectory: home }) });

    expect(await store.get('openai')).toEqual({ ok: true, value: 'legacy-key' });
    expect(secrets.values.get('openai')).toBe('legacy-key');
    expect(await store.legacyPlaintextProviders()).toEqual({ ok: true, value: [] });
    expect(existsSync(path.join(home, '.ai-video-cataloger', 'credentials.json'))).toBe(false);
    const log = await readFile(path.join(home, '.ai-video-cataloger', 'credentials-migration.ndjson'), 'utf8');
    const lines = log.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ event: 'credential_migrated', providerId: 'openai', to: 'keychain' });
    expect(log).not.toContain('legacy-key');
  });

  it('migrates once per process and stays idempotent across repeated access', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    await legacy.set('openai', 'legacy-key');
    const secrets = new FakeSecrets(true);
    const log = new NdjsonMigrationLog({ homeDirectory: home });
    const store = new KeychainCredentialsStore(secrets, legacy, { migrationLog: log });

    await Promise.all([store.get('openai'), store.get('openai'), store.legacyPlaintextProviders()]);
    await store.get('openai');
    const recorded = await readFile(path.join(home, '.ai-video-cataloger', 'credentials-migration.ndjson'), 'utf8');
    expect(recorded.trim().split('\n')).toHaveLength(1);
  });

  it('removes the file copy without rewriting the keychain when both hold the same key', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    await legacy.set('openai', 'same-key');
    const secrets = new FakeSecrets(true);
    await secrets.set('openai', 'same-key');
    const store = new KeychainCredentialsStore(secrets, legacy);

    expect(await store.get('openai')).toEqual({ ok: true, value: 'same-key' });
    expect(await legacy.get('openai')).toEqual({ ok: true, value: null });
  });

  it('lets the newer file value win the migration when the two backends disagree', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    await legacy.set('openai', 'newer-key');
    const secrets = new FakeSecrets(true);
    await secrets.set('openai', 'older-key');
    const store = new KeychainCredentialsStore(secrets, legacy, {
      migrationLog: new NdjsonMigrationLog({ homeDirectory: home }),
    });

    expect(await store.get('openai')).toEqual({ ok: true, value: 'newer-key' });
    expect(secrets.values.get('openai')).toBe('newer-key');
    expect(await legacy.get('openai')).toEqual({ ok: true, value: null });
    const log = await readFile(path.join(home, '.ai-video-cataloger', 'credentials-migration.ndjson'), 'utf8');
    expect(JSON.parse(log.trim())).toMatchObject({ event: 'credential_value_conflict', providerId: 'openai' });
    expect(log).not.toContain('newer-key');
    expect(log).not.toContain('older-key');
  });

  it('keeps the file value when the conflicting keychain write cannot be verified', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    await legacy.set('openai', 'newer-key');
    const secrets = new FakeSecrets(true);
    await secrets.set('openai', 'older-key');
    secrets.failingAccounts.add('openai');
    const store = new KeychainCredentialsStore(secrets, legacy);

    expect(await store.get('openai')).toEqual({ ok: true, value: 'newer-key' });
    expect(secrets.values.get('openai')).toBe('older-key');
    expect(await legacy.get('openai')).toEqual({ ok: true, value: 'newer-key' });
  });

  it('leaves the plaintext key in place when the keychain write fails', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    await legacy.set('openai', 'legacy-key');
    const secrets = new FakeSecrets(true);
    secrets.failingAccounts.add('openai');
    const store = new KeychainCredentialsStore(secrets, legacy);

    expect(await store.get('openai')).toEqual({ ok: true, value: 'legacy-key' });
    expect(await legacy.get('openai')).toEqual({ ok: true, value: 'legacy-key' });
    expect(await store.backend()).toEqual({ backend: 'file', reason: 'degraded' });
  });

  it('writes to the file store and reports the fallback when a keychain write fails', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    const secrets = new FakeSecrets(true);
    secrets.failingAccounts.add('openai');
    const store = new KeychainCredentialsStore(secrets, legacy);

    expect(await store.set('openai', 'fresh-key')).toEqual({ ok: true, value: undefined });
    expect(await store.get('openai')).toEqual({ ok: true, value: 'fresh-key' });
    expect(await store.backend()).toEqual({ backend: 'file', reason: 'degraded' });
  });

  it('removes a deleted credential from both backends', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    const secrets = new FakeSecrets(true);
    await secrets.set('openai', 'keychain-key');
    const store = new KeychainCredentialsStore(secrets, legacy);
    await legacy.set('openai', 'legacy-key');

    expect(await store.delete('openai')).toEqual({
      ok: true,
      value: { cleared: ['keychain', 'file'], retained: [] },
    });
    expect(secrets.values.has('openai')).toBe(false);
    expect(await legacy.get('openai')).toEqual({ ok: true, value: null });
  });

  it('writes new keys to the keychain and removes the migrated plaintext value', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    await legacy.set('openai', 'legacy-key');
    const secrets = new FakeSecrets(true);
    const store = new KeychainCredentialsStore(secrets, legacy);

    expect(await store.set('openai', 'fresh-key')).toEqual({ ok: true, value: undefined });
    expect(secrets.values.get('openai')).toBe('fresh-key');
    expect(await legacy.get('openai')).toEqual({ ok: true, value: null });
    expect(await store.legacyPlaintextProviders()).toEqual({ ok: true, value: [] });
  });

  it('stores in the legacy config file unchanged when the keychain is unavailable', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    const store = new KeychainCredentialsStore(new FakeSecrets(false), legacy);

    expect(await store.set('openai', 'plain-key')).toEqual({ ok: true, value: undefined });
    expect(existsSync(path.join(home, '.ai-video-cataloger', 'credentials.json'))).toBe(true);
    expect(await store.get('openai')).toEqual({ ok: true, value: 'plain-key' });
    expect(await store.legacyPlaintextProviders()).toEqual({ ok: true, value: [] });
    expect(await store.backend()).toEqual({ backend: 'file', reason: 'unavailable' });
  });

  it('clears both backends and names them', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    const secrets = new FakeSecrets(true);
    const store = new KeychainCredentialsStore(secrets, legacy);
    await store.set('openai', 'keychain-key');
    await legacy.set('openai', 'stale-plaintext');

    expect(await store.delete('openai')).toEqual({
      ok: true,
      value: { cleared: ['keychain', 'file'], retained: [] },
    });
    expect(secrets.values.has('openai')).toBe(false);
    expect(await legacy.get('openai')).toEqual({ ok: true, value: null });
  });

  it('reports a partial deletion when the keychain refuses and the file was cleared', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    const secrets = new FakeSecrets(true);
    const store = new KeychainCredentialsStore(secrets, legacy);
    await store.set('openai', 'keychain-key');
    await legacy.set('openai', 'stale-plaintext');
    secrets.failingDeletes.add('openai');

    expect(await store.delete('openai')).toEqual({
      ok: true,
      value: { cleared: ['file'], retained: ['keychain'] },
    });
    expect(secrets.values.get('openai')).toBe('keychain-key');
    expect(await legacy.get('openai')).toEqual({ ok: true, value: null });
  });

  it('reads the keychain again after a transient failure instead of falling back for the process lifetime', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    const secrets = new FakeSecrets(true);
    await secrets.set('openai', 'keychain-key');
    secrets.failingReads.add('openai');
    const store = new KeychainCredentialsStore(secrets, legacy);

    expect(await store.get('openai')).toEqual({ ok: true, value: null });
    expect(await store.backend()).toEqual({ backend: 'file', reason: 'degraded' });

    secrets.failingReads.delete('openai');
    expect(await store.get('openai')).toEqual({ ok: true, value: 'keychain-key' });
    expect(await store.backend()).toEqual({ backend: 'keychain', reason: 'ok' });
  });

  it('retries a failed migration once the keychain accepts writes again', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    await legacy.set('openai', 'legacy-key');
    const secrets = new FakeSecrets(true);
    secrets.failingAccounts.add('openai');
    const store = new KeychainCredentialsStore(secrets, legacy);

    expect(await store.get('openai')).toEqual({ ok: true, value: 'legacy-key' });

    secrets.failingAccounts.delete('openai');
    expect(await store.get('openai')).toEqual({ ok: true, value: 'legacy-key' });
    expect(secrets.values.get('openai')).toBe('legacy-key');
    expect(await store.legacyPlaintextProviders()).toEqual({ ok: true, value: [] });
  });

  it('promotes a fallback file write into the keychain once it accepts writes again', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    const secrets = new FakeSecrets(true);
    secrets.failingAccounts.add('openai');
    const store = new KeychainCredentialsStore(secrets, legacy);
    await store.set('openai', 'fresh-key');

    secrets.failingAccounts.delete('openai');
    expect(await store.get('openai')).toEqual({ ok: true, value: 'fresh-key' });
    expect(secrets.values.get('openai')).toBe('fresh-key');
    expect(await store.legacyPlaintextProviders()).toEqual({ ok: true, value: [] });
    expect(await store.backend()).toEqual({ backend: 'keychain', reason: 'ok' });
  });

  it('still clears the keychain after an earlier read failure degraded the backend', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    const secrets = new FakeSecrets(true);
    await secrets.set('openai', 'keychain-key');
    secrets.failingReads.add('openai');
    const store = new KeychainCredentialsStore(secrets, legacy);

    expect(await store.get('openai')).toEqual({ ok: true, value: null });

    secrets.failingReads.delete('openai');
    expect(await store.delete('openai')).toEqual({ ok: true, value: { cleared: ['keychain'], retained: [] } });
    expect(secrets.deleteCalls).toEqual(['openai']);
    expect(secrets.values.has('openai')).toBe(false);
  });

  it('still reports the keychain removal when the file backend cannot be read', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    await mkdir(path.join(home, '.ai-video-cataloger'), { recursive: true });
    await writeFile(path.join(home, '.ai-video-cataloger', 'credentials.json'), '{"openai": 42}', 'utf8');
    const secrets = new FakeSecrets(true);
    await secrets.set('openai', 'keychain-key');
    const store = new KeychainCredentialsStore(secrets, legacy);

    expect(await store.delete('openai')).toEqual({
      ok: true,
      value: { cleared: ['keychain'], retained: ['file'] },
    });
    expect(secrets.values.has('openai')).toBe(false);
  });

  it('names the keychain as the backend when it answers', async () => {
    const home = await tempHome();
    const store = new KeychainCredentialsStore(new FakeSecrets(true), new JsonCredentialsStore({ homeDirectory: home }));

    expect(await store.backend()).toEqual({ backend: 'keychain', reason: 'ok' });
  });
});
