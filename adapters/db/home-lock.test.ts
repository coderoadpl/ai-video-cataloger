import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { SqlJsGlobalCatalogStore } from './global-catalog.js';
import { HomeLock } from './home-lock.js';

const tempRoots: string[] = [];

const tempHome = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'avc-home-lock-'));
  tempRoots.push(root);
  return root;
};

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  }
});

describe('HomeLock', () => {
  it('keeps the lock file alive while any sharing store still holds a lease', async () => {
    const home = await tempHome();
    const lockPath = path.join(home, '.ai-video-cataloger', 'catalog.lock');
    const lock = new HomeLock({ homeDirectory: home, processName: 'cli', lockMode: 'lazy' });
    const storeOne = new SqlJsGlobalCatalogStore({ homeDirectory: home, lock, processName: 'cli', lockMode: 'lazy' });
    const storeTwo = new SqlJsGlobalCatalogStore({ homeDirectory: home, lock, processName: 'cli', lockMode: 'lazy' });

    expect((await storeOne.acquireLease()).ok).toBe(true);
    expect(existsSync(lockPath)).toBe(true);

    expect((await storeTwo.upsertFolder({
      folderId: 'folder-1',
      currentPath: '/media/a',
      displayName: 'a',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
    })).ok).toBe(true);
    expect((await storeTwo.flush()).ok).toBe(true);

    expect(existsSync(lockPath)).toBe(true);

    expect((await storeOne.releaseLease()).ok).toBe(true);
    expect(existsSync(lockPath)).toBe(false);
  });
});
