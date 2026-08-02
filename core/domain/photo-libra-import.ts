import { z } from 'zod';

import { FACE_EMBEDDING_DIM } from './faces.js';
import type { PHOTO_QUALITIES, PHOTO_SCENES } from './photo-analysis.js';
import { canonicalPath } from './paths.js';
import { type TimelineIntervalKind, TIMELINE_INTERVAL_KINDS } from './global-catalog.js';

export const libraManifestEntrySchema = z.object({
  path: z.string().trim().min(1),
  size: z.number().int().nonnegative(),
  mtime: z.number().nonnegative(),
  md5: z.string().regex(/^[0-9a-f]{32}$/),
});
export type LibraManifestEntry = z.output<typeof libraManifestEntrySchema>;

export const libraDescriptionEntrySchema = z.object({
  md5: z.string().regex(/^[0-9a-f]{32}$/),
  descPl: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)),
  scene: z.string().trim().min(1),
  quality: z.string().trim().min(1),
});
export type LibraDescriptionEntry = z.output<typeof libraDescriptionEntrySchema>;

export const libraFaceBboxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});

export const libraFaceEntrySchema = z.object({
  md5: z.string().regex(/^[0-9a-f]{32}$/),
  obsId: z.string().min(1).nullable(),
  bbox: libraFaceBboxSchema.optional(),
  score: z.number().optional(),
  embedding: z.array(z.number()).length(FACE_EMBEDDING_DIM).optional(),
});
export type LibraFaceEntry = z.output<typeof libraFaceEntrySchema>;

export const libraGeoEntrySchema = z.object({
  path: z.string().trim().min(1),
  lat: z.number().min(-90).max(90).nullable(),
  lon: z.number().min(-180).max(180).nullable(),
  placeId: z.string().nullable().optional(),
  semanticType: z.string().nullable().optional(),
  source: z.string().nullable(),
  confidence: z.string().nullable().optional(),
});
export type LibraGeoEntry = z.output<typeof libraGeoEntrySchema>;

export interface ParsedNdjson<T> {
  values: T[];
  invalidLines: number;
  totalLines: number;
}

export const parseLibraNdjson = <T>(text: string, schema: z.ZodType<T>): ParsedNdjson<T> => {
  const values: T[] = [];
  let invalidLines = 0;
  let totalLines = 0;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    totalLines += 1;
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(line);
    } catch {
      invalidLines += 1;
      continue;
    }
    const parsed = schema.safeParse(parsedJson);
    if (!parsed.success) {
      invalidLines += 1;
      continue;
    }
    values.push(parsed.data);
  }
  return { values, invalidLines, totalLines };
};

export const normalizeLibraPath = (value: string): string => canonicalPath(value.replace(/^\/+/, ''));

const LIBRA_FACE_OBS_ID_PATTERN = /:face:([1-9][0-9]*)$/;

export const translateLibraFaceObsId = (fingerprint: string, libraObsId: string): string | null => {
  const match = LIBRA_FACE_OBS_ID_PATTERN.exec(libraObsId);
  if (match === null) return null;
  const detectionIndex = match[1];
  if (detectionIndex === undefined) return null;
  return `${fingerprint}:face:1:${detectionIndex}`;
};

const LIBRA_SCENE_MAP: Record<string, (typeof PHOTO_SCENES)[number]> = {
  portrait: 'people',
  group: 'people',
  landscape: 'landscape',
  event: 'event',
  animal: 'animal',
  detail: 'object',
  city: 'urban',
  interior: 'indoor',
  other: 'other',
  food: 'food',
  document: 'document',
};

export const mapLibraScene = (scene: string): (typeof PHOTO_SCENES)[number] =>
  LIBRA_SCENE_MAP[scene.trim().toLowerCase()] ?? 'other';

const LIBRA_QUALITY_MAP: Record<string, (typeof PHOTO_QUALITIES)[number]> = {
  ok: 'good',
  blurry: 'blurry',
  dark: 'dark',
  junk: 'other',
};

export const mapLibraQuality = (quality: string): (typeof PHOTO_QUALITIES)[number] =>
  LIBRA_QUALITY_MAP[quality.trim().toLowerCase()] ?? 'other';

const LIBRA_GEO_TIMELINE_SOURCES: ReadonlyMap<string, TimelineIntervalKind> = new Map(
  TIMELINE_INTERVAL_KINDS.map((kind) => [kind, kind]),
);

export const mapLibraGeoIntervalKind = (source: string | null): TimelineIntervalKind | null =>
  source === null ? null : LIBRA_GEO_TIMELINE_SOURCES.get(source) ?? null;

const LIBRA_CONFIDENCE_ACCURACY_M: Record<string, number> = {
  high: 50,
  medium: 150,
  low: 500,
};

export const accuracyMForLibraConfidence = (confidence: string | null | undefined): number | null =>
  confidence === null || confidence === undefined ? null : LIBRA_CONFIDENCE_ACCURACY_M[confidence.trim().toLowerCase()] ?? null;
