import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_KEYCHAIN_SERVICE,
  KeychainSecretsAdapter,
  SECURITY_COMMAND_PATH,
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

afterEach(() => {
  vi.unstubAllEnvs();
});

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

  it('honors the disabled environment setting without invoking security', async () => {
    vi.stubEnv('AI_VIDEO_CATALOGER_DISABLE_KEYCHAIN', '1');
    const runner = new FakeSecurity(() => ({ code: 0, stdout: '', stderr: '' }));
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', commandRunner: runner });

    expect(await adapter.availability()).toBe('disabled');
    expect(runner.calls).toHaveLength(0);
  });

  it('probes again after an unavailable verdict so a recovered keychain is used', async () => {
    let code = 1;
    const runner = new FakeSecurity(() => ({ code, stdout: '', stderr: 'no keychain' }));
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', disabled: false, commandRunner: runner });

    expect(await adapter.availability()).toBe('unavailable');
    code = 0;
    expect(await adapter.availability()).toBe('available');
    expect(runner.calls.filter((call) => call.args[0] === 'list-keychains')).toHaveLength(2);
  });

  it('answers a structural verdict from the cache without shelling out again', async () => {
    const runner = new FakeSecurity(() => ({ code: 0, stdout: '', stderr: '' }));
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', disabled: true, commandRunner: runner });

    expect(await adapter.availability()).toBe('disabled');
    expect(await adapter.availability()).toBe('disabled');
    expect(runner.calls).toHaveLength(0);
  });

  it('does not invoke security for disabled get, set, or delete operations', async () => {
    const runner = new FakeSecurity(() => ({ code: 0, stdout: 'secret\n', stderr: '' }));
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', disabled: true, commandRunner: runner });

    expect(await adapter.get('openai')).toMatchObject({ ok: false, error: { code: 'keychain_unavailable' } });
    expect(await adapter.set('openai', 'sk-test')).toMatchObject({ ok: false, error: { code: 'keychain_unavailable' } });
    expect(await adapter.delete('openai')).toMatchObject({ ok: false, error: { code: 'keychain_unavailable' } });
    expect(runner.calls).toHaveLength(0);
  });

  it('runs the absolute security binary instead of resolving it on PATH', async () => {
    const runner = new FakeSecurity(() => ({ code: 0, stdout: '', stderr: '' }));
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', disabled: false, commandRunner: runner });

    await adapter.availability();
    await adapter.get('openai');
    await adapter.set('openai', 'sk-test');
    await adapter.delete('openai');

    expect(SECURITY_COMMAND_PATH).toBe('/usr/bin/security');
    expect(runner.calls.map((call) => call.command)).toEqual(Array.from(runner.calls, () => '/usr/bin/security'));
  });

  it('reads a stored secret and strips the trailing newline', async () => {
    const runner = new FakeSecurity((args) => (args[0] === 'find-generic-password' ? found('sk-test') : notFound()));
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', disabled: false, commandRunner: runner });

    expect(await adapter.get('openai')).toEqual({ ok: true, value: 'sk-test' });
    const call = runner.calls.find((entry) => entry.args[0] === 'find-generic-password');
    expect(call?.args).toEqual(['find-generic-password', '-s', DEFAULT_KEYCHAIN_SERVICE, '-a', 'openai', '-w']);
  });

  it('returns null when the item is not found', async () => {
    const runner = new FakeSecurity(() => notFound());
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', disabled: false, commandRunner: runner });

    expect(await adapter.get('missing')).toEqual({ ok: true, value: null });
  });

  it('surfaces an error for an unexpected security failure', async () => {
    const runner = new FakeSecurity(() => ({ code: 1, stdout: '', stderr: 'boom' }));
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', disabled: false, commandRunner: runner });

    const result = await adapter.get('openai');
    expect(result.ok).toBe(false);
  });

  it('writes a secret with the update flag', async () => {
    const runner = new FakeSecurity(() => ({ code: 0, stdout: '', stderr: '' }));
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', disabled: false, service: 'svc', commandRunner: runner });

    expect(await adapter.set('openai', 'sk-new')).toEqual({ ok: true, value: undefined });
    const call = runner.calls.find((entry) => entry.args[0] === 'add-generic-password');
    expect(call?.args).toEqual(['add-generic-password', '-U', '-s', 'svc', '-a', 'openai', '-w', 'sk-new']);
  });

  it('treats a missing item as a successful delete that removed nothing', async () => {
    const runner = new FakeSecurity(() => notFound());
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', disabled: false, commandRunner: runner });

    expect(await adapter.delete('openai')).toEqual({ ok: true, value: { existed: false } });
  });

  it('reports that a deleted item existed', async () => {
    const runner = new FakeSecurity(() => ({ code: 0, stdout: '', stderr: '' }));
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', disabled: false, commandRunner: runner });

    expect(await adapter.delete('openai')).toEqual({ ok: true, value: { existed: true } });
  });

  it('surfaces an error when an unreachable keychain refuses the delete', async () => {
    const runner = new FakeSecurity(() => ({ code: 36, stdout: '', stderr: 'The specified keychain could not be found.' }));
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', disabled: false, commandRunner: runner });

    expect(await adapter.delete('openai')).toMatchObject({ ok: false, error: { code: 'internal' } });
  });

  it('reports unavailable when the keychain probe times out', async () => {
    const runner = new FakeSecurity(() => timedOut());
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', disabled: false, commandRunner: runner });

    expect(await adapter.availability()).toBe('unavailable');
  });

  it('surfaces an error when a read times out so callers can fall back', async () => {
    const runner = new FakeSecurity(() => timedOut());
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', disabled: false, commandRunner: runner });

    const result = await adapter.get('openai');
    expect(result.ok).toBe(false);
  });

  it('addresses an explicit keychain file when one is configured', async () => {
    const runner = new FakeSecurity((args) => {
      if (args[0] === 'find-generic-password') return found('sk-temp');
      return { code: 0, stdout: '', stderr: '' };
    });
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

  it('validates an explicit keychain once before writing to it', async () => {
    const runner = new FakeSecurity(() => ({ code: 0, stdout: '', stderr: '' }));
    const adapter = new KeychainSecretsAdapter({
      platform: 'darwin',
      disabled: false,
      keychainPath: '/tmp/valid.keychain',
      commandRunner: runner,
    });

    expect(await adapter.availability()).toBe('available');
    expect(await adapter.set('openai', 'sk-first')).toEqual({ ok: true, value: undefined });
    expect(await adapter.set('gemini', 'sk-second')).toEqual({ ok: true, value: undefined });
    expect(runner.calls.map((call) => call.args[0])).toEqual([
      'show-keychain-info',
      'add-generic-password',
      'add-generic-password',
    ]);
    expect(runner.calls[0]?.args).toEqual(['show-keychain-info', '/tmp/valid.keychain']);
  });

  it('caches an invalid explicit keychain verdict and never attempts a write', async () => {
    const runner = new FakeSecurity(() => ({
      code: 36,
      stdout: '',
      stderr: 'The specified keychain could not be found.',
    }));
    const adapter = new KeychainSecretsAdapter({
      platform: 'darwin',
      disabled: false,
      keychainPath: '/tmp/missing.keychain',
      commandRunner: runner,
    });

    expect(await adapter.availability()).toBe('unavailable');
    expect(await adapter.set('openai', 'sk-first')).toMatchObject({
      ok: false,
      error: { code: 'keychain_unavailable' },
    });
    expect(await adapter.set('gemini', 'sk-second')).toMatchObject({
      ok: false,
      error: { code: 'keychain_unavailable' },
    });
    expect(runner.calls.map((call) => call.args)).toEqual([
      ['show-keychain-info', '/tmp/missing.keychain'],
    ]);
  });

  it('targets only the environment keychain during readiness and credential access', async () => {
    vi.stubEnv('AI_VIDEO_CATALOGER_DISABLE_KEYCHAIN', '');
    vi.stubEnv('AI_VIDEO_CATALOGER_KEYCHAIN', '/tmp/environment.keychain');
    const runner = new FakeSecurity((args) => (
      args[0] === 'find-generic-password' ? found('sk-temp') : { code: 0, stdout: '', stderr: '' }
    ));
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', disabled: false, commandRunner: runner });

    expect(await adapter.availability()).toBe('available');
    await adapter.get('openai');
    await adapter.set('openai', 'sk-temp');
    await adapter.delete('openai');

    expect(runner.calls[0]?.args).toEqual(['show-keychain-info', '/tmp/environment.keychain']);
    for (const call of runner.calls) expect(call.args.at(-1)).toBe('/tmp/environment.keychain');
  });

  it('never repeats the secret in a failure message', async () => {
    const runner = new FakeSecurity(() => ({ code: 1, stdout: '', stderr: 'SecKeychainAddGenericPassword failed' }));
    const adapter = new KeychainSecretsAdapter({ platform: 'darwin', disabled: false, commandRunner: runner });

    const result = await adapter.set('openai', 'sk-must-not-leak');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).not.toContain('sk-must-not-leak');
  });
});
