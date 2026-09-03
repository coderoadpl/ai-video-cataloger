import { describe, expect, it, vi } from 'vitest';

import { resolveRecoveryKey } from './recovery-key.js';

describe('CLI recovery key resolution', () => {
  it('never reads the key from argv: without a flag or environment there is no key', async () => {
    const prompt = vi.fn(() => Promise.resolve('unused'));

    expect(await resolveRecoveryKey({ requested: false, env: undefined, interactive: true, prompt }))
      .toEqual({ ok: true, value: undefined });
    expect(prompt).not.toHaveBeenCalled();
  });

  it('prefers the environment variable over prompting', async () => {
    const prompt = vi.fn(() => Promise.resolve('typed'));

    expect(await resolveRecoveryKey({ requested: true, env: '  ENV-KEY  ', interactive: true, prompt }))
      .toEqual({ ok: true, value: 'ENV-KEY' });
    expect(prompt).not.toHaveBeenCalled();
  });

  it('uses the environment variable even when the flag is absent', async () => {
    expect(await resolveRecoveryKey({ requested: false, env: 'ENV-KEY', interactive: false, prompt: () => Promise.resolve('') }))
      .toEqual({ ok: true, value: 'ENV-KEY' });
  });

  it('prompts on a terminal when the flag is given', async () => {
    expect(await resolveRecoveryKey({
      requested: true,
      env: undefined,
      interactive: true,
      prompt: () => Promise.resolve('  TYPED-KEY '),
    })).toEqual({ ok: true, value: 'TYPED-KEY' });
  });

  it('refuses an empty prompt answer and a non-interactive run', async () => {
    expect(await resolveRecoveryKey({ requested: true, env: undefined, interactive: true, prompt: () => Promise.resolve('   ') }))
      .toMatchObject({ ok: false, error: { code: 'recovery_key_required' } });
    expect(await resolveRecoveryKey({ requested: true, env: '', interactive: false, prompt: () => Promise.resolve('x') }))
      .toMatchObject({ ok: false, error: { code: 'recovery_key_required' } });
  });
});
