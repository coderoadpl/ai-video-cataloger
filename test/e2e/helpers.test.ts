import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { cachedWhisperModelPath, isolatedHome } from './helpers.js';

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

  it('stages the scratch-cached whisper model into the isolated home', () => {
    const scratch = tempRoot('avc-e2e-scratch-');
    const workdir = tempRoot('avc-e2e-workdir-');
    vi.stubEnv('AVC_SCRATCH_DIR', scratch);
    const cached = cachedWhisperModelPath('base');
    mkdirSync(join(scratch, 'whisper-models'), { recursive: true });
    writeFileSync(cached, 'ggml-bytes');

    const home = isolatedHome(workdir);

    expect(cached).toBe(join(scratch, 'whisper-models', 'ggml-base.bin'));
    expect(readFileSync(join(home, '.ai-video-cataloger', 'models', 'whisper', 'ggml-base.bin'), 'utf8')).toBe('ggml-bytes');
  });

  it('leaves the isolated home without a whisper model when the scratch cache is empty', () => {
    const scratch = tempRoot('avc-e2e-scratch-');
    const workdir = tempRoot('avc-e2e-workdir-');
    vi.stubEnv('AVC_SCRATCH_DIR', scratch);

    const home = isolatedHome(workdir);

    expect(existsSync(join(home, '.ai-video-cataloger', 'models', 'whisper', 'ggml-base.bin'))).toBe(false);
  });
});
