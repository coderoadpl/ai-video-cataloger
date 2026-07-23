import { describe, expect, it } from 'vitest';

import { resolveHarnessCommand, type HarnessCommandResolution } from './index.js';

const makeResolution = (present: readonly string[], env: NodeJS.ProcessEnv): HarnessCommandResolution => {
  const set = new Set(present);
  return {
    env,
    homeDirectory: '/home/user',
    fileExists: (candidate) => set.has(candidate),
    listDirectory: (directory) =>
      directory === '/home/user/.nvm/versions/node' ? ['v20.11.0', 'v22.3.0', 'v18.19.0'] : [],
  };
};

describe('resolveHarnessCommand', () => {
  it('resolves a command found only in a known install dir when PATH misses it', () => {
    const resolution = makeResolution(['/home/user/.local/bin/claude'], { PATH: '/usr/bin:/bin' });
    expect(resolveHarnessCommand('claude', resolution)).toBe('/home/user/.local/bin/claude');
  });

  it('prefers a PATH hit over a known install dir', () => {
    const resolution = makeResolution(['/usr/bin/codex', '/home/user/.local/bin/codex'], { PATH: '/usr/bin:/bin' });
    expect(resolveHarnessCommand('codex', resolution)).toBe('/usr/bin/codex');
  });

  it('picks the newest nvm bin directory when the binary lives only there', () => {
    const resolution = makeResolution(['/home/user/.nvm/versions/node/v22.3.0/bin/cursor-agent'], { PATH: '/usr/bin' });
    expect(resolveHarnessCommand('cursor-agent', resolution)).toBe(
      '/home/user/.nvm/versions/node/v22.3.0/bin/cursor-agent',
    );
  });

  it('returns the bare command unchanged when it is nowhere to be found', () => {
    const resolution = makeResolution([], { PATH: '/usr/bin:/bin' });
    expect(resolveHarnessCommand('claude', resolution)).toBe('claude');
  });

  it('treats an explicit configured path as authoritative and does not probe', () => {
    const resolution = makeResolution([], { PATH: '/usr/bin' });
    expect(resolveHarnessCommand('/opt/tools/claude', resolution)).toBe('/opt/tools/claude');
  });
});
