import { z } from 'zod';

import { appError, ok, type AppError, type Result } from '@core/domain/index.js';
import type { AnalyzerBatchJobState, AnalyzerBatchResult } from '@core/server/index.js';

import { analysisFromGenerateContent, type GeminiTokenPricing } from './response.js';

export const BATCH_INLINE_REQUEST_LIMIT_BYTES = 18 * 1024 * 1024;

export interface GeminiBatchRequestPayload {
  key: string;
  fileUri: string;
  prompt: string;
}

export const buildBatchSubmitBody = (
  displayName: string,
  requests: readonly GeminiBatchRequestPayload[],
): string =>
  JSON.stringify({
    batch: {
      display_name: displayName,
      input_config: {
        requests: {
          requests: requests.map((request) => ({
            request: {
              contents: [
                {
                  parts: [
                    { file_data: { mime_type: 'video/mp4', file_uri: request.fileUri } },
                    { text: request.prompt },
                  ],
                },
              ],
            },
            metadata: { key: request.key },
          })),
        },
      },
    },
  });

const statusErrorSchema = z.object({
  code: z.number().optional(),
  message: z.string().optional(),
  status: z.string().optional(),
});

const inlinedResponseSchema = z.object({
  response: z.unknown().optional(),
  error: statusErrorSchema.optional(),
  metadata: z.object({ key: z.string().optional() }).optional(),
});

const inlinedResponsesSchema = z.union([
  z.array(inlinedResponseSchema),
  z.object({ inlinedResponses: z.array(inlinedResponseSchema).optional() }),
]);

const batchOperationSchema = z.object({
  name: z.string().optional(),
  done: z.boolean().optional(),
  state: z.string().optional(),
  metadata: z
    .object({ state: z.string().optional(), displayName: z.string().optional() })
    .optional(),
  response: z
    .object({
      inlinedResponses: inlinedResponsesSchema.optional(),
      responsesFile: z.string().optional(),
    })
    .optional(),
  error: statusErrorSchema.optional(),
});

const batchListSchema = z.object({
  operations: z.array(batchOperationSchema).optional(),
  batches: z.array(batchOperationSchema).optional(),
});

export type GeminiBatchOperation = z.output<typeof batchOperationSchema>;

export const parseBatchOperation = (body: unknown): Result<GeminiBatchOperation, AppError> => {
  const parsed = batchOperationSchema.safeParse(body);
  return parsed.success
    ? ok(parsed.data)
    : { ok: false, error: appError('provider_error', 'Gemini batch API returned an unexpected response shape') };
};

export const batchJobNameForDisplayName = (body: unknown, displayName: string): string | null => {
  const parsed = batchListSchema.safeParse(body);
  if (!parsed.success) return null;
  const operations = [...(parsed.data.operations ?? []), ...(parsed.data.batches ?? [])];
  const match = operations.find((operation) => operation.metadata?.displayName === displayName);
  return match?.name ?? null;
};

export const batchJobState = (operation: GeminiBatchOperation): AnalyzerBatchJobState => {
  const raw = operation.metadata?.state ?? operation.state ?? '';
  const suffix = raw.slice(raw.lastIndexOf('STATE_') + 'STATE_'.length).toUpperCase();
  if (suffix === 'SUCCEEDED') return 'succeeded';
  if (suffix === 'FAILED') return 'failed';
  if (suffix === 'CANCELLED' || suffix === 'CANCELED') return 'cancelled';
  if (suffix === 'EXPIRED') return 'expired';
  if (suffix === 'RUNNING') return 'running';
  if (suffix.length === 0 && operation.done === true) return 'succeeded';
  return 'pending';
};

export const batchJobMessage = (operation: GeminiBatchOperation): string | null =>
  operation.error?.message ?? null;

const inlinedResponseList = (operation: GeminiBatchOperation): z.output<typeof inlinedResponseSchema>[] => {
  const inlined = operation.response?.inlinedResponses;
  if (inlined === undefined) return [];
  return Array.isArray(inlined) ? inlined : inlined.inlinedResponses ?? [];
};

const requestErrorFor = (error: z.output<typeof statusErrorSchema>): AppError => {
  const message = error.message ?? 'Gemini batch request failed';
  if (error.code === 401 || error.code === 403) return appError('provider_auth_failed', message);
  if (error.code === 429) return appError('rate_limited', message);
  return appError('provider_error', message);
};

// The API is documented to answer in request order but has been observed to drop the
// metadata key it was given, so order is the fallback identity, never the primary one.
export const batchResults = (
  operation: GeminiBatchOperation,
  requestKeys: readonly string[],
  pricing: GeminiTokenPricing,
): AnalyzerBatchResult[] => {
  const inlined = inlinedResponseList(operation);
  const results: AnalyzerBatchResult[] = [];
  const answered = new Set<string>();
  inlined.forEach((entry, index) => {
    const key = entry.metadata?.key ?? requestKeys[index];
    if (key === undefined) return;
    answered.add(key);
    if (entry.error !== undefined) {
      results.push({ key, outcome: { ok: false, error: requestErrorFor(entry.error) } });
      return;
    }
    results.push({ key, outcome: analysisFromGenerateContent(entry.response, pricing) });
  });
  for (const key of requestKeys) {
    if (answered.has(key)) continue;
    results.push({
      key,
      outcome: {
        ok: false,
        error: appError('provider_error', 'Gemini batch job returned no response for this file'),
      },
    });
  }
  const order = new Map(requestKeys.map((key, index) => [key, index]));
  return results.sort((left, right) => (order.get(left.key) ?? 0) - (order.get(right.key) ?? 0));
};

export const inlineRequestTooLargeError = (bytes: number, requestCount: number): AppError =>
  appError(
    'provider_error',
    `The batch request set for ${requestCount} files is ${(bytes / 1024 / 1024).toFixed(1)} MB, over the `
    + `${BATCH_INLINE_REQUEST_LIMIT_BYTES / 1024 / 1024} MB the Gemini Batch API accepts inline. `
    + 'Process a smaller root, or run without batch mode.',
  );
