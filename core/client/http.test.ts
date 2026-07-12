import { describe, expect, it } from 'vitest';

import type { AppError, Result } from '@core/domain/index.js';

import { ApiError, createApiClient, unwrap } from './http.js';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('createApiClient health query', () => {
  it('parses a successful envelope through the route output schema', async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(input).toBe('https://api.example.test/api/health');
      expect(init).toMatchObject({ method: 'GET' });
      return jsonResponse({ ok: true, data: { status: 'ok', version: '0.1.0' } });
    };
    const client = createApiClient({ baseUrl: 'https://api.example.test', fetchImpl });

    await expect(client.health()).resolves.toEqual({
      ok: true,
      value: { status: 'ok', version: '0.1.0' },
    });
  });

  it('returns the contract AppError from a non-2xx envelope', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ ok: false, error: { code: 'not_found', message: 'gone' } }, 404);
    const client = createApiClient({ baseUrl: '', fetchImpl });

    await expect(client.health()).resolves.toEqual({
      ok: false,
      error: { code: 'not_found', message: 'gone' },
    });
  });

  it('turns invalid response data into an internal failure', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ ok: true, data: { status: 'degraded', version: '0.1.0' } });
    const client = createApiClient({ baseUrl: '', fetchImpl });

    await expect(client.health()).resolves.toMatchObject({ ok: false, error: { code: 'internal' } });
  });

  it('turns malformed envelopes into an internal failure', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ data: { status: 'ok' } });
    const client = createApiClient({ baseUrl: '', fetchImpl });

    await expect(client.health()).resolves.toMatchObject({ ok: false, error: { code: 'internal' } });
  });
});

describe('createApiClient route calls', () => {
  it('interpolates GET route params into the request URL', async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(input).toBe('/api/scan?folder=%2Fvideos%2FA+B');
      expect(init).toMatchObject({ method: 'GET' });
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
    const client = createApiClient({ baseUrl: '', fetchImpl });

    await expect(client.scan({ folder: '/videos/A B' })).resolves.toMatchObject({ ok: true });
  });

  it('zod-parses command input before sending JSON bodies', async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(input).toBe('/api/process');
      expect(init).toMatchObject({
        method: 'POST',
        body: JSON.stringify({
          videoPath: '/videos/clip.mp4',
          frames: 3,
          framesExplicit: false,
          skipRename: false,
          skipRenameExplicit: false,
          verbose: false,
          timeout: 120,
          timeoutExplicit: false,
          whisper: 'local',
          whisperExplicit: false,
          whisperModel: 'base',
          whisperModelExplicit: false,
        }),
      });
      return jsonResponse({ ok: true, data: { jobId: 'job-1' } });
    };
    const client = createApiClient({ baseUrl: '', fetchImpl });

    await expect(client.processVideo({ videoPath: '/videos/clip.mp4' })).resolves.toEqual({
      ok: true,
      value: { jobId: 'job-1' },
    });
  });

  it('returns taxonomy errors for invalid client input', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ ok: true, data: { jobId: 'unused' } });
    const client = createApiClient({ baseUrl: '', fetchImpl });

    await expect(client.processVideo({ videoPath: '', frames: 99 })).resolves.toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  });
});

describe('unwrap', () => {
  it('throws ApiError carrying the AppError', () => {
    const appError: AppError = { code: 'conflict', message: 'Already exists' };
    const result: Result<string, AppError> = { ok: false, error: appError };

    expect(() => unwrap(result)).toThrow(ApiError);

    try {
      unwrap(result);
      throw new Error('Expected unwrap to throw');
    } catch (error) {
      if (error instanceof ApiError) {
        expect(error.appError).toBe(appError);
        return;
      }
      throw error;
    }
  });
});
