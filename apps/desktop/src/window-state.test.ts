import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadWindowState, normalizeWindowState, saveWindowState } from './window-state.js';

const tempRoots: string[] = [];

describe('window state', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('loads the default 1200x800 state when the file is missing or malformed', async () => {
    const root = await tempRoot();
    expect(await loadWindowState(path.join(root, 'missing.json'))).toEqual({ width: 1200, height: 800 });

    const malformed = path.join(root, 'bad.json');
    await writeFile(malformed, '{"width":"large"}', 'utf8');
    expect(await loadWindowState(malformed)).toEqual({ width: 1200, height: 800 });
  });

  it('clamps persisted dimensions to the 900x600 minimum', async () => {
    expect(normalizeWindowState({ x: 10, y: 20, width: 400, height: 300, isMaximized: true })).toEqual({
      x: 10,
      y: 20,
      width: 900,
      height: 600,
      isMaximized: true,
    });
  });

  it('writes normalized state to window-state.json', async () => {
    const statePath = path.join(await tempRoot(), 'window-state.json');
    await saveWindowState(statePath, { width: 1, height: 2 });

    expect(JSON.parse(await readFile(statePath, 'utf8'))).toEqual({ width: 900, height: 600 });
  });
});

const tempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'avc-desktop-window-'));
  tempRoots.push(root);
  return root;
};
