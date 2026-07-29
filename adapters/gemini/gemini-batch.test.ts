import { describe, expect, it } from 'vitest';

import {
  geminiNativeModelPricing,
  isBatchSubmitRejection,
  type AnalyzerProviderConfig,
} from '@core/domain/index.js';
import type { AnalyzerBatchRequest, CredentialsStore } from '@core/server/index.js';

import { GeminiNativeAnalyzerAdapter, geminiProviderPricing, type VideoFileSource } from './index.js';

const provider = (
  overrides: Partial<Extract<AnalyzerProviderConfig, { family: 'gemini-native' }>> = {},
): Extract<AnalyzerProviderConfig, { family: 'gemini-native' }> => ({
  family: 'gemini-native',
  providerId: 'gemini',
  apiKeyRef: 'gemini',
  model: 'gemini-3.6-flash',
  ...overrides,
});

const credentials: CredentialsStore = {
  get: () => Promise.resolve({ ok: true, value: 'key' }),
  set: () => Promise.resolve({ ok: true, value: undefined }),
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface FetchCall {
  url: string;
  method: string;
  body: string | null;
}

const recordingFetch = (
  handler: (call: FetchCall, index: number) => Response,
): { fetchImpl: typeof fetch; calls: FetchCall[] } => {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const body = typeof init?.body === 'string' ? init.body : null;
    const call: FetchCall = { url, method: init?.method ?? 'GET', body };
    const index = calls.length;
    calls.push(call);
    return Promise.resolve(handler(call, index));
  };
  return { fetchImpl, calls };
};

const videoFile: VideoFileSource = {
  size: () => Promise.resolve(4096),
  readAll: () => Promise.resolve(new Uint8Array(4096)),
  open: () =>
    Promise.resolve({
      read: (_offset: number, length: number) => Promise.resolve(new Uint8Array(new ArrayBuffer(length))),
      close: () => Promise.resolve(),
    }),
};

const batchRequest = (key: string, videoPath: string): AnalyzerBatchRequest => ({
  key,
  videoPath,
  fileName: `files/${key}`,
  fileUri: `https://files/${key}`,
  outputLanguage: 'auto',
  tagLanguage: 'auto',
});

const adapterWith = (fetchImpl: typeof fetch): GeminiNativeAnalyzerAdapter =>
  new GeminiNativeAnalyzerAdapter({ credentials, fetchImpl, videoFile, sleep: () => Promise.resolve() });

const answer = (text: string, usage = { promptTokenCount: 1000, candidatesTokenCount: 500, thoughtsTokenCount: 500 }) => ({
  candidates: [{ content: { parts: [{ text }] } }],
  usageMetadata: usage,
});

const RESPONSE_TEXT = 'DESCRIPTION: a boat\nFILENAME: wooden-boat\nTAGS: boat\nTRANSCRIPT:\n[00:01] czesc';

describe('gemini batch pricing', () => {
  it('halves the published rates in batch mode and leaves interactive rates untouched', () => {
    expect(geminiNativeModelPricing('gemini-3.6-flash')).toEqual({
      pricePerMTokensInput: 1.5,
      pricePerMTokensOutput: 7.5,
    });
    expect(geminiNativeModelPricing('gemini-3.6-flash', 'batch')).toEqual({
      pricePerMTokensInput: 0.75,
      pricePerMTokensOutput: 3.75,
    });
  });

  it('ignores explicit prices and halves the researched model rate', () => {
    const configured = provider({ pricePerMTokensInput: 3, pricePerMTokensOutput: 12 });

    expect(geminiProviderPricing(configured)).toEqual({ pricePerMTokensInput: 1.5, pricePerMTokensOutput: 7.5 });
    expect(geminiProviderPricing(configured, 'batch')).toEqual({
      pricePerMTokensInput: 0.75,
      pricePerMTokensOutput: 3.75,
    });
  });
});

describe('gemini batch lifecycle', () => {
  it('uploads a file, submits one inline job, polls to succeeded, and costs the answers at batch rates', async () => {
    const states = ['JOB_STATE_PENDING', 'JOB_STATE_RUNNING', 'JOB_STATE_SUCCEEDED'];
    let polls = 0;
    const { fetchImpl, calls } = recordingFetch((call) => {
      if (call.url.endsWith('/upload/v1beta/files')) {
        return new Response(null, { status: 200, headers: { 'x-goog-upload-url': 'https://upload.example/s' } });
      }
      if (call.url === 'https://upload.example/s') {
        return jsonResponse({ file: { name: 'files/one', uri: 'https://files/one', state: 'PROCESSING' } });
      }
      if (call.method === 'GET' && call.url.endsWith('/v1beta/files/one')) {
        return jsonResponse({ state: 'ACTIVE', uri: 'https://files/one' });
      }
      if (call.url.includes(':batchGenerateContent')) {
        return jsonResponse({ name: 'batches/42', metadata: { state: 'JOB_STATE_PENDING' } });
      }
      if (call.url.endsWith('/v1beta/batches/42')) {
        const state = states[Math.min(polls, states.length - 1)];
        polls += 1;
        if (state !== 'JOB_STATE_SUCCEEDED') return jsonResponse({ name: 'batches/42', metadata: { state } });
        return jsonResponse({
          name: 'batches/42',
          done: true,
          metadata: { state },
          response: { inlinedResponses: [{ response: answer(RESPONSE_TEXT), metadata: { key: 'r0' } }] },
        });
      }
      throw new Error(`unexpected call ${call.method} ${call.url}`);
    });
    const adapter = adapterWith(fetchImpl);

    const uploaded = await adapter.uploadForBatch({
      key: 'r0',
      videoPath: '/drive/one.mp4',
      outputLanguage: 'auto',
      tagLanguage: 'auto',
      provider: provider(),
      timeoutSeconds: 120,
    });
    expect(uploaded).toMatchObject({ ok: true, value: { fileName: 'files/one', fileUri: 'https://files/one' } });
    if (!uploaded.ok) return;

    const submitted = await adapter.submitBatch({
      provider: provider(),
      displayName: 'avc-drive-run-1',
      requests: [uploaded.value],
    });
    expect(submitted).toMatchObject({ ok: true, value: { jobName: 'batches/42', requestCount: 1 } });

    const submitBody: unknown = JSON.parse(calls.find((call) => call.url.includes(':batchGenerateContent'))?.body ?? '{}');
    expect(submitBody).toMatchObject({
      batch: {
        display_name: 'avc-drive-run-1',
        input_config: {
          requests: {
            requests: [
              {
                request: {
                  contents: [
                    {
                      parts: [
                        { file_data: { mime_type: 'video/mp4', file_uri: 'https://files/one' } },
                        { text: expect.stringContaining('TRANSCRIPT:') },
                      ],
                    },
                  ],
                },
                metadata: { key: 'r0' },
              },
            ],
          },
        },
      },
    });

    const first = await adapter.batchStatus({ provider: provider(), model: 'gemini-3.6-flash', jobName: 'batches/42', requestKeys: ['r0'] });
    const second = await adapter.batchStatus({ provider: provider(), model: 'gemini-3.6-flash', jobName: 'batches/42', requestKeys: ['r0'] });
    const third = await adapter.batchStatus({ provider: provider(), model: 'gemini-3.6-flash', jobName: 'batches/42', requestKeys: ['r0'] });

    expect(first).toMatchObject({ ok: true, value: { state: 'pending', results: null } });
    expect(second).toMatchObject({ ok: true, value: { state: 'running', results: null } });
    expect(third.ok && third.value.state).toBe('succeeded');
    if (!third.ok || third.value.results === null) throw new Error('expected results');
    const [result] = third.value.results;
    expect(result?.key).toBe('r0');
    expect(result?.outcome.ok).toBe(true);
    if (result === undefined || !result.outcome.ok) return;
    expect(result.outcome.value.transcript?.segments).toEqual([{ start: 1, end: 2, text: 'czesc' }]);
    expect(result.outcome.value.usage).toMatchObject({
      promptTokens: 1000,
      billedOutputTokens: 1000,
      estimatedCostUsd: (1000 * 0.75 + 1000 * 3.75) / 1_000_000,
    });
  });

  it('maps a per-request error to a per-file failure and leaves its siblings intact', async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        name: 'batches/7',
        done: true,
        metadata: { state: 'JOB_STATE_SUCCEEDED' },
        response: {
          inlinedResponses: {
            inlinedResponses: [
              { response: answer(RESPONSE_TEXT), metadata: { key: 'r0' } },
              { error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' }, metadata: { key: 'r1' } },
            ],
          },
        },
      }));
    const adapter = adapterWith(fetchImpl);

    const status = await adapter.batchStatus({
      provider: provider(),
      model: 'gemini-3.6-flash',
      jobName: 'batches/7',
      requestKeys: ['r0', 'r1', 'r2'],
    });

    expect(status.ok && status.value.state).toBe('succeeded');
    if (!status.ok || status.value.results === null) throw new Error('expected results');
    expect(status.value.results.map((entry) => entry.key)).toEqual(['r0', 'r1', 'r2']);
    expect(status.value.results[0]?.outcome.ok).toBe(true);
    expect(status.value.results[1]?.outcome).toMatchObject({ ok: false, error: { code: 'rate_limited' } });
    expect(status.value.results[2]?.outcome).toMatchObject({ ok: false, error: { code: 'provider_error' } });
  });

  it('prices the answers at the job model rate when the configured model has moved on', async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        name: 'batches/9',
        done: true,
        metadata: { state: 'JOB_STATE_SUCCEEDED' },
        response: { inlinedResponses: { inlinedResponses: [{ response: answer(RESPONSE_TEXT), metadata: { key: 'r0' } }] } },
      }));

    const status = await adapterWith(fetchImpl).batchStatus({
      provider: provider({ model: 'gemini-flash-lite-latest', pricePerMTokensInput: 0.1, pricePerMTokensOutput: 0.4 }),
      model: 'gemini-3.6-flash',
      jobName: 'batches/9',
      requestKeys: ['r0'],
    });

    expect(status.ok && status.value.results?.[0]?.outcome.ok).toBe(true);
    if (!status.ok || status.value.results === null) throw new Error('expected results');
    const outcome = status.value.results[0]?.outcome;
    expect(outcome?.ok === true && outcome.value.usage?.estimatedCostUsd)
      .toBe((1000 * 0.75 + 1000 * 3.75) / 1_000_000);
  });

  it('falls back to request order when the API drops the metadata key', async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        name: 'batches/8',
        done: true,
        metadata: { state: 'JOB_STATE_SUCCEEDED' },
        response: { inlinedResponses: [{ response: answer(RESPONSE_TEXT) }, { response: answer(RESPONSE_TEXT) }] },
      }));

    const status = await adapterWith(fetchImpl).batchStatus({
      provider: provider(),
      model: 'gemini-3.6-flash',
      jobName: 'batches/8',
      requestKeys: ['r0', 'r1'],
    });

    expect(status.ok && status.value.results?.map((entry) => entry.key)).toEqual(['r0', 'r1']);
    expect(status.ok && status.value.results?.every((entry) => entry.outcome.ok)).toBe(true);
  });

  it('reports an expired job instead of throwing when Gemini no longer knows it', async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse({ error: { code: 404, message: 'not found' } }, 404));

    const status = await adapterWith(fetchImpl).batchStatus({
      provider: provider(),
      model: 'gemini-3.6-flash',
      jobName: 'batches/gone',
      requestKeys: ['r0'],
    });

    expect(status).toMatchObject({ ok: true, value: { state: 'expired', results: null } });
  });

  it('reports a failed job with the API message', async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        name: 'batches/9',
        done: true,
        metadata: { state: 'JOB_STATE_FAILED' },
        error: { code: 3, message: 'input file references an expired file' },
      }));

    const status = await adapterWith(fetchImpl).batchStatus({
      provider: provider(),
      model: 'gemini-3.6-flash',
      jobName: 'batches/9',
      requestKeys: ['r0'],
    });

    expect(status).toMatchObject({
      ok: true,
      value: { state: 'failed', message: 'input file references an expired file', results: null },
    });
  });

  it('refuses a request set that does not fit the inline limit instead of truncating it', async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse({ name: 'batches/never' }));
    const requests = Array.from({ length: 12_000 }, (_value, index) => batchRequest(`r${index}`, `/drive/clip-${index}.mp4`));

    const submitted = await adapterWith(fetchImpl).submitBatch({
      provider: provider(),
      displayName: 'avc-drive-run-big',
      requests,
    });

    expect(submitted).toMatchObject({ ok: false, error: { code: 'provider_error' } });
    if (submitted.ok) return;
    expect(submitted.error.message).toContain('18 MB');
    expect(calls).toHaveLength(0);
  });

  it('finds an already submitted job by the display name the run persisted', async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        operations: [
          { name: 'batches/1', metadata: { displayName: 'avc-drive-other' } },
          { name: 'batches/2', metadata: { displayName: 'avc-drive-run-1' } },
        ],
      }));

    const found = await adapterWith(fetchImpl).findBatchByDisplayName({
      provider: provider(),
      displayName: 'avc-drive-run-1',
    });

    expect(found).toMatchObject({ ok: true, value: 'batches/2' });
  });

  it('answers null when no batch carries the display name', async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse({ operations: [] }));

    const found = await adapterWith(fetchImpl).findBatchByDisplayName({
      provider: provider(),
      displayName: 'avc-drive-run-1',
    });

    expect(found).toMatchObject({ ok: true, value: null });
  });

  it('walks every page of the batch list before giving up on the display name', async () => {
    const { fetchImpl, calls } = recordingFetch((call) =>
      call.url.includes('pageToken=page-2')
        ? jsonResponse({ operations: [{ name: 'batches/2', metadata: { displayName: 'avc-drive-run-1' } }] })
        : jsonResponse({
          operations: [{ name: 'batches/1', metadata: { displayName: 'avc-drive-other' } }],
          nextPageToken: 'page-2',
        }));

    const found = await adapterWith(fetchImpl).findBatchByDisplayName({
      provider: provider(),
      displayName: 'avc-drive-run-1',
    });

    expect(found).toMatchObject({ ok: true, value: 'batches/2' });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toContain('pageToken=page-2');
  });

  it('stops paging once the list is exhausted', async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse({ operations: [] }));

    const found = await adapterWith(fetchImpl).findBatchByDisplayName({
      provider: provider(),
      displayName: 'avc-drive-run-1',
    });

    expect(found).toMatchObject({ ok: true, value: null });
    expect(calls).toHaveLength(1);
  });

  it('picks the newest batch when several carry the same display name', async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        operations: [
          { name: 'batches/old', metadata: { displayName: 'avc-drive-run-1', createTime: '2026-01-01T00:00:00Z' } },
          { name: 'batches/new', metadata: { displayName: 'avc-drive-run-1', createTime: '2026-01-02T00:00:00Z' } },
        ],
      }));
    const warnings: string[] = [];
    const adapter = new GeminiNativeAnalyzerAdapter({
      credentials,
      fetchImpl,
      videoFile,
      sleep: () => Promise.resolve(),
      onWarning: (message) => warnings.push(message),
    });

    const found = await adapter.findBatchByDisplayName({ provider: provider(), displayName: 'avc-drive-run-1' });

    expect(found).toMatchObject({ ok: true, value: 'batches/new' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('avc-drive-run-1');
  });

  it('picks the newest same-named batch even when the older one is on an earlier page', async () => {
    const { fetchImpl, calls } = recordingFetch((call) =>
      call.url.includes('pageToken=page-2')
        ? jsonResponse({
          operations: [
            { name: 'batches/new', metadata: { displayName: 'avc-drive-run-1', createTime: '2026-01-02T00:00:00Z' } },
          ],
        })
        : jsonResponse({
          operations: [
            { name: 'batches/old', metadata: { displayName: 'avc-drive-run-1', createTime: '2026-01-01T00:00:00Z' } },
          ],
          nextPageToken: 'page-2',
        }));
    const warnings: string[] = [];
    const adapter = new GeminiNativeAnalyzerAdapter({
      credentials,
      fetchImpl,
      videoFile,
      sleep: () => Promise.resolve(),
      onWarning: (message) => warnings.push(message),
    });

    const found = await adapter.findBatchByDisplayName({ provider: provider(), displayName: 'avc-drive-run-1' });

    expect(found).toMatchObject({ ok: true, value: 'batches/new' });
    expect(calls).toHaveLength(2);
    expect(warnings).toHaveLength(1);
  });

  it('reports a job that is done with an error as failed even when the state suffix is empty', async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({ name: 'batches/9', done: true, error: { code: 3, message: 'quota exhausted' } }));

    const status = await adapterWith(fetchImpl).batchStatus({
      provider: provider(),
      model: 'gemini-3.6-flash',
      jobName: 'batches/9',
      requestKeys: ['r0'],
    });

    expect(status).toMatchObject({ ok: true, value: { state: 'failed', message: 'quota exhausted' } });
  });

  it('reports a job that names a success state while carrying a job-level error as failed', async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        name: 'batches/9',
        done: true,
        metadata: { state: 'JOB_STATE_SUCCEEDED' },
        error: { code: 13, message: 'internal batch failure' },
      }));

    const status = await adapterWith(fetchImpl).batchStatus({
      provider: provider(),
      model: 'gemini-3.6-flash',
      jobName: 'batches/9',
      requestKeys: ['r0'],
    });

    expect(status).toMatchObject({ ok: true, value: { state: 'failed', message: 'internal batch failure' } });
  });

  it('reads a bare state name that carries no STATE_ prefix', async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse({ name: 'batches/9', metadata: { state: 'CANCELLED' } }));

    const status = await adapterWith(fetchImpl).batchStatus({
      provider: provider(),
      model: 'gemini-3.6-flash',
      jobName: 'batches/9',
      requestKeys: ['r0'],
    });

    expect(status).toMatchObject({ ok: true, value: { state: 'cancelled' } });
  });

  it('maps a gRPC status string on a per-request error to its own taxonomy', async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        name: 'batches/9',
        done: true,
        metadata: { state: 'JOB_STATE_SUCCEEDED' },
        response: {
          inlinedResponses: [
            { metadata: { key: 'r0' }, error: { message: 'no access', status: 'PERMISSION_DENIED' } },
            { metadata: { key: 'r1' }, error: { message: 'slow down', status: 'RESOURCE_EXHAUSTED' } },
            { metadata: { key: 'r2' }, error: { message: 'bad key', status: 'UNAUTHENTICATED' } },
          ],
        },
      }));

    const status = await adapterWith(fetchImpl).batchStatus({
      provider: provider(),
      model: 'gemini-3.6-flash',
      jobName: 'batches/9',
      requestKeys: ['r0', 'r1', 'r2'],
    });

    const codes = status.ok
      ? status.value.results?.map((entry) => (entry.outcome.ok ? 'ok' : entry.outcome.error.code))
      : [];
    expect(codes).toEqual(['provider_auth_failed', 'rate_limited', 'provider_auth_failed']);
  });

  it('deletes every uploaded file when the run releases the batch', async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse({}));

    const released = await adapterWith(fetchImpl).releaseBatchUploads({
      provider: provider(),
      fileNames: ['files/r0', 'files/r1'],
    });

    expect(released).toEqual({ ok: true, value: { retained: 0 } });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'DELETE https://generativelanguage.googleapis.com/v1beta/files/r0',
      'DELETE https://generativelanguage.googleapis.com/v1beta/files/r1',
    ]);
  });

  it('counts the uploads the Files API refused to delete instead of reporting a clean release', async () => {
    const { fetchImpl } = recordingFetch((call) =>
      call.url.endsWith('files/r1') ? jsonResponse({ error: { code: 500 } }, 500) : jsonResponse({}));

    const released = await adapterWith(fetchImpl).releaseBatchUploads({
      provider: provider(),
      fileNames: ['files/r0', 'files/r1'],
    });

    expect(released).toEqual({ ok: true, value: { retained: 1 } });
  });

  it('counts an upload the Files API already dropped as released, not retained', async () => {
    const { fetchImpl } = recordingFetch((call) =>
      call.url.endsWith('files/r1')
        ? jsonResponse({ error: { code: 404, message: 'File not found', status: 'NOT_FOUND' } }, 404)
        : jsonResponse({}));

    const released = await adapterWith(fetchImpl).releaseBatchUploads({
      provider: provider(),
      fileNames: ['files/r0', 'files/r1'],
    });

    expect(released).toEqual({ ok: true, value: { retained: 0 } });
  });

  it('marks a 4xx submit rejection as definitive and leaves a network failure uncertain', async () => {
    const rejecting = recordingFetch(() =>
      jsonResponse({ error: { code: 400, message: 'invalid request', status: 'INVALID_ARGUMENT' } }, 400));
    const rejected = await adapterWith(rejecting.fetchImpl).submitBatch({
      provider: provider(),
      displayName: 'avc-drive-run-1',
      requests: [batchRequest('r0', '/drive/one.mp4')],
    });

    expect(rejected.ok).toBe(false);
    expect(rejected.ok === false && isBatchSubmitRejection(rejected.error)).toBe(true);

    const dropping: typeof fetch = () => Promise.reject(new Error('fetch failed'));
    const dropped = await adapterWith(dropping).submitBatch({
      provider: provider(),
      displayName: 'avc-drive-run-1',
      requests: [batchRequest('r0', '/drive/one.mp4')],
    });

    expect(dropped.ok).toBe(false);
    expect(dropped.ok === false && isBatchSubmitRejection(dropped.error)).toBe(false);
  });
});
