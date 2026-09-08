import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

import { verifyHomeIsolation } from './preflight.js';
import { desktopLaunchEnv } from './helpers.js';

const roots: string[] = [];
const temp = () => {
  const root = mkdtempSync(join(tmpdir(), 'avc-isolation-probe-'));
  roots.push(root);
  return root;
};
afterEach(() => { vi.unstubAllEnvs(); for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('overrides an inherited Electron profile and inactive flag', () => {
  const profile = temp();
  const environment = desktopLaunchEnv(profile, {}, { AI_VIDEO_CATALOGER_USER_DATA_DIR: '/inherited-profile', AVC_WINDOW_INACTIVE: '0' });
  expect(environment.AI_VIDEO_CATALOGER_USER_DATA_DIR).toBe(profile);
  expect(environment.AVC_WINDOW_INACTIVE).toBe('1');
});

it('rejects unset, relative, nonexistent and canonical aliases of the account home', () => {
  const account = temp();
  const scratch = temp();
  const aliases = temp();
  const alias = join(aliases, 'alias');
  symlinkSync(account, alias);
  for (const home of [undefined, '', 'relative', join(aliases, 'missing'), `${account}/`, alias]) {
    expect(() => verifyHomeIsolation({ HOME: home, AVC_SCRATCH_DIR: scratch }, account)).toThrow(/isolated/);
  }
  const isolated = temp();
  expect(() => verifyHomeIsolation({ HOME: isolated }, account)).toThrow(/AVC_SCRATCH_DIR/);
  expect(() => verifyHomeIsolation({ HOME: isolated, AVC_SCRATCH_DIR: account }, account)).toThrow(/isolated/);
  mkdirSync(join(account, '.ai-video-cataloger'));
  expect(() => verifyHomeIsolation({ HOME: isolated, AVC_SCRATCH_DIR: join(account, '.ai-video-cataloger') }, account)).toThrow(/isolated/);
  expect(() => verifyHomeIsolation({ HOME: isolated, AVC_SCRATCH_DIR: scratch }, account)).not.toThrow();
});
