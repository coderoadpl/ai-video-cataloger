import { describe, expect, it } from 'vitest';

import { parseCliVersion } from './index.js';

describe('parseCliVersion', () => {
  it('extracts a plain semver line', () => {
    expect(parseCliVersion('0.6.0\n')).toBe('0.6.0');
  });

  it('extracts a semver embedded in a longer banner', () => {
    expect(parseCliVersion('ai-video-cataloger 0.5.9 (build 42)')).toBe('0.5.9');
  });

  it('keeps a prerelease suffix', () => {
    expect(parseCliVersion('1.2.3-beta.1')).toBe('1.2.3-beta.1');
  });

  it('returns null when no version is present', () => {
    expect(parseCliVersion('command not found')).toBeNull();
  });
});
