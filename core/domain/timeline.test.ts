import { describe, expect, it } from 'vitest';

import { filenameLocalTimestamp, matchTimeline, parseTimeline, type TimelineInterval } from './timeline.js';

const TOLERANCE = { toleranceMs: 30 * 60_000, maxVisitHours: 36 };

const visitEntry = (startTime: string, endTime: string, lat: number, lon: number) => ({
  startTime,
  endTime,
  visit: { topCandidate: { placeLocation: `geo:${String(lat)},${String(lon)}` } },
});

describe('parseTimeline', () => {
  it('parses mixed Z and offset timestamps to the same instant', () => {
    const raw = JSON.stringify([
      visitEntry('2025-09-01T09:00:00Z', '2025-09-01T11:00:00Z', 10, 20),
      { ...visitEntry('2025-09-01T11:00:00+01:00', '2025-09-01T13:00:00+01:00', 10, 20), extraDummy: 1 },
    ]);
    const result = parseTimeline(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.intervals).toHaveLength(2);
    expect(result.value.intervals[1]?.startMs).toBe(Date.parse('2025-09-01T10:00:00Z'));
  });

  it('ignores timelineMemory entries without dropping the usable ones', () => {
    const raw = JSON.stringify([
      visitEntry('2025-09-01T09:00:00Z', '2025-09-01T11:00:00Z', 10, 20),
      { startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T01:00:00Z', timelineMemory: {} },
    ]);
    const result = parseTimeline(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entriesIgnored).toBe(1);
    expect(result.value.entriesSkipped).toBe(0);
    expect(result.value.intervals).toHaveLength(1);
  });

  it('fails validation when an export carries only ignorable entries', () => {
    const raw = JSON.stringify([{ startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T01:00:00Z', timelineMemory: {} }]);
    expect(parseTimeline(raw).ok).toBe(false);
  });

  it('counts one malformed entry without failing the whole parse', () => {
    const raw = JSON.stringify([
      visitEntry('2025-09-01T09:00:00Z', '2025-09-01T11:00:00Z', 10, 20),
      { startTime: 'not-a-date', endTime: 'also-not-a-date' },
    ]);
    const result = parseTimeline(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entriesSkipped).toBe(1);
    expect(result.value.intervals).toHaveLength(1);
  });

  it('fails validation when every entry is malformed', () => {
    const raw = JSON.stringify([{ nonsense: true }]);
    const result = parseTimeline(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('validation');
  });
});

describe('filenameLocalTimestamp', () => {
  const localParts = (date: Date | null) => date === null
    ? null
    : [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()];

  it('parses DJI, plain and PXL filename families', () => {
    expect(localParts(filenameLocalTimestamp('DJI_20250901113511.MP4'))).toEqual([2025, 9, 1, 11, 35, 11]);
    expect(localParts(filenameLocalTimestamp('20250901_113511.mp4'))).toEqual([2025, 9, 1, 11, 35, 11]);
    expect(localParts(filenameLocalTimestamp('PXL_20250901_113511123.mp4'))).toEqual([2025, 9, 1, 11, 35, 11]);
  });

  it('returns null for names without a recognised timestamp', () => {
    expect(filenameLocalTimestamp('holiday-clip.mov')).toBeNull();
  });
});

describe('matchTimeline', () => {
  it('picks the visit over an overlapping 2h timelinePath bucket (P3)', () => {
    const visit: TimelineInterval = {
      kind: 'visit',
      startMs: Date.parse('2025-09-01T09:00:00Z'),
      endMs: Date.parse('2025-09-01T09:50:00Z'),
      points: [{ atMs: Date.parse('2025-09-01T09:00:00Z'), lat: 10, lon: 20 }],
      distanceM: null,
    };
    const path: TimelineInterval = {
      kind: 'path',
      startMs: Date.parse('2025-09-01T08:00:00Z'),
      endMs: Date.parse('2025-09-01T10:00:00Z'),
      points: [
        { atMs: Date.parse('2025-09-01T08:00:00Z'), lat: 11, lon: 21 },
        { atMs: Date.parse('2025-09-01T10:00:00Z'), lat: 12, lon: 22 },
      ],
      distanceM: null,
    };
    const match = matchTimeline([path, visit], Date.parse('2025-09-01T09:30:00Z'), TOLERANCE);
    expect(match?.kind).toBe('visit');
    expect(match?.lat).toBe(10);
    expect(match?.lon).toBe(20);
  });

  it('matches on the capturedAt UTC instant, not the filename local clock (P4)', () => {
    const capturedAt = '2025-09-01T09:35:11Z';
    const earlyInterval: TimelineInterval = {
      kind: 'visit',
      startMs: Date.parse('2025-09-01T09:00:00Z'),
      endMs: Date.parse('2025-09-01T10:00:00Z'),
      points: [{ atMs: Date.parse('2025-09-01T09:00:00Z'), lat: 1, lon: 1 }],
      distanceM: null,
    };
    const localClockInterval: TimelineInterval = {
      kind: 'visit',
      startMs: Date.parse('2025-09-01T11:00:00Z'),
      endMs: Date.parse('2025-09-01T12:00:00Z'),
      points: [{ atMs: Date.parse('2025-09-01T11:00:00Z'), lat: 2, lon: 2 }],
      distanceM: null,
    };
    const match = matchTimeline([earlyInterval, localClockInterval], Date.parse(capturedAt), TOLERANCE);
    expect(match?.lat).toBe(1);
    expect(match?.lon).toBe(1);
  });

  it('assigns visit accuracy 150m, or 5000m past maxVisitHours', () => {
    const shortVisit: TimelineInterval = {
      kind: 'visit',
      startMs: 0,
      endMs: 3_600_000,
      points: [{ atMs: 0, lat: 5, lon: 5 }],
      distanceM: null,
    };
    expect(matchTimeline([shortVisit], 1_000, TOLERANCE)?.accuracyM).toBe(150);

    const longVisit: TimelineInterval = {
      kind: 'visit',
      startMs: 0,
      endMs: 40 * 3_600_000,
      points: [{ atMs: 0, lat: 5, lon: 5 }],
      distanceM: null,
    };
    expect(matchTimeline([longVisit], 1_000, TOLERANCE)?.accuracyM).toBe(5000);
  });

  it('interpolates activity midpoint and applies max(1000, distance/2)', () => {
    const activity: TimelineInterval = {
      kind: 'activity',
      startMs: 0,
      endMs: 100_000,
      points: [{ atMs: 0, lat: 0, lon: 0 }, { atMs: 100_000, lat: 1, lon: 1 }],
      distanceM: 500,
    };
    const match = matchTimeline([activity], 50_000, TOLERANCE);
    expect(match?.lat).toBeCloseTo(0.5, 5);
    expect(match?.lon).toBeCloseTo(0.5, 5);
    expect(match?.accuracyM).toBe(1000);

    const longActivity: TimelineInterval = { ...activity, distanceM: 4000 };
    expect(matchTimeline([longActivity], 50_000, TOLERANCE)?.accuracyM).toBe(2000);
  });

  it('brackets path points by time and applies max(500, gap/2)', () => {
    const path: TimelineInterval = {
      kind: 'path',
      startMs: 0,
      endMs: 200_000,
      points: [
        { atMs: 0, lat: 0, lon: 0 },
        { atMs: 100_000, lat: 0, lon: 0.02 },
        { atMs: 200_000, lat: 0, lon: 0.04 },
      ],
      distanceM: null,
    };
    const match = matchTimeline([path], 50_000, TOLERANCE);
    expect(match?.kind).toBe('path');
    expect(match?.lon).toBeGreaterThan(0);
    expect(match?.lon).toBeLessThan(0.02);
  });

  it('inflates accuracy for a tolerance-only match by gapSeconds * 15', () => {
    const visit: TimelineInterval = {
      kind: 'visit',
      startMs: 1_000_000,
      endMs: 1_100_000,
      points: [{ atMs: 1_000_000, lat: 9, lon: 9 }],
      distanceM: null,
    };
    const match = matchTimeline([visit], 1_100_000 + 60_000, TOLERANCE);
    expect(match).not.toBeNull();
    expect(match?.accuracyM).toBe(150 + 60 * 15);
  });

  it('keeps the over-long visit penalty when the match is tolerance-only', () => {
    const longVisit: TimelineInterval = {
      kind: 'visit',
      startMs: 0,
      endMs: 40 * 3_600_000,
      points: [{ atMs: 0, lat: 5, lon: 5 }],
      distanceM: null,
    };
    const match = matchTimeline([longVisit], 40 * 3_600_000 + 60_000, TOLERANCE);
    expect(match?.accuracyM).toBe(5000 + 60 * 15);
  });

  it('returns null when nothing is within tolerance', () => {
    const visit: TimelineInterval = {
      kind: 'visit',
      startMs: 0,
      endMs: 1000,
      points: [{ atMs: 0, lat: 1, lon: 1 }],
      distanceM: null,
    };
    expect(matchTimeline([visit], 10_000_000, TOLERANCE)).toBeNull();
  });

  it('breaks a containment tie between overlapping same-kind intervals by the shorter one', () => {
    const long: TimelineInterval = {
      kind: 'visit',
      startMs: 0,
      endMs: 1_000_000,
      points: [{ atMs: 0, lat: 100, lon: 100 }],
      distanceM: null,
    };
    const short: TimelineInterval = {
      kind: 'visit',
      startMs: 400_000,
      endMs: 600_000,
      points: [{ atMs: 400_000, lat: 7, lon: 7 }],
      distanceM: null,
    };
    const match = matchTimeline([long, short], 500_000, TOLERANCE);
    expect(match?.lat).toBe(7);
  });
});
