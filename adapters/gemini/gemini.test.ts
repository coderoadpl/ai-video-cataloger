import { describe, expect, it } from 'vitest';

import {
  analyzerProviderConfigSchema,
  defaultGeminiNativeProvider,
  geminiNativeModelIds,
  geminiNativeModelPricing,
  geminiUsageAccounting,
  type AnalyzerProviderConfig,
} from '@core/domain/index.js';
import type { AnalyzeInput, CredentialsStore } from '@core/server/index.js';

import {
  GeminiNativeAnalyzerAdapter,
  buildGeminiPrompt,
  geminiProviderPricing,
  parseGeminiTranscript,
  shouldUploadInline,
} from './index.js';

const geminiProvider = (overrides: Partial<Extract<AnalyzerProviderConfig, { family: 'gemini-native' }>> = {}): Extract<
  AnalyzerProviderConfig,
  { family: 'gemini-native' }
> => ({
  family: 'gemini-native',
  providerId: 'gemini',
  apiKeyRef: 'gemini',
  model: 'gemini-3.6-flash',
  pricePerMTokensInput: 1.5,
  pricePerMTokensOutput: 7.5,
  ...overrides,
});

const fakeCredentials = (value: string | null): CredentialsStore => ({
  get: () => Promise.resolve({ ok: true, value }),
  set: () => Promise.resolve({ ok: true, value: undefined }),
});

const analyzeInput = (overrides: Partial<AnalyzeInput> = {}): AnalyzeInput => ({
  videoPath: '/videos/clip.mp4',
  framePaths: [],
  transcript: null,
  backend: 'claude',
  localModel: '',
  provider: geminiProvider(),
  timeoutSeconds: 120,
  outputLanguage: 'auto',
  verbose: false,
  ...overrides,
});

const jsonResponse = (body: unknown, init?: { status?: number; headers?: Record<string, string> }): Response =>
  new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

const recordingFetch = (
  handler: (call: FetchCall, index: number) => Response,
): { fetchImpl: typeof fetch; calls: FetchCall[] } => {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headersInit = init?.headers ?? {};
    const headers: Record<string, string> = {};
    if (headersInit instanceof Headers) headersInit.forEach((value, key) => { headers[key] = value; });
    else for (const [key, value] of Object.entries(headersInit)) headers[key.toLowerCase()] = String(value);
    const call: FetchCall = { url, method: init?.method ?? 'GET', headers };
    const index = calls.length;
    calls.push(call);
    return Promise.resolve(handler(call, index));
  };
  return { fetchImpl, calls };
};

const smallVideo = new Uint8Array(1024);
const largeVideo = new Uint8Array(21 * 1024 * 1024);

describe('config validation', () => {
  it('accepts a gemini-native provider config', () => {
    const parsed = analyzerProviderConfigSchema.safeParse(geminiProvider());
    expect(parsed.success).toBe(true);
  });

  it('rejects a gemini-native config missing apiKeyRef', () => {
    const parsed = analyzerProviderConfigSchema.safeParse({
      family: 'gemini-native',
      providerId: 'gemini',
      model: 'gemini-3.6-flash',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects unknown extra keys (strict schema)', () => {
    const parsed = analyzerProviderConfigSchema.safeParse({ ...geminiProvider(), baseUrl: 'https://x' });
    expect(parsed.success).toBe(false);
  });

  it('builds a default provider with pricing from the model catalog', () => {
    const provider = defaultGeminiNativeProvider('gemini-flash-lite-latest');
    expect(provider.model).toBe('gemini-flash-lite-latest');
    expect(provider.pricePerMTokensInput).toBe(0.1);
    expect(geminiNativeModelIds()).toContain('gemini-3.6-flash');
    expect(geminiNativeModelPricing('does-not-exist')).toBeNull();
  });
});

describe('prompt', () => {
  it('requests the retrieval-grade markers and a timestamped transcript', () => {
    const prompt = buildGeminiPrompt({ videoName: 'clip.mp4', outputLanguage: 'auto' });
    expect(prompt).toContain('DESCRIPTION:');
    expect(prompt).toContain('FILENAME:');
    expect(prompt).toContain('TAGS:');
    expect(prompt).toContain('TRANSCRIPT:');
    expect(prompt).toContain('[MM:SS]');
    expect(prompt).toContain('clip.mp4');
  });

  it('adds an output-language instruction for non-auto languages', () => {
    const prompt = buildGeminiPrompt({ videoName: 'clip.mp4', outputLanguage: 'pl' });
    expect(prompt).toContain('Polish');
  });
});

describe('transcript segment mapping', () => {
  it('maps [MM:SS] lines into ordered segments with end = next start', () => {
    const transcript = parseGeminiTranscript('DESCRIPTION: x\nTRANSCRIPT:\n[00:00] hello\n[00:09] world\n[00:12] end');
    expect(transcript).not.toBeNull();
    expect(transcript?.segments).toEqual([
      { start: 0, end: 9, text: 'hello' },
      { start: 9, end: 12, text: 'world' },
      { start: 12, end: 13, text: 'end' },
    ]);
    expect(transcript?.text).toBe('hello\nworld\nend');
  });

  it('parses [HH:MM:SS] timestamps', () => {
    const transcript = parseGeminiTranscript('TRANSCRIPT:\n[01:00:05] deep in');
    expect(transcript?.segments[0]?.start).toBe(3605);
  });

  it('returns null when transcript is NONE', () => {
    expect(parseGeminiTranscript('TRANSCRIPT: NONE')).toBeNull();
    expect(parseGeminiTranscript('DESCRIPTION: only\nFILENAME: x')).toBeNull();
  });

  it('skips non-timestamped and empty lines but keeps valid segments', () => {
    const transcript = parseGeminiTranscript('TRANSCRIPT:\nprologue without timestamp\n[00:03]   \n[00:05] real line');
    expect(transcript?.segments).toEqual([{ start: 5, end: 6, text: 'real line' }]);
  });

  it('returns null when no line parses', () => {
    expect(parseGeminiTranscript('TRANSCRIPT:\njust prose\nmore prose')).toBeNull();
  });
});

describe('cost accounting', () => {
  it('bills thoughts tokens as output', () => {
    const accounting = geminiUsageAccounting(
      { promptTokens: 16433, candidatesTokens: 2178, thoughtsTokens: 2026 },
      { pricePerMTokensInput: 1.5, pricePerMTokensOutput: 7.5 },
    );
    expect(accounting.billedOutputTokens).toBe(4204);
    expect(accounting.totalTokens).toBe(20637);
    expect(accounting.estimatedCostUsd).toBeCloseTo((16433 * 1.5 + 4204 * 7.5) / 1_000_000, 8);
  });

  it('returns null cost when pricing is absent', () => {
    const accounting = geminiUsageAccounting({ promptTokens: 100, candidatesTokens: 10, thoughtsTokens: 0 }, {});
    expect(accounting.estimatedCostUsd).toBeNull();
  });

  it('prefers explicit provider pricing over the model catalog', () => {
    expect(geminiProviderPricing(geminiProvider({ pricePerMTokensInput: 9, pricePerMTokensOutput: 9 }))).toEqual({
      pricePerMTokensInput: 9,
      pricePerMTokensOutput: 9,
    });
    const noPrice = geminiProvider();
    delete noPrice.pricePerMTokensInput;
    delete noPrice.pricePerMTokensOutput;
    expect(geminiProviderPricing({ ...noPrice, model: 'gemini-3.6-flash' })).toEqual({
      pricePerMTokensInput: 1.5,
      pricePerMTokensOutput: 7.5,
    });
  });
});

describe('inline vs resumable decision', () => {
  it('uploads inline at or below 20 MB and resumable above', () => {
    expect(shouldUploadInline(20 * 1024 * 1024)).toBe(true);
    expect(shouldUploadInline(20 * 1024 * 1024 + 1)).toBe(false);
  });
});

describe('analyze — inline path', () => {
  it('sends inline_data and returns parsed usage + transcript without uploading', async () => {
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse({
        candidates: [{ content: { parts: [{ text: 'DESCRIPTION: a bin\nFILENAME: black-bin\nTAGS: bin, deck\nTRANSCRIPT: NONE' }] } }],
        usageMetadata: { promptTokenCount: 700, candidatesTokenCount: 100, thoughtsTokenCount: 20 },
      }));
    const adapter = new GeminiNativeAnalyzerAdapter({
      credentials: fakeCredentials('key'),
      fetchImpl,
      readVideo: () => Promise.resolve(smallVideo),
    });
    const result = await adapter.analyze(analyzeInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain(':generateContent');
    expect(result.value.usage?.billedOutputTokens).toBe(120);
    expect(result.value.transcript).toBeNull();
    expect(result.value.rawResponse).toContain('FILENAME: black-bin');
  });

  it('defaults usage tokens to zero when usageMetadata is absent', async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({ candidates: [{ content: { parts: [{ text: 'DESCRIPTION: x\nFILENAME: y\nTAGS: z' }] } }] }));
    const adapter = new GeminiNativeAnalyzerAdapter({
      credentials: fakeCredentials('key'),
      fetchImpl,
      readVideo: () => Promise.resolve(smallVideo),
    });
    const result = await adapter.analyze(analyzeInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.usage?.totalTokens).toBe(0);
    expect(result.value.usage?.estimatedCostUsd).toBe(0);
  });

  it('reports an unexpected response shape when candidates are missing entirely', async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse({ promptFeedback: { blockReason: 'SAFETY' } }));
    const adapter = new GeminiNativeAnalyzerAdapter({
      credentials: fakeCredentials('key'),
      fetchImpl,
      readVideo: () => Promise.resolve(smallVideo),
    });
    const result = await adapter.analyze(analyzeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('provider_error');
  });
});

describe('analyze — resumable upload state machine', () => {
  it('runs start -> finalize -> poll ACTIVE -> generate -> delete in order', async () => {
    const { fetchImpl, calls } = recordingFetch((call) => {
      if (call.url.endsWith('/upload/v1beta/files')) {
        return new Response(null, { status: 200, headers: { 'x-goog-upload-url': 'https://upload.example/session' } });
      }
      if (call.url === 'https://upload.example/session') {
        return jsonResponse({ file: { name: 'files/abc', uri: 'https://files/abc', state: 'PROCESSING' } });
      }
      if (call.method === 'GET' && call.url.endsWith('/v1beta/files/abc')) {
        return jsonResponse({ state: 'ACTIVE', uri: 'https://files/abc' });
      }
      if (call.url.includes(':generateContent')) {
        return jsonResponse({
          candidates: [{ content: { parts: [{ text: 'DESCRIPTION: boat\nFILENAME: wooden-boat\nTAGS: boat\nTRANSCRIPT:\n[00:00] czesc' }] } }],
          usageMetadata: { promptTokenCount: 1700, candidatesTokenCount: 800, thoughtsTokenCount: 0 },
        });
      }
      if (call.method === 'DELETE') return new Response(null, { status: 200 });
      throw new Error(`unexpected call ${call.method} ${call.url}`);
    });
    const adapter = new GeminiNativeAnalyzerAdapter({
      credentials: fakeCredentials('key'),
      fetchImpl,
      readVideo: () => Promise.resolve(largeVideo),
      sleep: () => Promise.resolve(),
    });
    const result = await adapter.analyze(analyzeInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sequence = calls.map((call) => {
      if (call.url.endsWith('/upload/v1beta/files')) return 'start';
      if (call.url === 'https://upload.example/session') return 'finalize';
      if (call.method === 'GET' && call.url.endsWith('/files/abc')) return 'poll';
      if (call.url.includes(':generateContent')) return 'generate';
      if (call.method === 'DELETE') return 'delete';
      return 'other';
    });
    expect(sequence).toEqual(['start', 'finalize', 'poll', 'generate', 'delete']);
    expect(result.value.transcript?.segments).toEqual([{ start: 0, end: 1, text: 'czesc' }]);
    expect(result.value.usage?.billedOutputTokens).toBe(800);
  });

  it('polls repeatedly until ACTIVE', async () => {
    let pollCount = 0;
    const { fetchImpl } = recordingFetch((call) => {
      if (call.url.endsWith('/upload/v1beta/files')) {
        return new Response(null, { status: 200, headers: { 'x-goog-upload-url': 'https://upload.example/s' } });
      }
      if (call.url === 'https://upload.example/s') return jsonResponse({ file: { name: 'files/p', state: 'PROCESSING' } });
      if (call.method === 'GET' && call.url.endsWith('/files/p')) {
        pollCount += 1;
        return pollCount < 3
          ? jsonResponse({ state: 'PROCESSING' })
          : jsonResponse({ state: 'ACTIVE', uri: 'https://files/p' });
      }
      if (call.url.includes(':generateContent')) {
        return jsonResponse({
          candidates: [{ content: { parts: [{ text: 'DESCRIPTION: x\nFILENAME: y\nTAGS: z' }] } }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, thoughtsTokenCount: 0 },
        });
      }
      return new Response(null, { status: 200 });
    });
    const adapter = new GeminiNativeAnalyzerAdapter({
      credentials: fakeCredentials('key'),
      fetchImpl,
      readVideo: () => Promise.resolve(largeVideo),
      sleep: () => Promise.resolve(),
    });
    const result = await adapter.analyze(analyzeInput());
    expect(result.ok).toBe(true);
    expect(pollCount).toBe(3);
  });

  it('deletes the uploaded file even when generateContent fails', async () => {
    let deleted = false;
    const { fetchImpl } = recordingFetch((call) => {
      if (call.url.endsWith('/upload/v1beta/files')) {
        return new Response(null, { status: 200, headers: { 'x-goog-upload-url': 'https://upload.example/s' } });
      }
      if (call.url === 'https://upload.example/s') return jsonResponse({ file: { name: 'files/d', state: 'PROCESSING' } });
      if (call.method === 'GET' && call.url.endsWith('/files/d')) return jsonResponse({ state: 'ACTIVE', uri: 'u' });
      if (call.url.includes(':generateContent')) return jsonResponse({ error: 'boom' }, { status: 500 });
      if (call.method === 'DELETE') { deleted = true; return new Response(null, { status: 200 }); }
      return new Response(null, { status: 200 });
    });
    const adapter = new GeminiNativeAnalyzerAdapter({
      credentials: fakeCredentials('key'),
      fetchImpl,
      readVideo: () => Promise.resolve(largeVideo),
      sleep: () => Promise.resolve(),
    });
    const result = await adapter.analyze(analyzeInput());
    expect(result.ok).toBe(false);
    expect(deleted).toBe(true);
  });
});

describe('analyze — guards', () => {
  it('rejects a non-gemini provider', async () => {
    const adapter = new GeminiNativeAnalyzerAdapter({ credentials: fakeCredentials('key') });
    const result = await adapter.analyze(analyzeInput({
      provider: { family: 'local', providerId: 'local', modelTag: 'gemma3:12b' },
    }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid_config_value');
  });

  it('fails when no API key is stored', async () => {
    const adapter = new GeminiNativeAnalyzerAdapter({ credentials: fakeCredentials(null) });
    const result = await adapter.analyze(analyzeInput());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('missing_api_key');
  });
});

describe('analyze — error branches', () => {
  const largeAdapter = (fetchImpl: typeof fetch): GeminiNativeAnalyzerAdapter =>
    new GeminiNativeAnalyzerAdapter({
      credentials: fakeCredentials('key'),
      fetchImpl,
      readVideo: () => Promise.resolve(largeVideo),
      sleep: () => Promise.resolve(),
      maxPollAttempts: 3,
    });

  const activeThen = (onGenerate: (call: FetchCall) => Response): typeof fetch =>
    recordingFetch((call) => {
      if (call.url.endsWith('/upload/v1beta/files')) {
        return new Response(null, { status: 200, headers: { 'x-goog-upload-url': 'https://up/s' } });
      }
      if (call.url === 'https://up/s') return jsonResponse({ file: { name: 'files/e', state: 'PROCESSING' } });
      if (call.method === 'GET' && call.url.endsWith('/files/e')) return jsonResponse({ state: 'ACTIVE', uri: 'u' });
      if (call.url.includes(':generateContent')) return onGenerate(call);
      return new Response(null, { status: 200 });
    }).fetchImpl;

  it('maps generateContent 401 to provider_auth_failed', async () => {
    const result = await largeAdapter(activeThen(() => new Response(null, { status: 401 }))).analyze(analyzeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('provider_auth_failed');
  });

  it('maps generateContent 429 to rate_limited', async () => {
    const result = await largeAdapter(activeThen(() => new Response(null, { status: 429, headers: { 'retry-after': '5' } })))
      .analyze(analyzeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('rate_limited');
  });

  it('reports an empty response when candidates have no text', async () => {
    const result = await largeAdapter(activeThen(() => jsonResponse({ candidates: [{ content: { parts: [] } }] })))
      .analyze(analyzeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('provider_error');
  });

  it('reports invalid JSON from generateContent', async () => {
    const result = await largeAdapter(activeThen(() => new Response('not json', { status: 200 }))).analyze(analyzeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('provider_error');
  });

  it('fails when the upload start returns no upload URL', async () => {
    const { fetchImpl } = recordingFetch((call) =>
      call.url.endsWith('/upload/v1beta/files') ? new Response(null, { status: 200 }) : new Response(null, { status: 200 }));
    const result = await largeAdapter(fetchImpl).analyze(analyzeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('upload URL');
  });

  it('maps an upload 403 to provider_auth_failed', async () => {
    const { fetchImpl } = recordingFetch(() => new Response(null, { status: 403 }));
    const result = await largeAdapter(fetchImpl).analyze(analyzeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('provider_auth_failed');
  });

  it('fails when the upload response omits a file name', async () => {
    const { fetchImpl } = recordingFetch((call) => {
      if (call.url.endsWith('/upload/v1beta/files')) {
        return new Response(null, { status: 200, headers: { 'x-goog-upload-url': 'https://up/s' } });
      }
      return jsonResponse({ file: {} });
    });
    const result = await largeAdapter(fetchImpl).analyze(analyzeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('file name');
  });

  it('fails when the file processing reports FAILED', async () => {
    const { fetchImpl } = recordingFetch((call) => {
      if (call.url.endsWith('/upload/v1beta/files')) {
        return new Response(null, { status: 200, headers: { 'x-goog-upload-url': 'https://up/s' } });
      }
      if (call.url === 'https://up/s') return jsonResponse({ file: { name: 'files/f', state: 'PROCESSING' } });
      if (call.method === 'GET') return jsonResponse({ state: 'FAILED' });
      return new Response(null, { status: 200 });
    });
    const result = await largeAdapter(fetchImpl).analyze(analyzeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('failed to process');
  });

  it('times out polling after the maximum attempts', async () => {
    const { fetchImpl } = recordingFetch((call) => {
      if (call.url.endsWith('/upload/v1beta/files')) {
        return new Response(null, { status: 200, headers: { 'x-goog-upload-url': 'https://up/s' } });
      }
      if (call.url === 'https://up/s') return jsonResponse({ file: { name: 'files/g', state: 'PROCESSING' } });
      return jsonResponse({ state: 'PROCESSING' });
    });
    const result = await largeAdapter(fetchImpl).analyze(analyzeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('ACTIVE');
  });

  it('reports read_error when the video cannot be read', async () => {
    const adapter = new GeminiNativeAnalyzerAdapter({
      credentials: fakeCredentials('key'),
      readVideo: () => Promise.reject(new Error('nope')),
    });
    const result = await adapter.analyze(analyzeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('read_error');
  });

  it('returns cancelled when a request throws with an aborted user signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetchImpl } = recordingFetch(() => { throw new Error('aborted'); });
    const adapter = new GeminiNativeAnalyzerAdapter({
      credentials: fakeCredentials('key'),
      fetchImpl,
      readVideo: () => Promise.resolve(smallVideo),
    });
    const result = await adapter.analyze(analyzeInput({ signal: controller.signal }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('processing_error');
  });

  it('returns provider_error when a request throws without an abort', async () => {
    const { fetchImpl } = recordingFetch(() => { throw new Error('network'); });
    const adapter = new GeminiNativeAnalyzerAdapter({
      credentials: fakeCredentials('key'),
      fetchImpl,
      readVideo: () => Promise.resolve(smallVideo),
    });
    const result = await adapter.analyze(analyzeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('provider_error');
  });
});

describe('provider selection plumbing (test + dependency)', () => {
  it('reports authenticated when the model endpoint is reachable', async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse({ name: 'models/gemini-3.6-flash' }));
    const adapter = new GeminiNativeAnalyzerAdapter({ credentials: fakeCredentials('key'), fetchImpl });
    const result = await adapter.test(geminiProvider());
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.family !== 'api') return;
    expect(result.value.authenticated).toBe(true);
  });

  it('reports unauthenticated on HTTP 403', async () => {
    const { fetchImpl } = recordingFetch(() => new Response(null, { status: 403 }));
    const adapter = new GeminiNativeAnalyzerAdapter({ credentials: fakeCredentials('key'), fetchImpl });
    const result = await adapter.test(geminiProvider());
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.family !== 'api') return;
    expect(result.value.authenticated).toBe(false);
  });

  it('dependency reports availability from stored credential', async () => {
    const adapter = new GeminiNativeAnalyzerAdapter({ credentials: fakeCredentials('key') });
    const available = await adapter.dependency({ backend: 'claude', provider: geminiProvider() });
    expect(available.ok && available.value.available).toBe(true);
    const missing = new GeminiNativeAnalyzerAdapter({ credentials: fakeCredentials(null) });
    const unavailable = await missing.dependency({ backend: 'claude', provider: geminiProvider() });
    expect(unavailable.ok && unavailable.value.available).toBe(false);
  });

  it('dependency without a gemini provider is unavailable', async () => {
    const adapter = new GeminiNativeAnalyzerAdapter({ credentials: fakeCredentials('key') });
    const result = await adapter.dependency();
    expect(result.ok && result.value.available).toBe(false);
    expect(result.ok && result.value.name).toBe('gemini-native');
  });

  it('rejects test() for a non-gemini config', async () => {
    const adapter = new GeminiNativeAnalyzerAdapter({ credentials: fakeCredentials('key') });
    const result = await adapter.test({ family: 'local', providerId: 'local', modelTag: 'gemma3:12b' });
    expect(result.ok).toBe(false);
  });

  it('test() reports not reachable when no key is stored', async () => {
    const adapter = new GeminiNativeAnalyzerAdapter({ credentials: fakeCredentials(null) });
    const result = await adapter.test(geminiProvider());
    expect(result.ok && result.value.family === 'api' && result.value.reachable).toBe(false);
  });

  it('test() reports not reachable on a network error', async () => {
    const { fetchImpl } = recordingFetch(() => { throw new Error('offline'); });
    const adapter = new GeminiNativeAnalyzerAdapter({ credentials: fakeCredentials('key'), fetchImpl });
    const result = await adapter.test(geminiProvider());
    expect(result.ok && result.value.family === 'api' && result.value.reachable).toBe(false);
  });

  it('test() treats 404 as authenticated but model unavailable', async () => {
    const { fetchImpl } = recordingFetch(() => new Response(null, { status: 404 }));
    const adapter = new GeminiNativeAnalyzerAdapter({ credentials: fakeCredentials('key'), fetchImpl });
    const result = await adapter.test(geminiProvider());
    expect(result.ok && result.value.family === 'api' && result.value.authenticated).toBe(true);
    expect(result.ok && result.value.family === 'api' && result.value.message.includes('not available')).toBe(true);
  });

  it('test() reports an unexpected HTTP status', async () => {
    const { fetchImpl } = recordingFetch(() => new Response(null, { status: 503 }));
    const adapter = new GeminiNativeAnalyzerAdapter({ credentials: fakeCredentials('key'), fetchImpl });
    const result = await adapter.test(geminiProvider());
    expect(result.ok && result.value.family === 'api' && result.value.authenticated).toBe(false);
  });
});
