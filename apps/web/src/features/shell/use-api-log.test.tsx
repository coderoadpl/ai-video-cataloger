import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { apiLogStore, type ApiLogEntry } from '../../api-log.js';
import { apiLogLine, useApiLog } from './use-api-log.js';

const requestEntry: ApiLogEntry = {
  id: 'api-1-req',
  requestId: 'api-1',
  at: 100,
  direction: 'request',
  method: 'POST',
  url: '/api/v1/process',
  status: null,
  durationMs: null,
  body: '{"videoPath":"a.mp4"}',
};

const responseEntry: ApiLogEntry = {
  id: 'api-1-res',
  requestId: 'api-1',
  at: 150,
  direction: 'response',
  method: 'POST',
  url: '/api/v1/process',
  status: 200,
  durationMs: 50,
  body: '{"jobId":"j1"}',
};

describe('apiLogLine', () => {
  it('maps a request entry to a stdout line with the raw request body attached', () => {
    const line = apiLogLine(requestEntry);
    expect(line).toMatchObject({
      id: 'api-1-req',
      at: 100,
      content: '→ POST /api/v1/process',
      type: 'stdout',
      raw: '→ POST /api/v1/process\n{"videoPath":"a.mp4"}',
    });
  });

  it('maps a response entry to an info line with status and duration', () => {
    const line = apiLogLine(responseEntry);
    expect(line).toMatchObject({
      content: '← 200 POST /api/v1/process (50ms)',
      type: 'info',
      raw: '← 200 POST /api/v1/process (50ms)\n{"jobId":"j1"}',
    });
  });

  it('maps a 4xx/5xx response to an error line', () => {
    const line = apiLogLine({ ...responseEntry, status: 500, body: null });
    expect(line.type).toBe('error');
    expect(line.raw).toBeNull();
  });

  it('maps an error entry to an error line whose raw equals its content', () => {
    const line = apiLogLine({
      ...requestEntry,
      id: 'api-1-err',
      direction: 'error',
      status: null,
      durationMs: 5,
      body: 'network down',
    });
    expect(line.type).toBe('error');
    expect(line.content).toBe('× POST /api/v1/process — network down');
    expect(line.raw).toBe(line.content);
  });
});

describe('useApiLog', () => {
  afterEach(() => {
    apiLogStore.clear();
  });

  it('captures a request/response pair recorded on the store', () => {
    const { result } = renderHook(() => useApiLog());

    act(() => {
      apiLogStore.record(requestEntry);
      apiLogStore.record(responseEntry);
    });

    expect(result.current.lines.map((line) => line.content)).toEqual([
      '→ POST /api/v1/process',
      '← 200 POST /api/v1/process (50ms)',
    ]);
  });

  it('clears via the store', () => {
    const { result } = renderHook(() => useApiLog());

    act(() => {
      apiLogStore.record(requestEntry);
    });
    expect(result.current.lines).toHaveLength(1);

    act(() => {
      result.current.clear();
    });
    expect(result.current.lines).toHaveLength(0);
  });
});
