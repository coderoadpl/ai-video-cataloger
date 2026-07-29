import { z } from 'zod';

import { configDescriptorSchema, configId } from './config-descriptor.js';
import { appError, type AppError } from './errors.js';
import { canonicalPath } from './paths.js';

export const GLOBAL_CATALOG_SCHEMA_VERSION = 10;
export const CATALOG_SNAPSHOT_SCHEMA_VERSION = 11;

const DERIVED_FOLDER_ID_PATTERN = /^path-[0-9a-f]{8}$/;

export const folderIdSchema = z.union([
  z.string().uuid(),
  z.string().regex(DERIVED_FOLDER_ID_PATTERN),
]);

export const derivedFolderId = (folder: string): string => {
  const canonical = canonicalPath(folder);
  let hash = 2_166_136_261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash = Math.imul(hash ^ canonical.charCodeAt(index), 16_777_619);
  }
  return `path-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

export const folderMarkerSchema = z.object({
  folderId: folderIdSchema,
  schemaVersion: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});

export type FolderMarker = z.output<typeof folderMarkerSchema>;

export const catalogFolderSchema = z.object({
  folderId: folderIdSchema,
  currentPath: z.string().min(1),
  displayName: z.string(),
  firstSeenAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
});

export type CatalogFolder = z.output<typeof catalogFolderSchema>;

export const GPS_SOURCES = ['camera', 'timeline', 'manual'] as const;
export const gpsSourceSchema = z.enum(GPS_SOURCES);
export type GpsSource = z.output<typeof gpsSourceSchema>;

export const TIMELINE_INTERVAL_KINDS = ['visit', 'activity', 'path'] as const;
export const timelineIntervalKindSchema = z.enum(TIMELINE_INTERVAL_KINDS);
export type TimelineIntervalKind = z.output<typeof timelineIntervalKindSchema>;

export const catalogPlaceSchema = z.object({
  name: z.string().min(1),
  region: z.string().nullable(),
  country: z.string().nullable(),
  countryCode: z.string().length(2).nullable(),
  distanceM: z.number().nonnegative(),
  dataset: z.string().min(1),
});
export type CatalogPlace = z.output<typeof catalogPlaceSchema>;

export const catalogFileSchema = z.object({
  fingerprint: z.string().min(1),
  folderId: folderIdSchema,
  fileName: z.string().min(1),
  size: z.number().int().nonnegative(),
  durationS: z.number().nonnegative().nullable(),
  gpsLat: z.number().min(-90).max(90).nullable().default(null),
  gpsLon: z.number().min(-180).max(180).nullable().default(null),
  processedAt: z.iso.datetime(),
  analyzer: z.string().nullable(),
  model: z.string().nullable(),
  missingAt: z.number().int().nonnegative().nullable().default(null),
  capturedAt: z.iso.datetime().nullable().default(null),
  capturedAtSource: z.enum(['container', 'manual']).nullable().default(null),
  gpsSource: gpsSourceSchema.nullable().default(null),
  gpsAccuracyM: z.number().nonnegative().nullable().default(null),
  gpsIntervalKind: timelineIntervalKindSchema.nullable().default(null),
  gpsResolvedAt: z.iso.datetime().nullable().default(null),
  place: catalogPlaceSchema.nullable().default(null),
});

export type CatalogFile = z.output<typeof catalogFileSchema>;

const GPS_SOURCE_RANK: Record<GpsSource, number> = { timeline: 1, camera: 2, manual: 3 };

export interface GpsWriteCandidate {
  lat: number | null;
  lon: number | null;
  source: GpsSource;
}

export const acceptsGpsWrite = (
  existing: { lat: number | null; lon: number | null; source: GpsSource | null },
  incoming: GpsWriteCandidate,
): boolean => {
  if (incoming.lat === null || incoming.lon === null) return false;
  if (existing.lat === null || existing.lon === null) return true;
  const existingRank = GPS_SOURCE_RANK[existing.source ?? 'camera'];
  return GPS_SOURCE_RANK[incoming.source] >= existingRank;
};

export const catalogAnalysisSchema = z.object({
  fingerprint: z.string().min(1),
  finalName: z.string().nullable(),
  description: z.string().nullable(),
  transcript: z.string().nullable(),
  language: z.string().nullable(),
  tags: z.array(z.string()).default([]),
});

export type CatalogAnalysis = z.output<typeof catalogAnalysisSchema>;

export const catalogVariantSchema = catalogAnalysisSchema.extend({
  configId: z.string().min(1),
  descriptor: configDescriptorSchema.nullable(),
  analyzer: z.string().nullable(),
  model: z.string().nullable(),
  createdAt: z.iso.datetime(),
  usage: z.record(z.string(), z.json()).nullable(),
});

export type CatalogVariant = z.output<typeof catalogVariantSchema>;

export const catalogRecordSchema = z.object({
  file: catalogFileSchema,
  analysis: catalogAnalysisSchema.nullable(),
});

export type CatalogRecord = z.output<typeof catalogRecordSchema>;

export const snapshotHeaderLineSchema = z.object({
  type: z.literal('header'),
  version: z.number().int().positive(),
  folder: catalogFolderSchema,
  exportedAt: z.iso.datetime(),
});

export const legacySnapshotRecordLineSchema = z.object({
  type: z.literal('record'),
  file: catalogFileSchema,
  analysis: catalogAnalysisSchema.nullable(),
});

export const snapshotRecordLineSchema = z.object({
  type: z.literal('record'),
  file: catalogFileSchema,
  analyses: z.array(catalogVariantSchema),
  selectedConfigId: z.string().min(1).nullable(),
});

export const snapshotLineSchema = z.union([
  snapshotHeaderLineSchema,
  legacySnapshotRecordLineSchema,
  snapshotRecordLineSchema,
]);

export type SnapshotHeaderLine = z.output<typeof snapshotHeaderLineSchema>;
export type SnapshotRecordLine = z.output<typeof snapshotRecordLineSchema>;
export type LegacySnapshotRecordLine = z.output<typeof legacySnapshotRecordLineSchema>;

export const driveRunBatchRequestSchema = z.object({
  key: z.string().min(1),
  videoPath: z.string().min(1),
  fileName: z.string().min(1),
  fileUri: z.string().min(1),
});

export type DriveRunBatchRequest = z.output<typeof driveRunBatchRequestSchema>;

const processConfigIdentitySchema = z.object({
  descriptor: configDescriptorSchema,
  configId: z.string().regex(/^cfg_[0-9a-f]{12}$/),
}).strict().superRefine((identity, context) => {
  if (configId(identity.descriptor) !== identity.configId) {
    context.addIssue({ code: 'custom', path: ['configId'], message: 'configId does not match descriptor' });
  }
});

export const driveRunBatchStateSchema = z.object({
  displayName: z.string().min(1),
  jobName: z.string().min(1).nullable(),
  state: z.enum(['preparing', 'submitted', 'completed', 'failed']),
  model: z.string().min(1),
  configIdentity: processConfigIdentitySchema.optional(),
  requests: z.array(driveRunBatchRequestSchema),
});

export type DriveRunBatchState = z.output<typeof driveRunBatchStateSchema>;

export const driveRunBatchDisplayName = (runId: string): string => `avc-drive-${runId}`;

const batchSubmitRejectedDetails = { batchSubmitRejected: true } as const;

// A submit that the API rejected before it could create anything is safe to forget. Anything
// else — a dropped connection, a timeout — may have created a job we still have to re-attach to.
export const batchSubmitRejection = (error: AppError): AppError =>
  appError(error.code, error.message, batchSubmitRejectedDetails);

export const isBatchSubmitRejection = (error: AppError): boolean =>
  batchSubmitRejectedSchema.safeParse(error.details).success;

const batchSubmitRejectedSchema = z.object({ batchSubmitRejected: z.literal(true) });

export const parseDriveRunBatchState = (value: string | null): DriveRunBatchState | null => {
  if (value === null || value.length === 0) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    return null;
  }
  const parsed = driveRunBatchStateSchema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
};

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
