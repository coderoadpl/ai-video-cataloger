import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ok, type AppError, type Result } from '@core/domain/index.js';
import type { SecretsStore } from '@core/server/index.js';

import { JsonCredentialsStore, KeychainCredentialsStore } from './index.js';

const roots: string[] = [];

class FakeSecrets implements SecretsStore {
  readonly values = new Map<string, string>();

  constructor(private readonly available: boolean) {}

  isAvailable(): Promise<boolean> {
    return Promise.resolve(this.available);
  }

  get(account: string): Promise<Result<string | null, AppError>> {
    return Promise.resolve(ok(this.values.get(account) ?? null));
  }

  set(account: string, secret: string): Promise<Result<void, AppError>> {
    this.values.set(account, secret);
    return Promise.resolve(ok(undefined));
  }

  delete(account: string): Promise<Result<void, AppError>> {
    this.values.delete(account);
    return Promise.resolve(ok(undefined));
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

    expect(await store.delete('openai')).toEqual({ ok: true, value: undefined });
    expect(await store.get('openai')).toEqual({ ok: true, value: null });
    expect(await store.list()).toEqual({ ok: true, value: ['openrouter'] });
  });
});

describe('KeychainCredentialsStore', () => {
  it('resolves from the keychain before the legacy config value', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    await legacy.set('openai', 'legacy-key');
    const secrets = new FakeSecrets(true);
    await secrets.set('openai', 'keychain-key');
    const store = new KeychainCredentialsStore(secrets, legacy);

    expect(await store.get('openai')).toEqual({ ok: true, value: 'keychain-key' });
  });

  it('falls back to the legacy config value when the keychain has no entry', async () => {
    const home = await tempHome();
    const legacy = new JsonCredentialsStore({ homeDirectory: home });
    await legacy.set('openai', 'legacy-key');
    const store = new KeychainCredentialsStore(new FakeSecrets(true), legacy);

    expect(await store.get('openai')).toEqual({ ok: true, value: 'legacy-key' });
    expect(await store.legacyPlaintextProviders()).toEqual({ ok: true, value: ['openai'] });
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
  });
});
