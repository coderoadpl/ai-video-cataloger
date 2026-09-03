import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { KeychainSecretsAdapter } from '@adapters/secrets/index.js';

import { backupSecretsStore } from './composition.js';

const home = (): string => mkdtempSync(path.join(tmpdir(), 'avc-backup-secrets-'));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('backup secrets store selection', () => {
  it('keeps the Keychain in a packaged build even when the opt-out variable is set', () => {
    vi.stubEnv('AI_VIDEO_CATALOGER_DISABLE_KEYCHAIN', '1');
    const keychain = new KeychainSecretsAdapter();

    expect(backupSecretsStore(keychain, home(), true)).toBe(keychain);
  });

  it('selects the file-backed store only for an unpackaged run with the opt-out variable set', () => {
    vi.stubEnv('AI_VIDEO_CATALOGER_DISABLE_KEYCHAIN', '1');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const keychain = new KeychainSecretsAdapter();

    expect(backupSecretsStore(keychain, home(), false)).not.toBe(keychain);
  });

  it('keeps the Keychain without the opt-out variable', () => {
    vi.stubEnv('AI_VIDEO_CATALOGER_DISABLE_KEYCHAIN', '');
    const keychain = new KeychainSecretsAdapter();

    expect(backupSecretsStore(keychain, home(), false)).toBe(keychain);
  });
});
