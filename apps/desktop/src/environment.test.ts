import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildDesktopPath, userDataDirectoryOverride } from './environment.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

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
  it('accepts an absolute flag override only in unpackaged builds', () => {
    const argv = ['electron', '--user-data-dir=/tmp/avc-profile'];

    expect(userDataDirectoryOverride(argv, false, '')).toBe('/tmp/avc-profile');
    expect(userDataDirectoryOverride(argv, true, '')).toBeNull();
  });

  it('accepts an absolute environment override in packaged and unpackaged builds', () => {
    const argv = ['electron', '--user-data-dir=/tmp/flag-profile'];
    vi.stubEnv('AI_VIDEO_CATALOGER_USER_DATA_DIR', '/tmp/environment-profile');

    expect(userDataDirectoryOverride(argv, false)).toBe('/tmp/environment-profile');
    expect(userDataDirectoryOverride(argv, true)).toBe('/tmp/environment-profile');
  });

  it('rejects relative environment and flag overrides', () => {
    expect(userDataDirectoryOverride(['electron', '--user-data-dir=flag-profile'], false, 'environment-profile'))
      .toBeNull();
    expect(userDataDirectoryOverride(['electron', '--user-data-dir=/tmp/flag-profile'], true, 'environment-profile'))
      .toBeNull();
  });
});
