import { z } from 'zod';

import { LANGUAGE_DISPLAY_NAMES, resolvePromptLanguage, type UiLanguage } from './config.js';
import { appError, type AppError } from './errors.js';
import type { PhotoConfigDescriptor } from './photo-config-descriptor.js';
import { ok, type Result } from './result.js';

export const PHOTO_ANALYSIS_PROMPT_VERSION = 1;

export const PHOTO_SCENES = [
  'people', 'landscape', 'urban', 'indoor', 'food',
  'document', 'screenshot', 'animal', 'vehicle', 'event', 'object', 'other',
] as const;

export const PHOTO_QUALITIES = ['good', 'blurry', 'dark', 'overexposed', 'other'] as const;

const coerceToUnion = <const T extends readonly string[]>(values: T, fallback: T[number]) =>
  z.string().transform((value): T[number] => {
    const normalized = value.trim().toLowerCase();
    const match = values.find((candidate) => candidate === normalized);
    return match ?? fallback;
  });

export const photoAnalysisElementSchema = z.object({
  index: z.number().int().min(1),
  description: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)).min(1).max(12),
  scene: coerceToUnion(PHOTO_SCENES, 'other'),
  quality: coerceToUnion(PHOTO_QUALITIES, 'other'),
});

export type PhotoAnalysisElement = z.output<typeof photoAnalysisElementSchema>;

export type PhotoFrameMode = 'attached-images' | 'file-url' | 'dir-access';

const photoLanguageInstruction = (input: {
  outputLanguage: string;
  tagLanguage: string;
  uiLanguage?: UiLanguage | undefined;
}): string => {
  const displayName = (language: string): string => LANGUAGE_DISPLAY_NAMES[language] ?? language;
  const outputLanguage = resolvePromptLanguage(input.outputLanguage, input.uiLanguage);
  const tagLanguage = resolvePromptLanguage(input.tagLanguage, input.uiLanguage);
  const description = `Write every DESCRIPTION in ${displayName(outputLanguage)}.`;
  const tags = `Write every TAG in ${displayName(tagLanguage)}, whatever language is spoken in the photo's context. Keep tags in ASCII kebab-case: transliterate diacritics (ą→a, ć→c, ę→e, ł→l, ń→n, ó→o, ś→s, ź→z, ż→z) and use only a-z, 0-9 and hyphens.`;
  return `\n\n${description} ${tags}`;
};

export const buildPhotoAnalyzerPrompt = (input: {
  items: readonly { index: number; fileName: string; proxyPath: string }[];
  frameMode: PhotoFrameMode;
  outputLanguage: string;
  tagLanguage: string;
  uiLanguage?: UiLanguage | undefined;
}): string => {
  const listing = input.frameMode === 'attached-images'
    ? input.items.map((item) => `${String(item.index)}. ${item.fileName}`).join('\n')
    : input.frameMode === 'file-url'
      ? input.items.map((item) => `${String(item.index)}. file://${item.proxyPath}`).join('\n')
      : input.items.map((item) => `${String(item.index)}. ${item.proxyPath}`).join('\n');
  const accessBlock = input.frameMode === 'attached-images'
    ? `Attached are ${String(input.items.length)} photo(s), numbered as follows:\n${listing}\n\n`
    : input.frameMode === 'file-url'
      ? `Here are ${String(input.items.length)} photo(s), numbered as follows:\n${listing}\n\n`
      : `Read these ${String(input.items.length)} photo file(s) from the accessible workspace, numbered as follows:\n${listing}\n\n`;
  return `You are analyzing a batch of ${String(input.items.length)} photos.\n\n${accessBlock}`
    + 'For each photo, in the same order, write one JSON object with these keys: '
    + '"index" (the number above), "description" (at most 2 sentences on what the photo actually shows), '
    + '"tags" (3-8 short kebab-case tags), "scene" (one of '
    + `${PHOTO_SCENES.join(', ')}), "quality" (one of ${PHOTO_QUALITIES.join(', ')}).\n\n`
    + 'Respond with exactly one JSON array containing one object per photo, nothing before or after it.'
    + photoLanguageInstruction({
      outputLanguage: input.outputLanguage,
      tagLanguage: input.tagLanguage,
      uiLanguage: input.uiLanguage,
    });
};

export const DEFAULT_PHOTO_BATCH_SIZE = 12;

export const PHOTO_BATCH_CLAMPS = {
  api: 12,
  harness: 12,
  local: 4,
  'gemini-native': 12,
  imported: 1,
} as const satisfies Record<PhotoConfigDescriptor['family'], number>;

export const clampPhotoBatchSize = (
  family: PhotoConfigDescriptor['family'],
  requested: number | null,
): number => Math.max(1, Math.min(requested ?? DEFAULT_PHOTO_BATCH_SIZE, PHOTO_BATCH_CLAMPS[family]));

export const parsePhotoBatchResponse = (
  raw: string,
  expectedCount: number,
): Result<PhotoAnalysisElement[], AppError> => {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    return { ok: false, error: appError('processing_error', 'Photo batch response did not contain a JSON array') };
  }
  const slice = raw.slice(start, end + 1);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(slice);
  } catch {
    return { ok: false, error: appError('processing_error', 'Photo batch response was not valid JSON') };
  }
  const parsed = photoAnalysisElementSchema.array().safeParse(parsedJson);
  if (!parsed.success) {
    return { ok: false, error: appError('processing_error', 'Photo batch response did not match the expected element shape') };
  }
  if (parsed.data.length !== expectedCount) {
    return {
      ok: false,
      error: appError('processing_error', `Photo batch response returned ${String(parsed.data.length)} elements, expected ${String(expectedCount)}`),
    };
  }
  const seenIndexes = new Set<number>();
  for (const element of parsed.data) {
    if (element.index < 1 || element.index > expectedCount) {
      return { ok: false, error: appError('processing_error', `Photo batch response index ${String(element.index)} is out of range`) };
    }
    if (seenIndexes.has(element.index)) {
      return { ok: false, error: appError('processing_error', `Photo batch response index ${String(element.index)} is duplicated`) };
    }
    seenIndexes.add(element.index);
  }
  return ok(parsed.data);
};

export const splitPhotoBatch = <T>(items: readonly T[]): [T[], T[]] | null => {
  if (items.length <= 1) return null;
  const mid = Math.ceil(items.length / 2);
  return [items.slice(0, mid), items.slice(mid)];
};
