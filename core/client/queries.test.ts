import { QueryClient } from '@tanstack/query-core';
import { describe, expect, it } from 'vitest';

import { createApiClient } from './http.js';
import {
  ApiError,
  configQuery,
  jobProgressRefetchInterval,
  jobQuery,
  modelsWhisperScopes,
  scanQuery,
  useWhisperModelMutation,
  type JobOutput,
} from './index.js';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const jobWithStatus = (status: JobOutput['status']): JobOutput => ({
  jobId: 'job-1',
  kind: 'process',
  status,
  progress: null,
  error: null,
  createdAt: '2026-07-12T10:00:00.000Z',
  updatedAt: '2026-07-12T10:00:00.000Z',
});

describe('query descriptors', () => {
  it('uses hierarchical keys with params and calls the same params through the query function', async () => {
    const seenInputs: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      seenInputs.push(String(input));
      return jsonResponse({
        ok: true,
        data: {
          folder: '/videos/A B',
          databasePath: null,
          videos: [],
          summary: {
            total: 0,
            tracked: 0,
            pending: 0,
            inProgress: 0,
            completed: 0,
            error: 0,
            notTracked: 0,
          },
        },
      });
    };
    const api = createApiClient({ baseUrl: '', fetchImpl });
    const descriptor = scanQuery(api, { folder: '/videos/A B' });
    const queryClient = new QueryClient();

    expect(descriptor.queryKey).toEqual(['scan', 'folder', '/videos/A B']);
    await expect(queryClient.fetchQuery(descriptor)).resolves.toMatchObject({ folder: '/videos/A B' });
    expect(seenInputs).toEqual(['/api/scan?folder=%2Fvideos%2FA+B']);
  });

  it('scopes config and model keys by resource', () => {
    const api = createApiClient({
      baseUrl: '',
      fetchImpl: async () => jsonResponse({ ok: true, data: {} }),
    });

    expect(configQuery(api).queryKey).toEqual(['config', 'all', null]);
    expect(configQuery(api, { key: 'frames' }).queryKey).toEqual(['config', 'key', 'frames']);
    expect(modelsWhisperScopes.all()).toEqual(['models', 'whisper']);
    expect(jobQuery(api, { jobId: 'job-1' }).queryKey).toEqual(['jobs', 'detail', 'job-1']);
  });

  it('throws ApiError with the original taxonomy error from descriptors', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ ok: false, error: { code: 'invalid_model', message: 'invalid model' } }, 400);
    const api = createApiClient({ baseUrl: '', fetchImpl });
    const descriptor = useWhisperModelMutation(api);
    const queryClient = new QueryClient();
    const context = { client: queryClient, meta: undefined, mutationKey: descriptor.mutationKey };

    await expect(descriptor.mutationFn({ modelName: 'base' }, context)).rejects.toMatchObject({
      appError: { code: 'invalid_model', message: 'invalid model' },
    });
    await expect(descriptor.mutationFn({ modelName: 'base' }, context)).rejects.toBeInstanceOf(ApiError);
  });

  it('stops job polling on terminal statuses', () => {
    const interval = jobProgressRefetchInterval(250);

    expect(interval({ state: { data: undefined } })).toBe(250);
    expect(interval({ state: { data: jobWithStatus('queued') } })).toBe(250);
    expect(interval({ state: { data: jobWithStatus('running') } })).toBe(250);
    expect(interval({ state: { data: jobWithStatus('completed') } })).toBe(false);
    expect(interval({ state: { data: jobWithStatus('failed') } })).toBe(false);
    expect(interval({ state: { data: jobWithStatus('cancelled') } })).toBe(false);
  });
});
