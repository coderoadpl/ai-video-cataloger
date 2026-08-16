import { describe, expect, it, vi } from 'vitest';

import type { DesktopApiBridge, DesktopFetchResponse } from '@core/contract/index.js';

import { bridgeFetch } from './api.js';

const deferred = <T,>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolver: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promise, resolve: resolver };
};

describe('bridgeFetch', () => {
  it('rejects a pending renderer request with AbortError when its signal aborts', async () => {
    const pending = deferred<DesktopFetchResponse>();
    const api: DesktopApiBridge = { request: vi.fn(() => pending.promise) };
    const controller = new AbortController();
    const request = bridgeFetch(api)('/api/jobs/status', { signal: controller.signal });

    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(api.request).toHaveBeenCalledTimes(1);
    pending.resolve({ status: 200, statusText: 'OK', headers: {}, body: '{}' });
    await Promise.resolve();
  });
});
