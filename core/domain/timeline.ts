import { z } from 'zod';

import { appError, type AppError } from './errors.js';
import { type Result } from './result.js';
import { type TimelineIntervalKind } from './global-catalog.js';

const geoPointSchema = z.string().regex(/^geo:-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);

const timelineEntrySchema = z.object({
  startTime: z.string(),
  endTime: z.string(),
  visit: z.object({ topCandidate: z.object({ placeLocation: geoPointSchema }) }).optional(),
  activity: z.object({
    start: geoPointSchema,
    end: geoPointSchema,
    distanceMeters: z.string().optional(),
  }).optional(),
  timelinePath: z.array(z.object({
    point: geoPointSchema,
    durationMinutesOffsetFromStartTime: z.string(),
  })).optional(),
});

export interface TimelineIntervalPoint {
  atMs: number;
  lat: number;
  lon: number;
}

export interface TimelineInterval {
  kind: TimelineIntervalKind;
  startMs: number;
  endMs: number;
  points: TimelineIntervalPoint[];
  distanceM: number | null;
}

export interface TimelineParseSummary {
  entries: number;
  entriesSkipped: number;
  entriesIgnored: number;
  intervals: TimelineInterval[];
  firstStart: string | null;
  lastEnd: string | null;
}

const parseGeoPoint = (value: string): { lat: number; lon: number } => {
  const [lat, lon] = value.slice('geo:'.length).split(',').map(Number);
  return { lat: lat ?? 0, lon: lon ?? 0 };
};

export const parseTimeline = (raw: string): Result<TimelineParseSummary, AppError> => {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { ok: false, error: appError('validation', 'Timeline export is not valid JSON') };
  }
  const arraySchema = z.array(z.unknown());
  const arrayParsed = arraySchema.safeParse(decoded);
  if (!arrayParsed.success) {
    return { ok: false, error: appError('validation', 'Timeline export is not a JSON array') };
  }

  let entriesSkipped = 0;
  let entriesIgnored = 0;
  const intervals: TimelineInterval[] = [];
  let firstStart: number | null = null;
  let lastEnd: number | null = null;

  for (const element of arrayParsed.data) {
    const parsed = timelineEntrySchema.safeParse(element);
    if (!parsed.success) {
      entriesSkipped += 1;
      continue;
    }
    const entry = parsed.data;
    const startMs = Date.parse(entry.startTime);
    const endMs = Date.parse(entry.endTime);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      entriesSkipped += 1;
      continue;
    }
    const interval = intervalFromEntry(entry, startMs, endMs);
    if (interval === null) {
      entriesIgnored += 1;
      continue;
    }
    intervals.push(interval);
    firstStart = firstStart === null ? startMs : Math.min(firstStart, startMs);
    lastEnd = lastEnd === null ? endMs : Math.max(lastEnd, endMs);
  }

  if (intervals.length === 0) {
    return { ok: false, error: appError('validation', 'Timeline export produced no usable intervals') };
  }

  intervals.sort((left, right) => left.startMs - right.startMs);

  return {
    ok: true,
    value: {
      entries: arrayParsed.data.length,
      entriesSkipped,
      entriesIgnored,
      intervals,
      firstStart: firstStart === null ? null : new Date(firstStart).toISOString(),
      lastEnd: lastEnd === null ? null : new Date(lastEnd).toISOString(),
    },
  };
};

const intervalFromEntry = (
  entry: z.output<typeof timelineEntrySchema>,
  startMs: number,
  endMs: number,
): TimelineInterval | null => {
  if (entry.visit !== undefined) {
    const point = parseGeoPoint(entry.visit.topCandidate.placeLocation);
    return { kind: 'visit', startMs, endMs, points: [{ atMs: startMs, ...point }], distanceM: null };
  }
  if (entry.activity !== undefined) {
    const start = parseGeoPoint(entry.activity.start);
    const end = parseGeoPoint(entry.activity.end);
    const distanceM = entry.activity.distanceMeters === undefined ? null : Number(entry.activity.distanceMeters);
    return {
      kind: 'activity',
      startMs,
      endMs,
      points: [{ atMs: startMs, ...start }, { atMs: endMs, ...end }],
      distanceM: distanceM === null || !Number.isFinite(distanceM) ? null : distanceM,
    };
  }
  if (entry.timelinePath !== undefined && entry.timelinePath.length > 0) {
    const points = entry.timelinePath
      .map((step) => {
        const point = parseGeoPoint(step.point);
        const offsetMinutes = Number(step.durationMinutesOffsetFromStartTime);
        return { atMs: startMs + offsetMinutes * 60_000, ...point };
      })
      .sort((left, right) => left.atMs - right.atMs);
    return { kind: 'path', startMs, endMs, points, distanceM: null };
  }
  return null;
};

const EARTH_RADIUS_M = 6_371_000;

const haversineM = (a: { lat: number; lon: number }, b: { lat: number; lon: number }): number => {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
};

export interface TimelineMatchOptions {
  toleranceMs: number;
  maxVisitHours: number;
}

export interface TimelineMatch {
  lat: number;
  lon: number;
  accuracyM: number;
  kind: TimelineIntervalKind;
}

interface Candidate {
  interval: TimelineInterval;
  contains: boolean;
  gapMs: number;
}

const KIND_RANK: Record<TimelineIntervalKind, number> = { visit: 0, activity: 1, path: 2 };

export const matchTimeline = (
  intervals: readonly TimelineInterval[],
  capturedAtMs: number,
  options: TimelineMatchOptions,
): TimelineMatch | null => {
  const candidates: Candidate[] = [];
  for (const interval of intervals) {
    const contains = capturedAtMs >= interval.startMs && capturedAtMs <= interval.endMs;
    const gapMs = contains
      ? 0
      : Math.min(Math.abs(capturedAtMs - interval.startMs), Math.abs(capturedAtMs - interval.endMs));
    if (contains || gapMs <= options.toleranceMs) {
      candidates.push({ interval, contains, gapMs });
    }
  }
  if (candidates.length === 0) return null;

  candidates.sort((left, right) => {
    if (left.contains !== right.contains) return left.contains ? -1 : 1;
    const kindDiff = KIND_RANK[left.interval.kind] - KIND_RANK[right.interval.kind];
    if (kindDiff !== 0) return kindDiff;
    const lengthDiff = (left.interval.endMs - left.interval.startMs) - (right.interval.endMs - right.interval.startMs);
    if (lengthDiff !== 0) return lengthDiff;
    return left.interval.startMs - right.interval.startMs;
  });

  const best = candidates[0];
  if (best === undefined) return null;
  return best.contains
    ? matchWithinInterval(best.interval, capturedAtMs, options)
    : matchOutsideInterval(best.interval, capturedAtMs, best.gapMs, options);
};

const matchWithinInterval = (
  interval: TimelineInterval,
  capturedAtMs: number,
  options: TimelineMatchOptions,
): TimelineMatch => {
  if (interval.kind === 'visit') {
    const point = interval.points[0];
    if (point === undefined) throw new Error('Visit interval has no point');
    const durationHours = (interval.endMs - interval.startMs) / 3_600_000;
    const accuracyM = durationHours > options.maxVisitHours ? 5000 : 150;
    return { lat: point.lat, lon: point.lon, accuracyM, kind: 'visit' };
  }
  if (interval.kind === 'activity') {
    const start = interval.points[0];
    const end = interval.points[1];
    if (start === undefined || end === undefined) throw new Error('Activity interval missing endpoints');
    const span = interval.endMs - interval.startMs;
    const ratio = span === 0 ? 0 : (capturedAtMs - interval.startMs) / span;
    const lat = start.lat + (end.lat - start.lat) * ratio;
    const lon = start.lon + (end.lon - start.lon) * ratio;
    const distanceM = interval.distanceM ?? haversineM(start, end);
    return { lat, lon, accuracyM: Math.max(1000, distanceM / 2), kind: 'activity' };
  }
  return matchPathPoint(interval, capturedAtMs);
};

const matchPathPoint = (interval: TimelineInterval, capturedAtMs: number): TimelineMatch => {
  const points = interval.points;
  if (points.length === 0) throw new Error('Path interval has no points');
  if (points.length === 1) {
    const only = points[0];
    if (only === undefined) throw new Error('Path interval has no points');
    return { lat: only.lat, lon: only.lon, accuracyM: 500, kind: 'path' };
  }
  let previous = points[0];
  let next = points[points.length - 1];
  if (previous === undefined || next === undefined) throw new Error('Path interval missing points');
  for (let index = 0; index < points.length - 1; index += 1) {
    const left = points[index];
    const right = points[index + 1];
    if (left === undefined || right === undefined) continue;
    if (capturedAtMs >= left.atMs && capturedAtMs <= right.atMs) {
      previous = left;
      next = right;
      break;
    }
  }
  if (capturedAtMs <= previous.atMs) {
    return { lat: previous.lat, lon: previous.lon, accuracyM: 500, kind: 'path' };
  }
  if (capturedAtMs >= next.atMs) {
    return { lat: next.lat, lon: next.lon, accuracyM: 500, kind: 'path' };
  }
  const span = next.atMs - previous.atMs;
  const ratio = span === 0 ? 0 : (capturedAtMs - previous.atMs) / span;
  const lat = previous.lat + (next.lat - previous.lat) * ratio;
  const lon = previous.lon + (next.lon - previous.lon) * ratio;
  const gapM = haversineM(previous, next);
  return { lat, lon, accuracyM: Math.max(500, gapM / 2), kind: 'path' };
};

const matchOutsideInterval = (
  interval: TimelineInterval,
  capturedAtMs: number,
  gapMs: number,
  options: TimelineMatchOptions,
): TimelineMatch => {
  const base = matchWithinInterval(
    interval,
    capturedAtMs <= interval.startMs ? interval.startMs : interval.endMs,
    options,
  );
  const gapSeconds = gapMs / 1000;
  return { ...base, accuracyM: base.accuracyM + gapSeconds * 15 };
};

const FILENAME_PATTERNS: RegExp[] = [
  /^DJI_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/,
  /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/,
  /^PXL_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/,
];

export const filenameLocalTimestamp = (fileName: string): Date | null => {
  for (const pattern of FILENAME_PATTERNS) {
    const match = pattern.exec(fileName);
    if (match === null) continue;
    const [, year, month, day, hour, minute, second] = match;
    if (year === undefined || month === undefined || day === undefined
      || hour === undefined || minute === undefined || second === undefined) continue;
    const date = new Date(
      Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second),
    );
    if (Number.isNaN(date.getTime())) continue;
    return date;
  }
  return null;
};
