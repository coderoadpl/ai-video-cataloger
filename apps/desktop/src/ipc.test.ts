import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { App } from '@server/src/create-app.js';

import { dispatchApiRequest } from './ipc.js';

const unusedJob = async (): Promise<never> => {
  throw new Error('jobs port is not exercised by the api-request gate');
};

const buildDesktopApp = (): App => {
  const honoApp = new Hono();
  honoApp.get('/status', (c) => c.text('ok'));
  return {
    honoApp,
    jobs: { enqueue: unusedJob, get: unusedJob, list: unusedJob, cancel: unusedJob },
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
