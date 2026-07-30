import {
  appError,
  matchTimeline,
  ok,
  parseTimeline,
  type AppError,
  type CatalogPlace,
  type Result,
} from '@core/domain/index.js';

import {
  JOB_CANCELLED_ERROR_MESSAGE,
  type FileSystemPort,
  type JobExecutionContext,
  type JobsPort,
  type PhotoGeoBackfillCandidate,
  type PhotosStore,
  type PlacesPort,
} from '../ports.js';
import { accuracyBucketsM, percentile } from './gps-shared.js';

const assumedWideningFloorMinutes = 180;

export interface PhotoGpsBackfillDeps {
  fs: FileSystemPort;
  photos: PhotosStore;
  places: PlacesPort;
  jobs: JobsPort;
}

export type PhotoGpsBackfillPassDeps = Omit<PhotoGpsBackfillDeps, 'jobs'>;

export interface PhotoGpsBackfillInput {
  timelinePath: string;
  root: string | null;
  dryRun: boolean;
  toleranceMinutes: number;
  maxVisitHours: number;
  reresolvePlaces: boolean;
}

export interface PhotoGpsBackfillSummary {
  media: 'photo';
  timelinePath: string;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string | null;
  timeline: {
    entries: number;
    entriesSkipped: number;
    entriesIgnored: number;
    intervals: number;
    firstStart: string | null;
    lastEnd: string | null;
  };
  photosTotal: number;
  photosConsidered: number;
  matched: { visit: number; activity: number; path: number };
  matchedWithinTolerance: number;
  assumedWidened: number;
  written: number;
  unchanged: number;
  unmatched: number;
  skipped: { cameraGps: number; manualGps: number; noCapturedAt: number };
  accuracy: {
    buckets: { upToM: number | null; files: number }[];
    medianM: number | null;
    p90M: number | null;
  };
  places: { datasetId: string | null; resolved: number; unresolved: number; skippedNoDataset: number };
  elapsedMs: number;
}

export const photosGpsBackfill = async (
  deps: PhotoGpsBackfillDeps,
  input: PhotoGpsBackfillInput,
): Promise<Result<{ jobId: string }, AppError>> => {
  const resourceKey = input.root === null ? 'photo-gps-backfill' : `photo-gps-backfill:${deps.fs.resolve(input.root)}`;
  return deps.jobs.enqueue({
    kind: 'photo_gps_backfill',
    payload: input,
    resourceKey,
    run: (context) => runPhotoGpsBackfill(deps, input, context),
  });
};

export const runPhotoGpsBackfill = async (
  deps: PhotoGpsBackfillPassDeps,
  input: PhotoGpsBackfillInput,
  progress?: JobExecutionContext,
): Promise<Result<PhotoGpsBackfillSummary, AppError>> => {
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();

  const timelineText = await deps.fs.readTextFile(input.timelinePath);
  if (!timelineText.ok) return timelineText;
  if (timelineText.value === null) {
    return { ok: false, error: appError('file_not_found', `Timeline export not found: ${input.timelinePath}`) };
  }
  const parsedTimeline = parseTimeline(timelineText.value);
  if (!parsedTimeline.ok) return parsedTimeline;

  const summary: PhotoGpsBackfillSummary = {
    media: 'photo',
    timelinePath: input.timelinePath,
    dryRun: input.dryRun,
    startedAt,
    finishedAt: null,
    timeline: {
      entries: parsedTimeline.value.entries,
      entriesSkipped: parsedTimeline.value.entriesSkipped,
      entriesIgnored: parsedTimeline.value.entriesIgnored,
      intervals: parsedTimeline.value.intervals.length,
      firstStart: parsedTimeline.value.firstStart,
      lastEnd: parsedTimeline.value.lastEnd,
    },
    photosTotal: 0,
    photosConsidered: 0,
    matched: { visit: 0, activity: 0, path: 0 },
    matchedWithinTolerance: 0,
    assumedWidened: 0,
    written: 0,
    unchanged: 0,
    unmatched: 0,
    skipped: { cameraGps: 0, manualGps: 0, noCapturedAt: 0 },
    accuracy: { buckets: accuracyBucketsM.map((upToM) => ({ upToM, files: 0 })), medianM: null, p90M: null },
    places: { datasetId: null, resolved: 0, unresolved: 0, skippedNoDataset: 0 },
    elapsedMs: 0,
  };

  const started = await report(progress, {
    step: 'gps_timeline_loaded',
    percentage: 0,
    total: summary.timeline.intervals,
    data: { timelinePath: input.timelinePath, intervals: summary.timeline.intervals },
  });
  if (!started.ok) return started;

  const candidates = await deps.photos.listPhotoGeoBackfillCandidates({ root: input.root });
  if (!candidates.ok) return candidates;
  summary.photosTotal = candidates.value.length;

  const placesDependency = await deps.places.dependency();
  const placesInstalled = placesDependency.ok && placesDependency.value.available;

  const accuracySamples: number[] = [];

  let current = 0;
  for (const candidate of candidates.value) {
    const cancellation = cancelled(progress);
    if (!cancellation.ok) return cancellation;
    current += 1;

    let coordinates = candidate.gpsLat === null || candidate.gpsLon === null
      ? null
      : { lat: candidate.gpsLat, lon: candidate.gpsLon };

    if (candidate.gpsSource === 'camera') {
      summary.skipped.cameraGps += 1;
    } else if (candidate.gpsSource === 'manual') {
      summary.skipped.manualGps += 1;
    } else {
      summary.photosConsidered += 1;
      const matched = await matchCandidate(deps, input, candidate, parsedTimeline.value.intervals, summary, accuracySamples);
      if (matched !== null) coordinates = matched;
    }

    if (coordinates !== null) {
      await resolvePlaceIfNeeded(deps, input, candidate, coordinates, placesInstalled, summary);
    }

    const reported = await report(progress, {
      step: 'gps_backfill_file',
      current,
      total: summary.photosTotal,
      data: { fileName: candidate.fileName, folderPath: candidate.currentPath },
    });
    if (!reported.ok) return reported;
  }

  if (accuracySamples.length > 0) {
    accuracySamples.sort((left, right) => left - right);
    summary.accuracy.medianM = percentile(accuracySamples, 0.5);
    summary.accuracy.p90M = percentile(accuracySamples, 0.9);
  }

  summary.finishedAt = new Date().toISOString();
  summary.elapsedMs = Date.now() - startedAtMs;

  const done = await report(progress, {
    step: 'gps_backfill_done',
    percentage: 100,
    data: { ...summary },
  });
  if (!done.ok) return done;

  return ok(summary);
};

const toleranceMsFor = (
  candidate: PhotoGeoBackfillCandidate,
  input: PhotoGpsBackfillInput,
): { toleranceMs: number; widened: boolean } => {
  const flagMs = input.toleranceMinutes * 60_000;
  const isAssumedSource = candidate.capturedAtSource === 'exif_local_assumed' || candidate.capturedAtSource === 'file_mtime';
  if (!isAssumedSource) return { toleranceMs: flagMs, widened: false };
  const widenedMs = Math.max(input.toleranceMinutes, assumedWideningFloorMinutes) * 60_000;
  return { toleranceMs: widenedMs, widened: widenedMs !== flagMs };
};

const matchCandidate = async (
  deps: PhotoGpsBackfillPassDeps,
  input: PhotoGpsBackfillInput,
  candidate: PhotoGeoBackfillCandidate,
  intervals: Parameters<typeof matchTimeline>[0],
  summary: PhotoGpsBackfillSummary,
  accuracySamples: number[],
): Promise<{ lat: number; lon: number } | null> => {
  if (candidate.capturedAt === null) {
    summary.skipped.noCapturedAt += 1;
    return null;
  }

  const capturedAtMs = Date.parse(candidate.capturedAt);
  const { toleranceMs, widened } = toleranceMsFor(candidate, input);
  const match = matchTimeline(intervals, capturedAtMs, { toleranceMs, maxVisitHours: input.maxVisitHours });

  if (match === null) {
    summary.unmatched += 1;
    return null;
  }

  summary.matched[match.kind] += 1;
  if (!match.contained) summary.matchedWithinTolerance += 1;
  if (widened) summary.assumedWidened += 1;
  accuracySamples.push(match.accuracyM);
  const bucket = summary.accuracy.buckets.find((entry) => entry.upToM === null || match.accuracyM <= entry.upToM);
  if (bucket !== undefined) bucket.files += 1;

  if (input.dryRun) return { lat: match.lat, lon: match.lon };

  const result = await deps.photos.applyPhotoGeoBackfill({
    fingerprint: candidate.fingerprint,
    location: {
      lat: match.lat,
      lon: match.lon,
      source: 'timeline',
      accuracyM: match.accuracyM,
      intervalKind: match.kind,
      resolvedAt: new Date().toISOString(),
    },
  });
  if (result.ok) {
    if (result.value === 'written') summary.written += 1;
    else if (result.value === 'unchanged') summary.unchanged += 1;
  }
  return { lat: match.lat, lon: match.lon };
};

const resolvePlaceIfNeeded = async (
  deps: PhotoGpsBackfillPassDeps,
  input: PhotoGpsBackfillInput,
  candidate: PhotoGeoBackfillCandidate,
  coordinates: { lat: number; lon: number },
  placesInstalled: boolean,
  summary: PhotoGpsBackfillSummary,
): Promise<void> => {
  const needsResolve = candidate.placeName === null || input.reresolvePlaces;
  if (!needsResolve) return;
  if (!placesInstalled) {
    summary.places.skippedNoDataset += 1;
    return;
  }
  const resolved = await deps.places.resolve(coordinates);
  if (!resolved.ok || resolved.value === null) {
    summary.places.unresolved += 1;
    return;
  }
  summary.places.resolved += 1;
  summary.places.datasetId = resolved.value.dataset;
  const place: CatalogPlace = {
    name: resolved.value.name,
    region: resolved.value.region,
    country: resolved.value.country,
    countryCode: resolved.value.countryCode,
    distanceM: resolved.value.distanceM,
    dataset: resolved.value.dataset,
  };
  if (!input.dryRun) {
    await deps.photos.applyPhotoGeoBackfill({ fingerprint: candidate.fingerprint, place });
  }
};

const report = (
  progress: JobExecutionContext | undefined,
  progressInput: { step: 'gps_timeline_loaded' | 'gps_backfill_file' | 'gps_backfill_done'; percentage?: number; current?: number; total?: number; data?: Record<string, unknown> },
): Promise<Result<void, AppError>> =>
  progress === undefined ? Promise.resolve(ok(undefined)) : progress.reportProgress(progressInput);

const cancelled = (progress: JobExecutionContext | undefined): Result<void, AppError> => {
  if (progress === undefined || !progress.signal.aborted) return ok(undefined);
  return { ok: false, error: appError('processing_error', JOB_CANCELLED_ERROR_MESSAGE) };
};
