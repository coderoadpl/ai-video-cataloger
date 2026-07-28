import { z } from 'zod';

import {
  appError,
  geminiUsageAccounting,
  ok,
  type AppError,
  type GeminiUsageAccounting,
  type GeminiPricingMode,
  type Result,
} from '@core/domain/index.js';
import type { AnalysisOutput, AnalyzerTranscript, AnalyzerTranscriptSegment } from '@core/server/index.js';

export const generateContentResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(z.object({ text: z.string().optional() })).optional() }).optional(),
      }),
    )
    .optional(),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
      thoughtsTokenCount: z.number().optional(),
    })
    .optional(),
});

export type GeminiGenerateContentResponse = z.output<typeof generateContentResponseSchema>;

const timestampToSeconds = (raw: string): number | null => {
  const parts = raw.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return minutes === undefined || seconds === undefined ? null : minutes * 60 + seconds;
  }
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return hours === undefined || minutes === undefined || seconds === undefined
      ? null
      : hours * 3600 + minutes * 60 + seconds;
  }
  return null;
};

const transcriptLinePattern = /^\[(\d{1,2}(?::\d{2}){1,2})\]\s*(.*)$/;

export const parseGeminiTranscript = (rawResponse: string): AnalyzerTranscript | null => {
  const marker = rawResponse.search(/^\s*TRANSCRIPT:/im);
  if (marker < 0) return null;
  const afterMarker = rawResponse.slice(marker).replace(/^\s*TRANSCRIPT:/i, '');
  const lines = afterMarker.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0 || lines[0]?.toUpperCase() === 'NONE') return null;
  const parsed: { start: number; text: string }[] = [];
  for (const line of lines) {
    const match = transcriptLinePattern.exec(line);
    if (match === null) continue;
    const start = timestampToSeconds(match[1] ?? '');
    const text = (match[2] ?? '').trim();
    if (start === null || text.length === 0) continue;
    parsed.push({ start, text });
  }
  if (parsed.length === 0) return null;
  const segments: AnalyzerTranscriptSegment[] = parsed.map((segment, index) => {
    const next = parsed[index + 1];
    const end = next !== undefined && next.start > segment.start ? next.start : segment.start + 1;
    return { start: segment.start, end, text: segment.text };
  });
  return { text: segments.map((segment) => segment.text).join('\n'), segments };
};

export const analysisFromGenerateContent = (
  body: unknown,
  model: string,
  pricingMode: GeminiPricingMode = 'interactive',
): Result<AnalysisOutput, AppError> => {
  const parsed = generateContentResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: appError('provider_error', 'Gemini API returned an unexpected response shape') };
  }
  const text = (parsed.data.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('')
    .trim();
  if (text.length === 0) {
    return { ok: false, error: appError('provider_error', 'Gemini API returned an empty response') };
  }
  const usage: GeminiUsageAccounting = geminiUsageAccounting(
    {
      promptTokens: parsed.data.usageMetadata?.promptTokenCount ?? 0,
      candidatesTokens: parsed.data.usageMetadata?.candidatesTokenCount ?? 0,
      thoughtsTokens: parsed.data.usageMetadata?.thoughtsTokenCount ?? 0,
    },
    model,
    pricingMode,
  );
  return ok({ rawResponse: text, usage, transcript: parseGeminiTranscript(text) });
};
