import { mkdtempSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
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
  it('keeps the Keychain for the account home even when the opt-out variable is set', () => {
    vi.stubEnv('AI_VIDEO_CATALOGER_DISABLE_KEYCHAIN', '1');
    const accountHome = home();
    const keychain = new KeychainSecretsAdapter();

    expect(backupSecretsStore(keychain, accountHome, accountHome)).toBe(keychain);
  });

  it('selects the file-backed store for a throwaway home with the opt-out variable set', () => {
    vi.stubEnv('AI_VIDEO_CATALOGER_DISABLE_KEYCHAIN', '1');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const keychain = new KeychainSecretsAdapter();

    expect(backupSecretsStore(keychain, home(), home())).not.toBe(keychain);
  });

  it('reads the account home from the passwd database, not from an overridden HOME', () => {
    vi.stubEnv('AI_VIDEO_CATALOGER_DISABLE_KEYCHAIN', '1');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const walkthroughHome = home();
    vi.stubEnv('HOME', walkthroughHome);
    const keychain = new KeychainSecretsAdapter();

    expect(userInfo().homedir).not.toBe(walkthroughHome);
    expect(backupSecretsStore(keychain, walkthroughHome)).not.toBe(keychain);
  });

  it('keeps the Keychain without the opt-out variable', () => {
    vi.stubEnv('AI_VIDEO_CATALOGER_DISABLE_KEYCHAIN', '');
    const keychain = new KeychainSecretsAdapter();

    expect(backupSecretsStore(keychain, home(), home())).toBe(keychain);
  });
});
