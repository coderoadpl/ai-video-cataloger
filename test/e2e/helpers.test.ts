import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { isolatedHome } from './helpers.js';

const roots: string[] = [];

const tempRoot = (prefix: string): string => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
};

describe('e2e home isolation helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  it('keeps model fixtures inside the isolated home even when the host cache exists', () => {
    const hostHome = tempRoot('avc-host-home-');
    const workdir = tempRoot('avc-e2e-workdir-');
    mkdirSync(join(hostHome, '.ai-video-cataloger', 'models'), { recursive: true });
    vi.stubEnv('HOME', hostHome);

    const home = isolatedHome(workdir);
    const models = join(home, '.ai-video-cataloger', 'models');

    expect(existsSync(models)).toBe(true);
    expect(lstatSync(models).isSymbolicLink()).toBe(false);
  });
});
