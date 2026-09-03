import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { mapGoogleDriveError, uploadGoogleDriveFile } from './google-drive.js';

describe('shared Google Drive transport', () => {
  it.each([
    [401, { error: 'invalid_grant' }, 'backup_auth_required'],
    [403, { error: { errors: [{ reason: 'storageQuotaExceeded' }] } }, 'backup_quota_exceeded'],
    [403, { error: { errors: [{ reason: 'rateLimitExceeded' }] } }, 'rate_limited'],
    [429, { error: { message: 'slow down' } }, 'rate_limited'],
    [500, { error: { message: 'upstream failed' } }, 'backup_destination_error'],
  ] as const)('maps status %s to %s', (status, body, code) => {
    const error = mapGoogleDriveError(status, JSON.stringify(body), '17', ['secret-token']);
    expect(error.code).toBe(code);
    if (code === 'rate_limited') expect(error.details).toMatchObject({ retryAfter: '17' });
  });

  it('redacts tokens from unclassified response excerpts', () => {
    const error = mapGoogleDriveError(500, 'failed with secret-token', null, ['secret-token']);
    expect(error.message).not.toContain('secret-token');
  });

  it('uses resumable upload above 5 MB and retries the same chunk', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'avc-google-upload-'));
    const sourcePath = path.join(root, 'large.avcbak');
    writeFileSync(sourcePath, Buffer.alloc(6 * 1024 * 1024, 7));
    const requests: Array<{ url: string; method: string; range: string | null }> = [];
    let putAttempts = 0;
    const fetchImpl: typeof fetch = vi.fn(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const headers = new Headers(init?.headers);
      requests.push({ url, method, range: headers.get('content-range') });
      if (method === 'POST') return new Response('', { status: 200, headers: { Location: 'https://upload.example.test/session' } });
      putAttempts += 1;
      if (putAttempts === 1) return new Response('{"error":{"message":"retry"}}', { status: 500 });
      return Response.json({ id: 'remote-1', name: 'large.avcbak', size: String(6 * 1024 * 1024) });
    });

    const result = await uploadGoogleDriveFile({
      fetchImpl,
      uploadBaseUrl: 'https://upload.example.test/drive/v3',
      accessToken: 'secret-token',
      folderId: 'folder-1',
      sourcePath,
      name: 'large.avcbak',
      appProperties: {},
      sharedDrive: false,
      signal: new AbortController().signal,
      sleep: () => Promise.resolve(),
      random: () => 0,
    });

    expect(result).toMatchObject({ ok: true, value: { id: 'remote-1' } });
    expect(requests[0]?.url).toContain('uploadType=resumable');
    expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(2);
    expect(requests[1]?.range).toBe(requests[2]?.range);
  });

  it('retries Drive 403 user rate limits during resumable upload', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'avc-google-upload-403-'));
    const sourcePath = path.join(root, 'large.avcbak');
    writeFileSync(sourcePath, Buffer.alloc(6 * 1024 * 1024, 7));
    let putAttempts = 0;

    const result = await uploadGoogleDriveFile({
      fetchImpl: async (_input, init) => {
        if (init?.method === 'POST') {
          return new Response('', { status: 200, headers: { Location: 'https://upload.example.test/session' } });
        }
        putAttempts += 1;
        if (putAttempts === 1) {
          return Response.json({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } }, { status: 403 });
        }
        return Response.json({ id: 'remote-1', name: 'large.avcbak', size: String(6 * 1024 * 1024) });
      },
      uploadBaseUrl: 'https://upload.example.test/drive/v3',
      accessToken: 'secret-token',
      folderId: 'folder-1',
      sourcePath,
      name: 'large.avcbak',
      appProperties: {},
      sharedDrive: false,
      signal: new AbortController().signal,
      sleep: () => Promise.resolve(),
      random: () => 0,
    });

    expect(result).toMatchObject({ ok: true, value: { id: 'remote-1' } });
    expect(putAttempts).toBe(2);
  });

  it('resends a resumable chunk when Drive returns 308 without a Range header', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'avc-google-upload-308-'));
    const sourcePath = path.join(root, 'large.avcbak');
    writeFileSync(sourcePath, Buffer.alloc(10 * 1024 * 1024, 7));
    const ranges: string[] = [];
    let putAttempts = 0;

    const result = await uploadGoogleDriveFile({
      fetchImpl: async (_input, init) => {
        if (init?.method === 'POST') {
          return new Response('', { status: 200, headers: { Location: 'https://upload.example.test/session' } });
        }
        const headers = new Headers(init?.headers);
        ranges.push(headers.get('content-range') ?? '');
        putAttempts += 1;
        if (putAttempts === 1) return new Response('', { status: 308 });
        return Response.json({ id: 'remote-1', name: 'large.avcbak', size: String(10 * 1024 * 1024) });
      },
      uploadBaseUrl: 'https://upload.example.test/drive/v3',
      accessToken: 'secret-token',
      folderId: 'folder-1',
      sourcePath,
      name: 'large.avcbak',
      appProperties: {},
      sharedDrive: false,
      signal: new AbortController().signal,
      sleep: () => Promise.resolve(),
      random: () => 0,
    });

    expect(result).toMatchObject({ ok: true, value: { id: 'remote-1' } });
    expect(ranges).toEqual(['bytes 0-8388607/10485760', 'bytes 0-8388607/10485760']);
  });

  it('fails a resumable upload after repeated 308 responses make no progress', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'avc-google-upload-stuck-'));
    const sourcePath = path.join(root, 'large.avcbak');
    writeFileSync(sourcePath, Buffer.alloc(10 * 1024 * 1024, 7));
    let putAttempts = 0;

    const result = await uploadGoogleDriveFile({
      fetchImpl: async (_input, init) => {
        if (init?.method === 'POST') {
          return new Response('', { status: 200, headers: { Location: 'https://upload.example.test/session' } });
        }
        putAttempts += 1;
        return new Response('', { status: 308 });
      },
      uploadBaseUrl: 'https://upload.example.test/drive/v3',
      accessToken: 'secret-token',
      folderId: 'folder-1',
      sourcePath,
      name: 'large.avcbak',
      appProperties: {},
      sharedDrive: false,
      signal: new AbortController().signal,
      sleep: () => Promise.resolve(),
      random: () => 0,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'backup_destination_error' } });
    expect(putAttempts).toBe(5);
  });

  it('fails a resumable upload when 308 responses alternate the acknowledged range without advancing', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'avc-google-upload-alternating-'));
    const sourcePath = path.join(root, 'large.avcbak');
    writeFileSync(sourcePath, Buffer.alloc(10 * 1024 * 1024, 7));
    let putAttempts = 0;

    const result = await uploadGoogleDriveFile({
      fetchImpl: async (_input, init) => {
        if (init?.method === 'POST') {
          return new Response('', { status: 200, headers: { Location: 'https://upload.example.test/session' } });
        }
        putAttempts += 1;
        return putAttempts % 2 === 1
          ? new Response('', { status: 308, headers: { range: 'bytes=0-0' } })
          : new Response('', { status: 308 });
      },
      uploadBaseUrl: 'https://upload.example.test/drive/v3',
      accessToken: 'secret-token',
      folderId: 'folder-1',
      sourcePath,
      name: 'large.avcbak',
      appProperties: {},
      sharedDrive: false,
      signal: new AbortController().signal,
      sleep: () => Promise.resolve(),
      random: () => 0,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'backup_destination_error' } });
    expect(putAttempts).toBeLessThanOrEqual(10);
  });

  it('cancels a resumable session when the upload is aborted', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'avc-google-cancel-'));
    const sourcePath = path.join(root, 'large.avcbak');
    writeFileSync(sourcePath, Buffer.alloc(6 * 1024 * 1024, 7));
    const methods: string[] = [];
    const controller = new AbortController();
    const fetchImpl: typeof fetch = async (_input, init) => {
      const method = init?.method ?? 'GET';
      methods.push(method);
      if (method === 'POST') return new Response('', { status: 200, headers: { Location: 'https://upload.example.test/session' } });
      if (method === 'DELETE') return new Response(null, { status: 204 });
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    };
    const uploading = uploadGoogleDriveFile({
      fetchImpl,
      uploadBaseUrl: 'https://upload.example.test/drive/v3',
      accessToken: 'secret-token',
      folderId: 'folder-1',
      sourcePath,
      name: 'large.avcbak',
      appProperties: {},
      sharedDrive: false,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(methods).toContain('PUT'));
    controller.abort();

    expect(await uploading).toMatchObject({ ok: false, error: { code: 'processing_error' } });
    expect(methods).toContain('DELETE');
  });

  it('uses five full-jitter exponential attempts before failing a resumable chunk', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'avc-google-retries-'));
    const sourcePath = path.join(root, 'large.avcbak');
    writeFileSync(sourcePath, Buffer.alloc(6 * 1024 * 1024, 7));
    let attempts = 0;
    const delays: number[] = [];
    const result = await uploadGoogleDriveFile({
      fetchImpl: async (_input, init) => {
        if (init?.method === 'POST') {
          return new Response('', { status: 200, headers: { Location: 'https://upload.example.test/session' } });
        }
        attempts += 1;
        return Response.json({ error: { message: 'retry' } }, { status: 500 });
      },
      uploadBaseUrl: 'https://upload.example.test/drive/v3',
      accessToken: 'secret-token',
      folderId: 'folder-1',
      sourcePath,
      name: 'large.avcbak',
      appProperties: {},
      sharedDrive: false,
      signal: new AbortController().signal,
      sleep: (delay) => {
        delays.push(delay);
        return Promise.resolve();
      },
      random: () => 0.5,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'backup_destination_error' } });
    expect(attempts).toBe(5);
    expect(delays).toEqual([50, 100, 200, 400]);
  });
});
