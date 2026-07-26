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

    expect(await adapter.availability()).toBe('unsupported');
    expect(runner.calls).toHaveLength(0);
  });

  it('is unavailable when explicitly disabled even on darwin', async () => {
    const runner = new FakeSecurity(() => ({ code: 0, stdout: '', stderr: '' }));
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', disabled: true, commandRunner: runner });

    expect(await adapter.availability()).toBe('disabled');
    expect(runner.calls).toHaveLength(0);
  });

  it('probes the keychain once and caches availability', async () => {
    const runner = new FakeSecurity(() => ({ code: 0, stdout: '', stderr: '' }));
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', disabled: false, commandRunner: runner });

    expect(await adapter.availability()).toBe('available');
    expect(await adapter.availability()).toBe('available');
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

  it('treats a missing item as a successful delete that removed nothing', async () => {
    const runner = new FakeSecurity(() => notFound());
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', commandRunner: runner });

    expect(await adapter.delete('openai')).toEqual({ ok: true, value: { existed: false } });
  });

  it('reports that a deleted item existed', async () => {
    const runner = new FakeSecurity(() => ({ code: 0, stdout: '', stderr: '' }));
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', commandRunner: runner });

    expect(await adapter.delete('openai')).toEqual({ ok: true, value: { existed: true } });
  });

  it('reports unavailable when the keychain probe times out', async () => {
    const runner = new FakeSecurity(() => timedOut());
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', disabled: false, commandRunner: runner });

    expect(await adapter.availability()).toBe('unavailable');
  });

  it('surfaces an error when a read times out so callers can fall back', async () => {
    const runner = new FakeSecurity(() => timedOut());
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', commandRunner: runner });

    const result = await adapter.get('openai');
    expect(result.ok).toBe(false);
  });

  it('addresses an explicit keychain file when one is configured', async () => {
    const runner = new FakeSecurity((args) => (args[0] === 'find-generic-password' ? found('sk-temp') : notFound()));
    const adapter = new KeychainSecretsAdapter({
      platform: 'darwin',
      service: 'svc',
      keychainPath: '/tmp/probe.keychain',
      commandRunner: runner,
    });

    await adapter.get('openai');
    await adapter.set('openai', 'sk-temp');
    await adapter.delete('openai');
    for (const call of runner.calls) expect(call.args.at(-1)).toBe('/tmp/probe.keychain');
  });

  it('never repeats the secret in a failure message', async () => {
    const runner = new FakeSecurity(() => ({ code: 1, stdout: '', stderr: 'SecKeychainAddGenericPassword failed' }));
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', commandRunner: runner });

    const result = await adapter.set('openai', 'sk-must-not-leak');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).not.toContain('sk-must-not-leak');
  });
});
