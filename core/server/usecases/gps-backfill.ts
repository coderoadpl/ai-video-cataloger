import {
  appError,
  filenameLocalTimestamp,
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
  type GeoBackfillCandidate,
  type GlobalCatalogStore,
  type JobExecutionContext,
  type JobsPort,
  type MediaPort,
  type PlacesPort,
} from '../ports.js';
import { type DriveRunFailure } from './process-drive.js';

const maxSkewSamples = 20;
const accuracyBucketsM = [200, 500, 1000, 5000, 20_000, null] as const;
const skewToleranceMs = 14 * 60 * 60 * 1000;
const quarterHourMs = 15 * 60 * 1000;
const quarterHourSlackMs = 5 * 60 * 1000;

export interface GpsBackfillDeps {
  fs: FileSystemPort;
  media: MediaPort;
  places: PlacesPort;
  globalCatalog: GlobalCatalogStore;
  jobs: JobsPort;
}

export type GpsBackfillPassDeps = Omit<GpsBackfillDeps, 'jobs'>;

export interface GpsBackfillInput {
  timelinePath: string;
  root: string | null;
  dryRun: boolean;
  toleranceMinutes: number;
  maxVisitHours: number;
  reresolvePlaces: boolean;
}

export interface GpsBackfillSummary {
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
  filesTotal: number;
  filesConsidered: number;
  capturedAtProbed: number;
  matched: { visit: number; activity: number; path: number };
  matchedWithinTolerance: number;
  written: number;
  unchanged: number;
  unmatched: number;
  skipped: {
    cameraGps: number;
    manualGps: number;
    noCapturedAt: number;
    offline: number;
  };
  skewSuspicious: number;
  skewSamples: string[];
  accuracy: {
    buckets: { upToM: number | null; files: number }[];
    medianM: number | null;
    p90M: number | null;
  };
  places: { datasetId: string | null; resolved: number; unresolved: number; skippedNoDataset: number };
  failures: DriveRunFailure[];
  elapsedMs: number;
}

export const gpsBackfill = async (
  deps: GpsBackfillDeps,
  input: GpsBackfillInput,
): Promise<Result<{ jobId: string }, AppError>> => {
  const resourceKey = input.root === null ? 'gps-backfill' : `gps-backfill:${deps.fs.resolve(input.root)}`;
  return deps.jobs.enqueue({
    kind: 'gps_backfill',
    payload: input,
    resourceKey,
    run: (context) => runGpsBackfill(deps, input, context),
  });
};

export const runGpsBackfill = async (
  deps: GpsBackfillPassDeps,
  input: GpsBackfillInput,
  progress?: JobExecutionContext,
): Promise<Result<GpsBackfillSummary, AppError>> => {
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();

  const timelineText = await deps.fs.readTextFile(input.timelinePath);
  if (!timelineText.ok) return timelineText;
  if (timelineText.value === null) {
    return { ok: false, error: appError('file_not_found', `Timeline export not found: ${input.timelinePath}`) };
  }
  const parsedTimeline = parseTimeline(timelineText.value);
  if (!parsedTimeline.ok) return parsedTimeline;

  const summary: GpsBackfillSummary = {
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
    filesTotal: 0,
    filesConsidered: 0,
    capturedAtProbed: 0,
    matched: { visit: 0, activity: 0, path: 0 },
    matchedWithinTolerance: 0,
    written: 0,
    unchanged: 0,
    unmatched: 0,
    skipped: { cameraGps: 0, manualGps: 0, noCapturedAt: 0, offline: 0 },
    skewSuspicious: 0,
    skewSamples: [],
    accuracy: { buckets: accuracyBucketsM.map((upToM) => ({ upToM, files: 0 })), medianM: null, p90M: null },
    places: { datasetId: null, resolved: 0, unresolved: 0, skippedNoDataset: 0 },
    failures: [],
    elapsedMs: 0,
  };

  const started = await report(progress, {
    step: 'gps_timeline_loaded',
    percentage: 0,
    total: summary.timeline.intervals,
    data: { timelinePath: input.timelinePath, intervals: summary.timeline.intervals },
  });
  if (!started.ok) return started;

  const candidates = await deps.globalCatalog.listGeoBackfillCandidates({ root: input.root });
  if (!candidates.ok) return candidates;
  summary.filesTotal = candidates.value.length;

  const placesDependency = await deps.places.dependency();
  const placesInstalled = placesDependency.ok && placesDependency.value.available;

  const onlineFolders = new Map<string, boolean>();
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
      summary.filesConsidered += 1;
      const matched = await matchCandidate(deps, input, candidate, parsedTimeline.value.intervals, onlineFolders, summary, accuracySamples);
      if (matched !== null) coordinates = matched;
    }

    if (coordinates !== null) {
      await resolvePlaceIfNeeded(deps, input, candidate, coordinates, placesInstalled, summary);
    }

    const reported = await report(progress, {
      step: 'gps_backfill_file',
      current,
      total: summary.filesTotal,
      data: { fileName: candidate.fileName, folderPath: candidate.folderPath },
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

const matchCandidate = async (
  deps: GpsBackfillPassDeps,
  input: GpsBackfillInput,
  candidate: GeoBackfillCandidate,
  intervals: Parameters<typeof matchTimeline>[0],
  onlineFolders: Map<string, boolean>,
  summary: GpsBackfillSummary,
  accuracySamples: number[],
): Promise<{ lat: number; lon: number } | null> => {
  let capturedAt = candidate.capturedAt;

  if (capturedAt === null) {
    let online = onlineFolders.get(candidate.folderPath);
    if (online === undefined) {
      const exists = await deps.fs.exists(candidate.folderPath);
      online = exists.ok && exists.value;
      onlineFolders.set(candidate.folderPath, online);
    }
    if (!online) {
      summary.skipped.offline += 1;
      return null;
    }
    const videoPath = deps.fs.join(candidate.folderPath, candidate.fileName);
    const isFile = await deps.fs.isFile(videoPath);
    if (!isFile.ok || !isFile.value) {
      summary.skipped.offline += 1;
      return null;
    }
    const probe = await deps.media.probe({ videoPath });
    if (probe.ok && probe.value.createdAtUtc !== null) {
      capturedAt = probe.value.createdAtUtc;
      summary.capturedAtProbed += 1;
    }
  }

  if (capturedAt === null) {
    summary.skipped.noCapturedAt += 1;
    return null;
  }

  recordSkew(candidate.fileName, capturedAt, summary);

  const capturedAtMs = Date.parse(capturedAt);
  const match = matchTimeline(intervals, capturedAtMs, {
    toleranceMs: input.toleranceMinutes * 60_000,
    maxVisitHours: input.maxVisitHours,
  });

  const capturedAtWrite = candidate.capturedAt === null ? { at: capturedAt, source: 'container' as const } : undefined;

  if (match === null) {
    summary.unmatched += 1;
    if (!input.dryRun && capturedAtWrite !== undefined) {
      await deps.globalCatalog.applyGeoBackfill({ fingerprint: candidate.fingerprint, capturedAt: capturedAtWrite });
    }
    return null;
  }

  summary.matched[match.kind] += 1;
  if (!match.contained) summary.matchedWithinTolerance += 1;
  accuracySamples.push(match.accuracyM);
  const bucket = summary.accuracy.buckets.find((entry) => entry.upToM === null || match.accuracyM <= entry.upToM);
  if (bucket !== undefined) bucket.files += 1;

  if (input.dryRun) return { lat: match.lat, lon: match.lon };

  const result = await deps.globalCatalog.applyGeoBackfill({
    fingerprint: candidate.fingerprint,
    capturedAt: capturedAtWrite,
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

const recordSkew = (fileName: string, capturedAt: string, summary: GpsBackfillSummary): void => {
  const local = filenameLocalTimestamp(fileName);
  if (local === null) return;
  const capturedAtMs = Date.parse(capturedAt);
  const diffMs = Math.abs(local.getTime() - capturedAtMs);
  const nearestQuarterHourDiff = Math.abs(diffMs % quarterHourMs);
  const alignedToQuarterHour = Math.min(nearestQuarterHourDiff, quarterHourMs - nearestQuarterHourDiff) <= quarterHourSlackMs;
  if (diffMs > skewToleranceMs || !alignedToQuarterHour) {
    summary.skewSuspicious += 1;
    if (summary.skewSamples.length < maxSkewSamples) summary.skewSamples.push(fileName);
  }
};

const resolvePlaceIfNeeded = async (
  deps: GpsBackfillPassDeps,
  input: GpsBackfillInput,
  candidate: GeoBackfillCandidate,
  coordinates: { lat: number; lon: number },
  placesInstalled: boolean,
  summary: GpsBackfillSummary,
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
    await deps.globalCatalog.applyGeoBackfill({ fingerprint: candidate.fingerprint, place });
  }
};

const percentile = (sorted: readonly number[], fraction: number): number => {
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index] ?? 0;
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
