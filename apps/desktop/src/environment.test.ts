import { describe, expect, it } from 'vitest';

import { buildDesktopPath, userDataDirectoryOverride } from './environment.js';

describe('buildDesktopPath', () => {
  it('adds Homebrew executable locations to a Finder-style PATH', () => {
    expect(buildDesktopPath('/usr/bin:/bin:/usr/sbin:/sbin')).toBe(
      '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin',
    );
  });

  it('does not duplicate executable locations already present', () => {
    expect(buildDesktopPath('/usr/local/bin:/usr/bin:/opt/homebrew/bin')).toBe(
      '/usr/local/bin:/usr/bin:/opt/homebrew/bin',
    );
  });
});

describe('userDataDirectoryOverride', () => {
  it('accepts an absolute override only in unpackaged builds', () => {
    const argv = ['electron', '--user-data-dir=/tmp/avc-profile'];

    expect(userDataDirectoryOverride(argv, false)).toBe('/tmp/avc-profile');
    expect(userDataDirectoryOverride(argv, true)).toBeNull();
  });

  it('rejects relative overrides', () => {
    expect(userDataDirectoryOverride(['electron', '--user-data-dir=profile'], false)).toBeNull();
  });
});
