import { z } from 'zod';

export const GLOBAL_CATALOG_SCHEMA_VERSION = 7;

export const folderMarkerSchema = z.object({
  folderId: z.string().uuid(),
  schemaVersion: z.number().int().positive(),
  createdAt: z.string().datetime(),
});

export type FolderMarker = z.output<typeof folderMarkerSchema>;

export const catalogFolderSchema = z.object({
  folderId: z.string().uuid(),
  currentPath: z.string().min(1),
  displayName: z.string(),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
});

export type CatalogFolder = z.output<typeof catalogFolderSchema>;

export const catalogFileSchema = z.object({
  fingerprint: z.string().min(1),
  folderId: z.string().uuid(),
  fileName: z.string().min(1),
  size: z.number().int().nonnegative(),
  durationS: z.number().nonnegative().nullable(),
  gpsLat: z.number().min(-90).max(90).nullable().default(null),
  gpsLon: z.number().min(-180).max(180).nullable().default(null),
  processedAt: z.string().datetime(),
  analyzer: z.string().nullable(),
  model: z.string().nullable(),
  missingAt: z.number().int().nonnegative().nullable().default(null),
});

export type CatalogFile = z.output<typeof catalogFileSchema>;

export const catalogAnalysisSchema = z.object({
  fingerprint: z.string().min(1),
  finalName: z.string().nullable(),
  description: z.string().nullable(),
  transcript: z.string().nullable(),
  language: z.string().nullable(),
  tags: z.array(z.string()).default([]),
});

export type CatalogAnalysis = z.output<typeof catalogAnalysisSchema>;

export const catalogRecordSchema = z.object({
  file: catalogFileSchema,
  analysis: catalogAnalysisSchema.nullable(),
});

export type CatalogRecord = z.output<typeof catalogRecordSchema>;

export const snapshotHeaderLineSchema = z.object({
  type: z.literal('header'),
  version: z.number().int().positive(),
  folder: catalogFolderSchema,
  exportedAt: z.string().datetime(),
});

export const snapshotRecordLineSchema = z.object({
  type: z.literal('record'),
  file: catalogFileSchema,
  analysis: catalogAnalysisSchema.nullable(),
});

export const snapshotLineSchema = z.discriminatedUnion('type', [
  snapshotHeaderLineSchema,
  snapshotRecordLineSchema,
]);

export type SnapshotHeaderLine = z.output<typeof snapshotHeaderLineSchema>;
export type SnapshotRecordLine = z.output<typeof snapshotRecordLineSchema>;

export const newerWins = (existingProcessedAt: string, incomingProcessedAt: string): boolean =>
  Date.parse(incomingProcessedAt) > Date.parse(existingProcessedAt);

export const normalizeTagName = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/g, '');

export const normalizeTagList = (values: readonly string[]): string[] => {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const tag = normalizeTagName(value);
    if (tag.length === 0 || seen.has(tag)) continue;
    seen.add(tag);
    normalized.push(tag);
    if (normalized.length === 12) break;
  }
  return normalized;
};
