import { describe, expect, it } from 'vitest';

import { assessStaleCli, type CliPathEntry } from './stale-cli.js';

const OWNED = ['/usr/local/bin/ai-video-cataloger'];

const entry = (overrides: Partial<CliPathEntry> & { path: string }): CliPathEntry => ({
  version: null,
  isSymlink: false,
  symlinkTarget: null,
  ...overrides,
});

describe('assessStaleCli', () => {
  it('reports no shadow when a clean PATH runs the current version', () => {
    const result = assessStaleCli({
      appVersion: '0.6.0',
      ownedInstallPaths: OWNED,
      entries: [entry({ path: '/usr/local/bin/ai-video-cataloger', version: '0.6.0', isSymlink: true })],
    });
    expect(result.stale).toBe(false);
    expect(result.activeVersion).toBe('0.6.0');
    expect(result.shadows).toEqual([]);
  });

  it('flags a stale shadow that wins on PATH ahead of the current install', () => {
    const result = assessStaleCli({
      appVersion: '0.6.0',
      ownedInstallPaths: OWNED,
      entries: [
        entry({ path: '/opt/homebrew/bin/ai-video-cataloger', version: '0.4.1' }),
        entry({ path: '/usr/local/bin/ai-video-cataloger', version: '0.6.0', isSymlink: true }),
      ],
    });
    expect(result.stale).toBe(true);
    expect(result.activePath).toBe('/opt/homebrew/bin/ai-video-cataloger');
    expect(result.shadows.map((shadow) => shadow.path)).toEqual(['/opt/homebrew/bin/ai-video-cataloger']);
    expect(result.shadows[0]?.removable).toBe(false);
  });

  it('lists every shadow when multiple stale copies precede the current one', () => {
    const result = assessStaleCli({
      appVersion: '0.6.0',
      ownedInstallPaths: OWNED,
      entries: [
        entry({ path: '/opt/homebrew/bin/ai-video-cataloger', version: '0.4.1' }),
        entry({ path: '/Users/me/bin/ai-video-cataloger', version: null }),
        entry({ path: '/usr/local/bin/ai-video-cataloger', version: '0.6.0', isSymlink: true }),
      ],
    });
    expect(result.stale).toBe(true);
    expect(result.shadows.map((shadow) => shadow.path)).toEqual([
      '/opt/homebrew/bin/ai-video-cataloger',
      '/Users/me/bin/ai-video-cataloger',
    ]);
  });

  it('marks an owned symlink shadow as trivially removable', () => {
    const result = assessStaleCli({
      appVersion: '0.6.0',
      ownedInstallPaths: OWNED,
      entries: [
        entry({ path: '/usr/local/bin/ai-video-cataloger', version: '0.4.1', isSymlink: true, symlinkTarget: '/old/app' }),
      ],
    });
    expect(result.stale).toBe(true);
    expect(result.shadows[0]?.removable).toBe(true);
  });

  it('treats every mismatched copy as a shadow when no current install exists on PATH', () => {
    const result = assessStaleCli({
      appVersion: '0.6.0',
      ownedInstallPaths: OWNED,
      entries: [
        entry({ path: '/opt/homebrew/bin/ai-video-cataloger', version: '0.4.1' }),
        entry({ path: '/usr/local/bin/ai-video-cataloger', version: '0.5.0', isSymlink: true }),
      ],
    });
    expect(result.stale).toBe(true);
    expect(result.shadows.map((shadow) => shadow.path)).toEqual([
      '/opt/homebrew/bin/ai-video-cataloger',
      '/usr/local/bin/ai-video-cataloger',
    ]);
    expect(result.shadows[1]?.removable).toBe(true);
  });

  it('is a no-op when the command is not on PATH at all', () => {
    const result = assessStaleCli({ appVersion: '0.6.0', ownedInstallPaths: OWNED, entries: [] });
    expect(result.stale).toBe(false);
    expect(result.activePath).toBeNull();
    expect(result.shadows).toEqual([]);
  });
});
