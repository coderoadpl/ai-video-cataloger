import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@server/src/create-app.js';

vi.mock('electron', () => ({
  app: { name: 'AI Video Cataloger', isPackaged: false },
  dialog: { showMessageBox: vi.fn() },
  Menu: {
    buildFromTemplate: vi.fn((template: unknown) => template),
    setApplicationMenu: vi.fn(),
  },
  shell: { openExternal: vi.fn() },
}));

import { dispatchApiRequest, removeRecentFolder, setFolderCurrent } from './ipc.js';
import { FolderStore } from './folder-store.js';
import { FolderWatchController } from './folder-watch.js';

const unusedJob = async (): Promise<never> => {
  throw new Error('jobs port is not exercised by the api-request gate');
};

const buildDesktopApp = (): App => {
  const honoApp = new Hono();
  honoApp.get('/status', (c) => c.text('ok'));
  return {
    honoApp,
    jobs: {
      enqueue: unusedJob,
      get: unusedJob,
      list: unusedJob,
      cancel: unusedJob,
      onSettled: () => undefined,
      acquireResource: unusedJob,
    },
    catalogFolderPaths: async () => [],
    watchFolder: async () => ({ ok: true, value: { stop: () => undefined } }),
    dispose: async () => undefined,
  };
};

describe('deferred api-request gate', () => {
  it('waits for composition to resolve, then dispatches the request', async () => {
    let resolveApp!: (value: App) => void;
    const composition = new Promise<App>((resolve) => {
      resolveApp = resolve;
    });

    const responsePromise = dispatchApiRequest(composition, { url: '/status', method: 'GET' });
    let settled = false;
    void responsePromise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveApp(buildDesktopApp());
    await expect(responsePromise).resolves.toMatchObject({ status: 200, body: 'ok' });
  });

  it('rejects with the composition error when composition fails', async () => {
    const composition = Promise.reject(new Error('sql.js WASM init failed'));
    void composition.catch(() => undefined);

    await expect(dispatchApiRequest(composition, { url: '/status', method: 'GET' })).rejects.toThrow(
      'sql.js WASM init failed',
    );
  });
});

const tempRoots: string[] = [];

const tempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'avc-desktop-ipc-'));
  tempRoots.push(root);
  return root;
};

const buildFolderDeps = async () => {
  const storePath = path.join(await tempRoot(), 'folder-store.json');
  const folderStore = new FolderStore(storePath);
  const folderWatch = new FolderWatchController({
    desktopApp: Promise.resolve(buildDesktopApp()),
    notify: () => undefined,
  });
  return { folderStore, folderWatch, getMainWindow: () => null };
};

describe('setFolderCurrent', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('returns an explicit failure instead of resolving silently when the path is not a string', async () => {
    const deps = await buildFolderDeps();
    const result = await setFolderCurrent(deps, 42);
    expect(result).toEqual({ ok: false, error: 'Folder path must be a string' });
    expect(await deps.folderStore.getCurrent()).toBeNull();
  });

  it('returns an explicit failure instead of resolving silently when the path is not a real directory', async () => {
    const deps = await buildFolderDeps();
    const missingPath = path.join(await tempRoot(), 'does-not-exist');
    const result = await setFolderCurrent(deps, missingPath);
    expect(result).toEqual({ ok: false, error: `Not a valid folder: ${missingPath}` });
    expect(await deps.folderStore.getCurrent()).toBeNull();
  });

  it('persists the folder and returns ok on success', async () => {
    const deps = await buildFolderDeps();
    const validDir = await tempRoot();
    const result = await setFolderCurrent(deps, validDir);
    expect(result).toEqual({ ok: true });
    expect(await deps.folderStore.getCurrent()).toBe(validDir);
  });

  it('logs a failed folder watch instead of letting it drop as an unhandled rejection', async () => {
    const deps = await buildFolderDeps();
    const watchError = new Error('inotify limit reached');
    vi.spyOn(deps.folderWatch, 'watch').mockRejectedValue(watchError);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const validDir = await tempRoot();

    const result = await setFolderCurrent(deps, validDir);
    expect(result).toEqual({ ok: true });
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(consoleError.mock.calls[0]?.join(' ')).toContain('inotify limit reached');
    consoleError.mockRestore();
  });
});

describe('removeRecentFolder', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('rejects instead of resolving as success when the path fails validation', async () => {
    const deps = await buildFolderDeps();
    await expect(removeRecentFolder(deps, 'relative/path')).rejects.toThrow(
      'Folder path must be an absolute string',
    );
  });

  it('rejects instead of resolving as success when the path is not a string', async () => {
    const deps = await buildFolderDeps();
    await expect(removeRecentFolder(deps, 42)).rejects.toThrow('Folder path must be an absolute string');
  });

  it('removes a known recent folder on success', async () => {
    const deps = await buildFolderDeps();
    const validDir = await tempRoot();
    await setFolderCurrent(deps, validDir);
    expect(await deps.folderStore.getRecent()).toContain(validDir);

    await removeRecentFolder(deps, validDir);

    expect(await deps.folderStore.getRecent()).not.toContain(validDir);
  });
});
