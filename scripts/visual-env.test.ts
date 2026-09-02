import { describe, expect, it } from 'vitest';

import { resolveVisualEnvironment, visualSnapshotPathTemplate } from './visual-env.js';

describe('resolveVisualEnvironment', () => {
  it('falls back to the local darwin baselines when VISUAL_ENV is unset or empty', () => {
    expect(resolveVisualEnvironment(undefined)).toBe('local-darwin');
    expect(resolveVisualEnvironment('')).toBe('local-darwin');
  });

  it('accepts the hosted runner id', () => {
    expect(resolveVisualEnvironment('ci-macos-15')).toBe('ci-macos-15');
  });

  it('rejects an unknown id instead of comparing against a foreign baseline set', () => {
    expect(() => resolveVisualEnvironment('ubuntu-latest')).toThrow(/VISUAL_ENV/);
  });
});

describe('visualSnapshotPathTemplate', () => {
  it('keeps the local environment on the existing darwin directory', () => {
    expect(visualSnapshotPathTemplate('local-darwin')).toBe(
      '{testDir}/__screenshots__/darwin/{projectName}/{arg}{ext}',
    );
  });

  it('gives the hosted runner its own directory', () => {
    expect(visualSnapshotPathTemplate('ci-macos-15')).toBe(
      '{testDir}/__screenshots__/ci-macos-15/{projectName}/{arg}{ext}',
    );
  });

  it('never lets two environments share a baseline directory', () => {
    expect(visualSnapshotPathTemplate('local-darwin')).not.toBe(
      visualSnapshotPathTemplate('ci-macos-15'),
    );
  });
});
