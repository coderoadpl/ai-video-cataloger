import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FolderStore, trimRecentFolders } from './folder-store.js';

const tempRoots: string[] = [];

describe('FolderStore', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('keeps recent folders unique and trimmed to ten', async () => {
    const storePath = path.join(await tempRoot(), 'folder-store.json');
    const store = new FolderStore(storePath);

    for (let index = 0; index < 12; index += 1) {
      await store.setCurrent(`/videos/${index}`);
    }
    await store.setCurrent('/videos/5');

    expect(await store.getCurrent()).toBe('/videos/5');
    expect(await store.getRecent()).toEqual([
      '/videos/5',
      '/videos/11',
      '/videos/10',
      '/videos/9',
      '/videos/8',
      '/videos/7',
      '/videos/6',
      '/videos/4',
      '/videos/3',
      '/videos/2',
    ]);
  });

  it('clears current folder when removing the selected recent folder', async () => {
    const storePath = path.join(await tempRoot(), 'folder-store.json');
    const store = new FolderStore(storePath);
    await store.setCurrent('/videos/a');
    await store.setCurrent('/videos/b');

    await store.removeRecent('/videos/b');

    expect(await store.getCurrent()).toBeNull();
    expect(await store.getRecent()).toEqual(['/videos/a']);
    expect(JSON.parse(await readFile(storePath, 'utf8'))).toEqual({
      currentFolder: null,
      recentFolders: ['/videos/a'],
    });
  });

  it('keeps the current folder when clearing recent folders', async () => {
    const storePath = path.join(await tempRoot(), 'folder-store.json');
    const store = new FolderStore(storePath);
    await store.setCurrent('/videos/a');
    await store.setCurrent('/videos/b');

    await store.clearRecent();

    expect(await store.getCurrent()).toBe('/videos/b');
    expect(await store.getRecent()).toEqual([]);
  });
});

describe('trimRecentFolders', () => {
  it('deduplicates before applying the max recent folder limit', () => {
    expect(trimRecentFolders(['/a', '/b', '/a', '/c'])).toEqual(['/a', '/b', '/c']);
  });
});

const tempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'avc-desktop-folder-'));
  tempRoots.push(root);
  return root;
};
