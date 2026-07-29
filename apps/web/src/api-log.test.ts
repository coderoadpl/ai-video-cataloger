import { beforeEach, describe, expect, it } from 'vitest';

import {
  API_LOG_MAX_BODY_CHARS,
  API_LOG_MAX_ENTRIES,
  apiLogStore,
  appendApiEntry,
  instrumentFetch,
  type ApiLogEntry,
} from './api-log.js';

const entryAt = (n: number): ApiLogEntry => ({
  id: `e${String(n)}`,
  requestId: `api-${String(n)}`,
  at: n,
  direction: 'request',
  method: 'GET',
  url: '/api/v1/health',
  status: null,
  durationMs: null,
  body: null,
});

describe('appendApiEntry', () => {
  it('caps the ring buffer, dropping the oldest entries', () => {
    let entries: readonly ApiLogEntry[] = [];
    for (let i = 0; i < API_LOG_MAX_ENTRIES + 3; i += 1) {
      entries = appendApiEntry(entries, entryAt(i), API_LOG_MAX_ENTRIES);
    }

    expect(entries.length).toBe(API_LOG_MAX_ENTRIES);
    expect(entries.at(0)?.id).toBe('e3');
    expect(entries.at(-1)?.id).toBe(`e${String(API_LOG_MAX_ENTRIES + 2)}`);
  });
});

describe('apiLogStore', () => {
  beforeEach(() => {
    apiLogStore.clear();
  });

  it('bounds itself at API_LOG_MAX_ENTRIES and keeps the newest entries', () => {
    expect(API_LOG_MAX_ENTRIES).toBe(500);

    for (let i = 0; i < API_LOG_MAX_ENTRIES + 2; i += 1) apiLogStore.record(entryAt(i));

    const entries = apiLogStore.snapshot();
    expect(entries).toHaveLength(API_LOG_MAX_ENTRIES);
    expect(entries.at(0)?.id).toBe('e2');
    expect(entries.at(-1)?.id).toBe(`e${String(API_LOG_MAX_ENTRIES + 1)}`);
  });

  it('notifies subscribers on record and clear', () => {
    let notifications = 0;
    const unsubscribe = apiLogStore.subscribe(() => {
      notifications += 1;
    });

    apiLogStore.record(entryAt(1));
    apiLogStore.clear();
    apiLogStore.clear();
    unsubscribe();
    apiLogStore.record(entryAt(2));

    expect(notifications).toBe(2);
  });
});

describe('instrumentFetch', () => {
  beforeEach(() => {
    apiLogStore.clear();
  });

  it('records a request/response pair and returns the original response untouched', async () => {
    const response = new Response('{"ok":true}', { status: 200 });
    const fetchImpl = instrumentFetch(async () => response);

    const result = await fetchImpl('/api/v1/process', { method: 'POST', body: '{"videoPath":"a.mp4"}' });

    expect(result).toBe(response);
    expect(await result.clone().text()).toBe('{"ok":true}');

    const entries = apiLogStore.snapshot();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      direction: 'request',
      method: 'POST',
      url: '/api/v1/process',
      status: null,
      body: '{"videoPath":"a.mp4"}',
    });
    expect(entries[1]).toMatchObject({
      direction: 'response',
      method: 'POST',
      url: '/api/v1/process',
      status: 200,
      body: '{"ok":true}',
    });
    expect(entries[1]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('truncates request and response bodies beyond the body cap', async () => {
    const longBody = 'x'.repeat(API_LOG_MAX_BODY_CHARS + 50);
    const response = new Response(longBody, { status: 200 });
    const fetchImpl = instrumentFetch(async () => response);

    await fetchImpl('/api/v1/scan', { method: 'POST', body: longBody });

    const entries = apiLogStore.snapshot();
    expect(entries[0]?.body?.length).toBe(API_LOG_MAX_BODY_CHARS + 1);
    expect(entries[0]?.body?.endsWith('…')).toBe(true);
    expect(entries[1]?.body?.length).toBe(API_LOG_MAX_BODY_CHARS + 1);
  });

  it('records and rethrows a thrown fetch failure', async () => {
    const cause = new Error('network down');
    const fetchImpl = instrumentFetch(() => Promise.reject(cause));

    await expect(fetchImpl('/api/v1/health')).rejects.toBe(cause);

    const entries = apiLogStore.snapshot();
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({ direction: 'error', method: 'GET', body: 'Error: network down' });
  });

  it('defaults the method to GET and reads a Request input url', async () => {
    const response = new Response(null, { status: 204 });
    const fetchImpl = instrumentFetch(async () => response);

    await fetchImpl(new Request('http://localhost/api/v1/jobs'));

    const entries = apiLogStore.snapshot();
    expect(entries[0]).toMatchObject({ method: 'GET', url: 'http://localhost/api/v1/jobs' });
  });
});
