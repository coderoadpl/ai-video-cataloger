/**
 * Minimal HTTP client for the Ollama API (system or managed runtime).
 * Plain fetch, no SDK. All failures map to CodedError codes:
 *   OLLAMA_UNAVAILABLE  - runtime not reachable / server error
 *   MODEL_NOT_INSTALLED - the requested model is not present locally
 */

import { CodedError } from './json-output.js';

export interface OllamaModelInfo {
  name: string;
  sizeBytes: number;
}

export interface PullProgress {
  /** 0-100 when total size is known for the current layer, otherwise null. */
  percent: number | null;
  status: string;
}

function unavailable(baseUrl: string, cause: unknown): CodedError {
  const message = cause instanceof Error ? cause.message : String(cause);
  return new CodedError(
    `Local AI runtime not reachable at ${baseUrl}: ${message}`,
    'OLLAMA_UNAVAILABLE'
  );
}

async function requestJson(
  baseUrl: string,
  path: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = 10_000, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...rest,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw unavailable(baseUrl, error);
  }
  return response;
}

/** List locally installed models. */
export async function listModels(baseUrl: string): Promise<OllamaModelInfo[]> {
  const response = await requestJson(baseUrl, '/api/tags');
  if (!response.ok) {
    throw unavailable(baseUrl, new Error(`HTTP ${response.status}`));
  }
  const body = (await response.json()) as { models?: Array<{ name: string; size: number }> };
  return (body.models ?? []).map((m) => ({ name: m.name, sizeBytes: m.size }));
}

/** True when `tag` (or tag:latest) is installed. */
export async function isModelInstalled(baseUrl: string, tag: string): Promise<boolean> {
  const models = await listModels(baseUrl);
  return models.some((m) => m.name === tag || m.name === `${tag}:latest`);
}

/** Pull a model with streamed progress (resumable on the Ollama side). */
export async function pullModel(
  baseUrl: string,
  tag: string,
  onProgress?: (progress: PullProgress) => void
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: tag, stream: true }),
    });
  } catch (error) {
    throw unavailable(baseUrl, error);
  }
  if (!response.ok || !response.body) {
    throw unavailable(baseUrl, new Error(`HTTP ${response.status}`));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, newlineIndex).trim();
      buffered = buffered.slice(newlineIndex + 1);
      if (!line) continue;

      let event: { status?: string; error?: string; total?: number; completed?: number };
      try {
        event = JSON.parse(line) as typeof event;
      } catch {
        continue; // partial/garbage line
      }
      if (event.error) {
        const code = /not found|file does not exist/i.test(event.error)
          ? 'MODEL_NOT_INSTALLED'
          : 'OLLAMA_UNAVAILABLE';
        throw new CodedError(`Model pull failed: ${event.error}`, code);
      }
      const percent =
        typeof event.total === 'number' && event.total > 0 && typeof event.completed === 'number'
          ? Math.min(100, Math.round((event.completed / event.total) * 100))
          : null;
      onProgress?.({ percent, status: event.status ?? '' });
    }
  }
}

/** Delete a locally installed model. */
export async function deleteModel(baseUrl: string, tag: string): Promise<void> {
  const response = await requestJson(baseUrl, '/api/delete', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: tag }),
  });
  if (response.status === 404) {
    throw new CodedError(`Model not installed: ${tag}`, 'MODEL_NOT_INSTALLED');
  }
  if (!response.ok) {
    throw unavailable(baseUrl, new Error(`HTTP ${response.status}`));
  }
}

export interface ChatVisionRequest {
  model: string;
  prompt: string;
  imagesBase64: string[];
  timeoutMs: number;
}

/** Single-shot multimodal chat (frames as base64 images). */
export async function chatVision(baseUrl: string, request: ChatVisionRequest): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        stream: false,
        // Keep the model warm between batch items
        keep_alive: '10m',
        options: { temperature: 0.2 },
        messages: [
          { role: 'user', content: request.prompt, images: request.imagesBase64 },
        ],
      }),
      signal: AbortSignal.timeout(request.timeoutMs),
    });
  } catch (error) {
    // Surface timeouts the same way the claude provider does (execa's timedOut)
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw Object.assign(new Error(`Local analysis timed out`), { timedOut: true });
    }
    throw unavailable(baseUrl, error);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (/not found/i.test(text)) {
      throw new CodedError(
        `Model not installed: ${request.model}. Run: ai-video-cataloger models pull ${request.model}`,
        'MODEL_NOT_INSTALLED'
      );
    }
    throw unavailable(baseUrl, new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`));
  }

  const body = (await response.json()) as { message?: { content?: string } };
  const content = body.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    throw new CodedError('Local AI returned an empty response', 'OLLAMA_UNAVAILABLE');
  }
  return content;
}
