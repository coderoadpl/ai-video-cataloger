import { describe, expect, it } from 'vitest';

import {
  DEFAULT_KEYCHAIN_SERVICE,
  KeychainSecretsAdapter,
  type SecretsCommandResult,
  type SecretsCommandRunner,
} from './index.js';

class FakeSecurity implements SecretsCommandRunner {
  readonly calls: Array<{ command: string; args: readonly string[] }> = [];
  results: SecretsCommandResult[] = [];

  constructor(private readonly handler: (args: readonly string[]) => SecretsCommandResult) {}

  run(command: string, args: readonly string[]): Promise<SecretsCommandResult> {
    this.calls.push({ command, args });
    return Promise.resolve(this.handler(args));
  }
}

const found = (secret: string): SecretsCommandResult => ({ code: 0, stdout: `${secret}\n`, stderr: '' });
const notFound = (): SecretsCommandResult => ({ code: 44, stdout: '', stderr: 'not found' });
const timedOut = (): SecretsCommandResult => ({ code: 1, stdout: '', stderr: 'security timed out after 10000ms' });

describe('KeychainSecretsAdapter', () => {
  it('is unavailable on non-darwin platforms', async () => {
    const runner = new FakeSecurity(() => ({ code: 0, stdout: '', stderr: '' }));
    const adapter = new KeychainSecretsAdapter({ platform: 'linux', commandRunner: runner });

    expect(await adapter.isAvailable()).toBe(false);
    expect(runner.calls).toHaveLength(0);
  });

  it('is unavailable when explicitly disabled even on darwin', async () => {
    const runner = new FakeSecurity(() => ({ code: 0, stdout: '', stderr: '' }));
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', disabled: true, commandRunner: runner });

    expect(await adapter.isAvailable()).toBe(false);
    expect(runner.calls).toHaveLength(0);
  });

  it('probes the keychain once and caches availability', async () => {
    const runner = new FakeSecurity(() => ({ code: 0, stdout: '', stderr: '' }));
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', disabled: false, commandRunner: runner });

    expect(await adapter.isAvailable()).toBe(true);
    expect(await adapter.isAvailable()).toBe(true);
    expect(runner.calls.filter((call) => call.args[0] === 'list-keychains')).toHaveLength(1);
  });

  it('reads a stored secret and strips the trailing newline', async () => {
    const runner = new FakeSecurity((args) => (args[0] === 'find-generic-password' ? found('sk-test') : notFound()));
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', commandRunner: runner });

    expect(await adapter.get('openai')).toEqual({ ok: true, value: 'sk-test' });
    const call = runner.calls.find((entry) => entry.args[0] === 'find-generic-password');
    expect(call?.args).toEqual(['find-generic-password', '-s', DEFAULT_KEYCHAIN_SERVICE, '-a', 'openai', '-w']);
  });

  it('returns null when the item is not found', async () => {
    const runner = new FakeSecurity(() => notFound());
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', commandRunner: runner });

    expect(await adapter.get('missing')).toEqual({ ok: true, value: null });
  });

  it('surfaces an error for an unexpected security failure', async () => {
    const runner = new FakeSecurity(() => ({ code: 1, stdout: '', stderr: 'boom' }));
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', commandRunner: runner });

    const result = await adapter.get('openai');
    expect(result.ok).toBe(false);
  });

  it('writes a secret with the update flag', async () => {
    const runner = new FakeSecurity(() => ({ code: 0, stdout: '', stderr: '' }));
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', service: 'svc', commandRunner: runner });

    expect(await adapter.set('openai', 'sk-new')).toEqual({ ok: true, value: undefined });
    const call = runner.calls.find((entry) => entry.args[0] === 'add-generic-password');
    expect(call?.args).toEqual(['add-generic-password', '-U', '-s', 'svc', '-a', 'openai', '-w', 'sk-new']);
  });

  it('treats a missing item as a successful delete', async () => {
    const runner = new FakeSecurity(() => notFound());
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', commandRunner: runner });

    expect(await adapter.delete('openai')).toEqual({ ok: true, value: undefined });
  });

  it('reports unavailable when the keychain probe times out', async () => {
    const runner = new FakeSecurity(() => timedOut());
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', commandRunner: runner });

    expect(await adapter.isAvailable()).toBe(false);
  });

  it('surfaces an error when a read times out so callers can fall back', async () => {
    const runner = new FakeSecurity(() => timedOut());
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', commandRunner: runner });

    const result = await adapter.get('openai');
    expect(result.ok).toBe(false);
  });
});
