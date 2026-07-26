import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { appError, ok, type AppError, type CredentialDeletion, type Result } from '@core/domain/index.js';
import type { SecretsAvailability, SecretsStore } from '@core/server/index.js';

import { JsonCredentialsStore, KeychainCredentialsStore, NdjsonMigrationLog } from './index.js';

const roots: string[] = [];

class FakeSecrets implements SecretsStore {
  readonly values = new Map<string, string>();
  readonly deleteCalls: string[] = [];
  failingAccounts = new Set<string>();
  failingDeletes = new Set<string>();
  failingReads = new Set<string>();
  blockSet: Promise<void> | null = null;

  constructor(private readonly reported: SecretsAvailability) {}

  availability(): Promise<SecretsAvailability> {
    return Promise.resolve(this.reported);
  }

  get(account: string): Promise<Result<string | null, AppError>> {
    if (this.failingReads.has(account)) {
      return Promise.resolve({ ok: false, error: appError('internal', 'keychain is locked') });
    }
    return Promise.resolve(ok(this.values.get(account) ?? null));
  }

  async set(account: string, secret: string): Promise<Result<void, AppError>> {
    if (this.blockSet !== null) await this.blockSet;
    if (this.failingAccounts.has(account)) {
      return { ok: false, error: appError('internal', 'keychain is locked') };
    }
    this.values.set(account, secret);
    return ok(undefined);
  }

  delete(account: string): Promise<Result<{ existed: boolean }, AppError>> {
    this.deleteCalls.push(account);
    if (this.failingDeletes.has(account)) {
      return Promise.resolve({ ok: false, error: appError('internal', 'keychain is locked') });
    }
    return Promise.resolve(ok({ existed: this.values.delete(account) }));
  }
}

class UnremovableLegacy extends JsonCredentialsStore {
  failingDeletes = 0;
  deleteAttempts = 0;
  staleMarkingFails = false;

  override delete(providerId: string): Promise<Result<CredentialDeletion, AppError>> {
    this.deleteAttempts += 1;
    if (this.failingDeletes > 0) {
      this.failingDeletes -= 1;
      return Promise.resolve({ ok: false, error: appError('internal', 'credentials file is busy') });
    }
    return super.delete(providerId);
  }

  override markStale(providerId: string): Promise<Result<void, AppError>> {
    if (this.staleMarkingFails) {
      return Promise.resolve({ ok: false, error: appError('internal', 'credentials file is busy') });
    }
    return super.markStale(providerId);
  }
}

const writeStoredEntries = async (home: string, entries: Record<string, unknown>): Promise<void> => {
  const directory = path.join(home, '.ai-video-cataloger');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'credentials.json'), JSON.stringify(entries, null, 2), { mode: 0o600 });
};

const storedEntries = async (home: string): Promise<unknown> =>
  JSON.parse(await readFile(path.join(home, '.ai-video-cataloger', 'credentials.json'), 'utf8'));

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

  it('never leaves a corrupt file behind when writes overlap', async () => {
    const home = await tempHome();
    const store = new JsonCredentialsStore({ homeDirectory: home });
    const providers = Array.from({ length: 24 }, (_, index) => `provider-${String(index)}`);

    const results = await Promise.all(providers.map((providerId) => store.set(providerId, `secret-${providerId}`)));

    expect(results.filter((result) => !result.ok)).toEqual([]);
    const raw = await readFile(path.join(home, '.ai-video-cataloger', 'credentials.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    expect(z.record(z.string(), z.string()).safeParse(parsed).success).toBe(true);
  });

  it('salvages the readable entries when one of them is malformed', async () => {
    const home = await tempHome();
    await writeStoredEntries(home, {
      openai: 'good-key',
      openrouter: { value: 'other-key', state: 'nonsense' },
      gemini: { value: 'third-key', state: 'pending' },
    });
    const store = new JsonCredentialsStore({ homeDirectory: home });

    expect(await store.get('openai')).toEqual({ ok: true, value: 'good-key' });
    expect(await store.get('gemini')).toEqual({ ok: true, value: 'third-key' });
    expect(await store.get('openrouter')).toEqual({ ok: true, value: null });
    expect(await store.list()).toEqual({ ok: true, value: ['openai', 'gemini'] });
    expect(await store.unreadableEntries()).toEqual({ ok: true, value: ['openrouter'] });
  });

  it('still fails when the credentials file is not an object at all', async () => {
    const home = await tempHome();
    const directory = path.join(home, '.ai-video-cataloger');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'credentials.json'), '"not-an-object"', { mode: 0o600 });
    const store = new JsonCredentialsStore({ homeDirectory: home });

    expect(await store.get('openai')).toMatchObject({ ok: false, error: { code: 'invalid_config_value' } });
  });

  it('reports an untouched pair of backends for a provider it never held', async () => {
    const home = await tempHome();
    const store = new JsonCredentialsStore({ homeDirectory: home });

    expect(await store.delete('openai')).toEqual({ ok: true, value: { cleared: [], retained: [] } });
  });

  it('keeps an unreadable entry verbatim when another provider is written', async () => {
    const home = await tempHome();
    await writeStoredEntries(home, { openai: 'good-key', gemini: { value: 'mangled', state: 'nonsense' } });
    const store = new JsonCredentialsStore({ homeDirectory: home });

    expect(await store.set('openai', 'replacement')).toEqual({ ok: true, value: undefined });

    expect(await storedEntries(home)).toEqual({
      openai: 'replacement',
      gemini: { value: 'mangled', state: 'nonsense' },
    });
  });

  it('keeps an unreadable entry verbatim when the last readable provider is deleted', async () => {
    const home = await tempHome();
    await writeStoredEntries(home, { openai: 'good-key', gemini: { value: 'mangled', state: 'nonsense' } });
    const store = new JsonCredentialsStore({ homeDirectory: home });

    expect(await store.delete('openai')).toEqual({ ok: true, value: { cleared: ['file'], retained: [] } });

    expect(await storedEntries(home)).toEqual({ gemini: { value: 'mangled', state: 'nonsense' } });
  });

  it('names the file instead of claiming nothing is stored for an unreadable entry', async () => {
    const home = await tempHome();
    await writeStoredEntries(home, { gemini: { value: 'mangled', state: 'nonsense' } });
    const store = new JsonCredentialsStore({ homeDirectory: home });

    expect(await store.delete('gemini')).toEqual({
      ok: true,
      value: {
        cleared: [],
        retained: ['file'],
        unreadableEntry: path.join(home, '.ai-video-cataloger', 'credentials.json'),
      },
    });
    expect(await storedEntries(home)).toEqual({ gemini: { value: 'mangled', state: 'nonsense' } });
  });

  it('removes the file only once no entry of any kind is left', async () => {
    const home = await tempHome();
    const store = new JsonCredentialsStore({ homeDirectory: home });
    await store.set('openai', 'secret');

    expect(await store.delete('openai')).toEqual({ ok: true, value: { cleared: ['file'], retained: [] } });
    expect(existsSync(path.join(home, '.ai-video-cataloger', 'credentials.json'))).toBe(false);
  });
});

describe('KeychainCredentialsStore', () => {
  it('resolves from the keychain for a provider the legacy file never held', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    await legacy.set('openrouter', 'legacy-key');
    const secrets = new FakeSecrets('available');
    await secrets.set('openai', 'keychain-key');
    const store = new KeychainCredentialsStore(secrets, legacy);

    expect(await store.get('openai')).toEqual({ ok: true, value: 'keychain-key' });
  });

  it('migrates a plaintext key into the keychain on first access and drops the file', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    await legacy.set('openai', 'legacy-key');
    const secrets = new FakeSecrets('available');
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
    const secrets = new FakeSecrets('available');
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
    const secrets = new FakeSecrets('available');
    await secrets.set('openai', 'same-key');
    const store = new KeychainCredentialsStore(secrets, legacy);

    expect(await store.get('openai')).toEqual({ ok: true, value: 'same-key' });
    expect(await legacy.get('openai')).toEqual({ ok: true, value: null });
  });

  it('lets a pending file value win the migration when the two backends disagree', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    const secrets = new FakeSecrets('available');
    await secrets.set('openai', 'older-key');
    secrets.failingAccounts.add('openai');
    const store = new KeychainCredentialsStore(secrets, legacy, {
      migrationLog: new NdjsonMigrationLog({ homeDirectory: home }),
    });
    await store.set('openai', 'newer-key');
    secrets.failingAccounts.delete('openai');

    expect(await store.get('openai')).toEqual({ ok: true, value: 'newer-key' });
    expect(secrets.values.get('openai')).toBe('newer-key');
    expect(await legacy.get('openai')).toEqual({ ok: true, value: null });
    const log = await readFile(path.join(home, '.ai-video-cataloger', 'credentials-migration.ndjson'), 'utf8');
    expect(JSON.parse(log.trim())).toMatchObject({ event: 'credential_value_conflict', providerId: 'openai' });
    expect(log).not.toContain('newer-key');
    expect(log).not.toContain('older-key');
  });

  it('keeps the pending file value when the conflicting keychain write cannot be verified', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    const secrets = new FakeSecrets('available');
    await secrets.set('openai', 'older-key');
    secrets.failingAccounts.add('openai');
    const store = new KeychainCredentialsStore(secrets, legacy);
    await store.set('openai', 'newer-key');

    expect(await store.get('openai')).toEqual({ ok: true, value: 'newer-key' });
    expect(secrets.values.get('openai')).toBe('older-key');
    expect(await legacy.get('openai')).toEqual({ ok: true, value: 'newer-key' });
  });

  it('never overwrites the keychain with an unmarked file entry a restored backup left behind', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    await legacy.set('openai', 'restored-backup-key');
    const secrets = new FakeSecrets('available');
    await secrets.set('openai', 'current-keychain-key');
    const store = new KeychainCredentialsStore(secrets, legacy, {
      migrationLog: new NdjsonMigrationLog({ homeDirectory: home }),
    });

    expect(await store.get('openai')).toEqual({ ok: true, value: 'current-keychain-key' });
    expect(secrets.values.get('openai')).toBe('current-keychain-key');
    expect(await legacy.get('openai')).toEqual({ ok: true, value: null });

    const conflicts = await store.credentialValueConflicts();
    expect(conflicts.ok).toBe(true);
    const conflict = conflicts.ok ? conflicts.value[0] : undefined;
    expect(conflict?.providerId).toBe('openai');
    const archived = await readFile(conflict?.archivePath ?? '', 'utf8');
    expect(archived).toContain('restored-backup-key');
    expect((await stat(conflict?.archivePath ?? '')).mode & 0o777).toBe(0o600);
    const log = await readFile(path.join(home, '.ai-video-cataloger', 'credentials-migration.ndjson'), 'utf8');
    expect(JSON.parse(log.trim())).toMatchObject({ event: 'credential_value_conflict', providerId: 'openai' });
  });

  it('migrates a file holding every entry kind and leaves only the unreadable one behind', async () => {
    const home = await tempHome();
    await writeStoredEntries(home, {
      openai: 'restored-backup-key',
      anthropic: { value: 'pending-key', state: 'pending' },
      openrouter: { value: 'superseded-key', state: 'stale' },
      gemini: { value: 'mangled', state: 'nonsense' },
    });
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    const secrets = new FakeSecrets('available');
    await secrets.set('openai', 'current-keychain-key');
    const store = new KeychainCredentialsStore(secrets, legacy, {
      migrationLog: new NdjsonMigrationLog({ homeDirectory: home }),
    });

    expect(await store.get('openai')).toEqual({ ok: true, value: 'current-keychain-key' });

    expect(await storedEntries(home)).toEqual({ gemini: { value: 'mangled', state: 'nonsense' } });
    expect(secrets.values.get('anthropic')).toBe('pending-key');
    expect(secrets.values.has('openrouter')).toBe(false);
    const conflicts = await store.credentialValueConflicts();
    expect(conflicts).toMatchObject({ ok: true, value: [{ providerId: 'openai' }] });
    const archivePath = conflicts.ok ? (conflicts.value[0]?.archivePath ?? '') : '';
    expect(JSON.parse(await readFile(archivePath, 'utf8'))).toEqual({ openai: 'restored-backup-key' });
    expect(await store.backend()).toEqual({ backend: 'keychain', reason: 'ok' });
  });

  it('marks the file copy stale when it survives a verified keychain write, and never promotes it', async () => {
    const home = await tempHome();
    const legacy = new UnremovableLegacy({ homeDirectory: home });
    await legacy.set('openai', 'older-key');
    const secrets = new FakeSecrets('available');
    const store = new KeychainCredentialsStore(secrets, legacy, {
      migrationLog: new NdjsonMigrationLog({ homeDirectory: home }),
    });
    legacy.failingDeletes = 4;

    await store.set('openai', 'newer-key');
    expect(JSON.parse(await readFile(path.join(home, '.ai-video-cataloger', 'credentials.json'), 'utf8'))).toEqual({
      openai: { value: 'older-key', state: 'stale' },
    });

    legacy.failingDeletes = 0;
    expect(await store.get('openai')).toEqual({ ok: true, value: 'newer-key' });
    expect(secrets.values.get('openai')).toBe('newer-key');
    expect(await legacy.get('openai')).toEqual({ ok: true, value: null });
    expect(await store.credentialValueConflicts()).toEqual({ ok: true, value: [] });
  });

  it('reports a superseded copy it could neither remove nor mark, and stays degraded', async () => {
    const home = await tempHome();
    const legacy = new UnremovableLegacy({ homeDirectory: home });
    await legacy.set('openai', 'older-key');
    const secrets = new FakeSecrets('available');
    const store = new KeychainCredentialsStore(secrets, legacy, {
      migrationLog: new NdjsonMigrationLog({ homeDirectory: home }),
    });
    legacy.failingDeletes = 4;
    legacy.staleMarkingFails = true;

    const stored = await store.set('openai', 'newer-key');

    expect(stored).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(stored.ok ? '' : stored.error.message).toContain('neither be removed nor marked superseded');
    expect(await store.backend()).toEqual({ backend: 'file', reason: 'degraded' });
    expect(await storedEntries(home)).toEqual({ openai: 'older-key' });
  });

  it('sets aside an unmarked leftover instead of promoting it over the keychain value', async () => {
    const home = await tempHome();
    const legacy = new UnremovableLegacy({ homeDirectory: home });
    await legacy.set('openai', 'older-key');
    const secrets = new FakeSecrets('available');
    const store = new KeychainCredentialsStore(secrets, legacy, {
      migrationLog: new NdjsonMigrationLog({ homeDirectory: home }),
    });
    legacy.failingDeletes = 4;
    legacy.staleMarkingFails = true;
    await store.set('openai', 'newer-key');

    legacy.failingDeletes = 0;
    legacy.staleMarkingFails = false;
    const restarted = new KeychainCredentialsStore(secrets, legacy, {
      migrationLog: new NdjsonMigrationLog({ homeDirectory: home }),
    });

    expect(await restarted.get('openai')).toEqual({ ok: true, value: 'newer-key' });
    expect(secrets.values.get('openai')).toBe('newer-key');
    const conflicts = await restarted.credentialValueConflicts();
    expect(conflicts).toMatchObject({ ok: true, value: [{ providerId: 'openai' }] });
    expect(await legacy.get('openai')).toEqual({ ok: true, value: null });
  });

  it('never resurrects a stale file copy into a keychain that no longer holds the key', async () => {
    const home = await tempHome();
    const legacy = new UnremovableLegacy({ homeDirectory: home });
    await legacy.set('openai', 'superseded-key');
    const secrets = new FakeSecrets('available');
    const store = new KeychainCredentialsStore(secrets, legacy, {
      migrationLog: new NdjsonMigrationLog({ homeDirectory: home }),
    });
    legacy.failingDeletes = 4;
    await store.set('openai', 'newer-key');
    legacy.failingDeletes = 0;
    secrets.values.delete('openai');
    const emptied = new KeychainCredentialsStore(secrets, legacy, {
      migrationLog: new NdjsonMigrationLog({ homeDirectory: home }),
    });

    expect(await emptied.get('openai')).toEqual({ ok: true, value: null });
    expect(secrets.values.has('openai')).toBe(false);
    expect(await legacy.get('openai')).toEqual({ ok: true, value: null });
    const log = await readFile(path.join(home, '.ai-video-cataloger', 'credentials-migration.ndjson'), 'utf8');
    const lines = log.trim().split('\n');
    expect(JSON.parse(lines[lines.length - 1] ?? '')).toMatchObject({ event: 'credential_superseded', providerId: 'openai' });
  });

  it('reports the keychain as unreachable rather than serving a stale file copy', async () => {
    const home = await tempHome();
    await writeStoredEntries(home, { openai: { value: 'superseded-key', state: 'stale' } });
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    const secrets = new FakeSecrets('available');
    secrets.failingReads.add('openai');
    const store = new KeychainCredentialsStore(secrets, legacy);

    const resolved = await store.get('openai');
    expect(resolved.ok).toBe(false);
    expect(resolved.ok === false && resolved.error.code).toBe('keychain_unavailable');
  });

  it('answers null and drops the stale file copy when the keychain item is gone', async () => {
    const home = await tempHome();
    await writeStoredEntries(home, { openai: { value: 'superseded-key', state: 'stale' } });
    const legacy = new UnremovableLegacy({ homeDirectory: home });
    const secrets = new FakeSecrets('available');
    const store = new KeychainCredentialsStore(secrets, legacy, {
      migrationLog: new NdjsonMigrationLog({ homeDirectory: home }),
    });
    legacy.failingDeletes = 1;

    expect(await store.get('openai')).toEqual({ ok: true, value: null });
    expect(await legacy.get('openai')).toEqual({ ok: true, value: null });
    expect(secrets.values.has('openai')).toBe(false);
  });

  it('never surfaces a stale copy across a keychain outage and recovery', async () => {
    const home = await tempHome();
    await writeStoredEntries(home, { openai: { value: 'superseded-key', state: 'stale' } });
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    const secrets = new FakeSecrets('available');
    secrets.values.set('openai', 'live-key');
    secrets.failingReads.add('openai');
    const store = new KeychainCredentialsStore(secrets, legacy, {
      migrationLog: new NdjsonMigrationLog({ homeDirectory: home }),
    });

    const outage = await store.get('openai');
    expect(outage.ok).toBe(false);
    expect(outage.ok === false && outage.error.code).toBe('keychain_unavailable');

    secrets.failingReads.delete('openai');
    expect(await store.get('openai')).toEqual({ ok: true, value: 'live-key' });
    expect(await legacy.entry('openai')).toEqual({ ok: true, value: null });
  });

  it('keeps serving the pending file copy while the keychain refuses', async () => {
    const home = await tempHome();
    await writeStoredEntries(home, { openai: { value: 'newest-key', state: 'pending' } });
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    const secrets = new FakeSecrets('available');
    secrets.failingReads.add('openai');
    const store = new KeychainCredentialsStore(secrets, legacy);

    expect(await store.get('openai')).toEqual({ ok: true, value: 'newest-key' });
  });

  it('retries a single failed removal of the plaintext copy once', async () => {
    const home = await tempHome();
    const legacy = new UnremovableLegacy({ homeDirectory: home });
    const secrets = new FakeSecrets('available');
    const store = new KeychainCredentialsStore(secrets, legacy);
    legacy.failingDeletes = 1;

    expect(await store.set('openai', 'newer-key')).toEqual({ ok: true, value: undefined });
    expect(legacy.deleteAttempts).toBe(2);
    expect(await legacy.get('openai')).toEqual({ ok: true, value: null });
  });

  it('serializes a delete behind the migration it raced, so the promotion cannot resurrect the key', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    const secrets = new FakeSecrets('available');
    secrets.failingAccounts.add('openai');
    const store = new KeychainCredentialsStore(secrets, legacy);
    await store.set('openai', 'pending-key');
    secrets.failingAccounts.delete('openai');

    let release = (): void => undefined;
    secrets.blockSet = new Promise<void>((resolve) => {
      release = () => {
        resolve();
      };
    });
    const migrating = store.get('openai');
    const deleting = store.delete('openai');
    release();
    await migrating;

    expect(await deleting).toEqual({ ok: true, value: { cleared: ['keychain'], retained: [] } });
    expect(secrets.values.has('openai')).toBe(false);
    expect(await legacy.get('openai')).toEqual({ ok: true, value: null });
  });

  it('leaves the plaintext key in place when the keychain write fails', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    await legacy.set('openai', 'legacy-key');
    const secrets = new FakeSecrets('available');
    secrets.failingAccounts.add('openai');
    const store = new KeychainCredentialsStore(secrets, legacy);

    expect(await store.get('openai')).toEqual({ ok: true, value: 'legacy-key' });
    expect(await legacy.get('openai')).toEqual({ ok: true, value: 'legacy-key' });
    expect(await store.backend()).toEqual({ backend: 'file', reason: 'degraded' });
  });

  it('writes to the file store and reports the fallback when a keychain write fails', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    const secrets = new FakeSecrets('available');
    secrets.failingAccounts.add('openai');
    const store = new KeychainCredentialsStore(secrets, legacy);

    expect(await store.set('openai', 'fresh-key')).toEqual({ ok: true, value: undefined });
    expect(await store.get('openai')).toEqual({ ok: true, value: 'fresh-key' });
    expect(await store.backend()).toEqual({ backend: 'file', reason: 'degraded' });
  });

  it('removes a deleted credential from both backends', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    const secrets = new FakeSecrets('available');
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
    const secrets = new FakeSecrets('available');
    const store = new KeychainCredentialsStore(secrets, legacy);

    expect(await store.set('openai', 'fresh-key')).toEqual({ ok: true, value: undefined });
    expect(secrets.values.get('openai')).toBe('fresh-key');
    expect(await legacy.get('openai')).toEqual({ ok: true, value: null });
    expect(await store.legacyPlaintextProviders()).toEqual({ ok: true, value: [] });
  });

  it('stores in the legacy config file unchanged when the keychain is unavailable', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    const store = new KeychainCredentialsStore(new FakeSecrets('unavailable'), legacy);

    expect(await store.set('openai', 'plain-key')).toEqual({ ok: true, value: undefined });
    expect(existsSync(path.join(home, '.ai-video-cataloger', 'credentials.json'))).toBe(true);
    expect(await store.get('openai')).toEqual({ ok: true, value: 'plain-key' });
    expect(await store.legacyPlaintextProviders()).toEqual({ ok: true, value: [] });
    expect(await store.backend()).toEqual({ backend: 'file', reason: 'unavailable' });
  });

  it('clears both backends and names them', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    const secrets = new FakeSecrets('available');
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
    const secrets = new FakeSecrets('available');
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
    const secrets = new FakeSecrets('available');
    await secrets.set('openai', 'keychain-key');
    secrets.failingReads.add('openai');
    const store = new KeychainCredentialsStore(secrets, legacy);

    expect(await store.get('openai')).toMatchObject({ ok: false, error: { code: 'keychain_unavailable' } });
    expect(await store.backend()).toEqual({ backend: 'file', reason: 'degraded' });

    secrets.failingReads.delete('openai');
    expect(await store.get('openai')).toEqual({ ok: true, value: 'keychain-key' });
    expect(await store.backend()).toEqual({ backend: 'keychain', reason: 'ok' });
  });

  it('retries a failed migration once the keychain accepts writes again', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    await legacy.set('openai', 'legacy-key');
    const secrets = new FakeSecrets('available');
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
    const secrets = new FakeSecrets('available');
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
    const secrets = new FakeSecrets('available');
    await secrets.set('openai', 'keychain-key');
    secrets.failingReads.add('openai');
    const store = new KeychainCredentialsStore(secrets, legacy);

    expect(await store.get('openai')).toMatchObject({ ok: false, error: { code: 'keychain_unavailable' } });

    secrets.failingReads.delete('openai');
    expect(await store.delete('openai')).toEqual({ ok: true, value: { cleared: ['keychain'], retained: [] } });
    expect(secrets.deleteCalls).toEqual(['openai']);
    expect(secrets.values.has('openai')).toBe(false);
  });

  it('still reports the keychain removal when the file backend cannot be read', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    await mkdir(path.join(home, '.ai-video-cataloger'), { recursive: true });
    await writeFile(path.join(home, '.ai-video-cataloger', 'credentials.json'), '"not-an-object"', 'utf8');
    const secrets = new FakeSecrets('available');
    await secrets.set('openai', 'keychain-key');
    const store = new KeychainCredentialsStore(secrets, legacy);

    expect(await store.delete('openai')).toEqual({
      ok: true,
      value: { cleared: ['keychain'], retained: ['file'] },
    });
    expect(secrets.values.has('openai')).toBe(false);
  });

  it('still tries the keychain on a delete when only the availability probe failed', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    const secrets = new FakeSecrets('unavailable');
    await secrets.set('openai', 'keychain-key');
    const store = new KeychainCredentialsStore(secrets, legacy);

    expect(await store.delete('openai')).toEqual({ ok: true, value: { cleared: ['keychain'], retained: [] } });
    expect(secrets.values.has('openai')).toBe(false);
  });

  it('reports a retained keychain when an unreachable keychain refuses the delete', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    const secrets = new FakeSecrets('unavailable');
    await secrets.set('openai', 'keychain-key');
    secrets.failingDeletes.add('openai');
    const store = new KeychainCredentialsStore(secrets, legacy);

    expect(await store.delete('openai')).toEqual({ ok: true, value: { cleared: [], retained: ['keychain'] } });
  });

  it('reports nothing cleared when neither backend held the key', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    const store = new KeychainCredentialsStore(new FakeSecrets('available'), legacy);

    expect(await store.delete('openai')).toEqual({ ok: true, value: { cleared: [], retained: [] } });
  });

  it('leaves the keychain alone on a platform that has none', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    const secrets = new FakeSecrets('unsupported');
    const store = new KeychainCredentialsStore(secrets, legacy);
    await legacy.set('openai', 'plain-key');

    expect(await store.delete('openai')).toEqual({ ok: true, value: { cleared: ['file'], retained: [] } });
    expect(secrets.deleteCalls).toEqual([]);
  });

  it('stops reporting a degraded backend as soon as the migration itself reaches the keychain', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    await legacy.set('openai', 'legacy-key');
    const secrets = new FakeSecrets('available');
    secrets.failingAccounts.add('openai');
    const store = new KeychainCredentialsStore(secrets, legacy);

    expect(await store.backend()).toEqual({ backend: 'file', reason: 'degraded' });

    secrets.failingAccounts.delete('openai');
    expect(await store.backend()).toEqual({ backend: 'keychain', reason: 'ok' });
  });

  it('names the keychain as the backend when it answers', async () => {
    const home = await tempHome();
    const store = new KeychainCredentialsStore(new FakeSecrets('available'), new JsonCredentialsStore({ homeDirectory: home }));

    expect(await store.backend()).toEqual({ backend: 'keychain', reason: 'ok' });
  });
});
