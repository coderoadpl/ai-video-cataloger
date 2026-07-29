import { describe, expect, it } from 'vitest';

import { type AppError, type CatalogFile, type CatalogFolder, type Result, ok } from '@core/domain/index.js';

import type { DependencyStatus, JobProgress, PlaceMatch, PlacesPort } from '../ports.js';
import { runGpsBackfill } from './gps-backfill.js';
import { InMemoryFileSystem, InMemoryGlobalCatalogStore, InMemoryMedia } from '../../../test/server/usecases/test-fakes.js';

class FakePlaces implements PlacesPort {
  installed = false;
  matches = new Map<string, PlaceMatch>();

  dependency(): Promise<Result<DependencyStatus, AppError>> {
    return Promise.resolve(ok({
      name: 'places',
      available: this.installed,
      version: null,
      source: null,
      path: null,
      installHint: 'avc models places install',
    }));
  }

  isReady(): Promise<Result<boolean, AppError>> {
    return Promise.resolve(ok(this.installed));
  }

  resolve(input: { lat: number; lon: number }): Promise<Result<PlaceMatch | null, AppError>> {
    const key = `${input.lat.toFixed(2)}|${input.lon.toFixed(2)}`;
    const match = this.matches.get(key);
    return Promise.resolve(ok(match ?? null));
  }
}

const folder: CatalogFolder = {
  folderId: 'folder-1',
  currentPath: '/media/drive-a',
  displayName: 'drive-a',
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
};

const baseFile: CatalogFile = {
  fingerprint: 'fp-1',
  folderId: folder.folderId,
  fileName: 'clip.mp4',
  size: 100,
  durationS: 10,
  gpsLat: null,
  gpsLon: null,
  processedAt: '2026-01-01T00:00:00.000Z',
  analyzer: null,
  model: null,
  missingAt: null,
  capturedAt: null,
  capturedAtSource: null,
  gpsSource: null,
  gpsAccuracyM: null,
  gpsIntervalKind: null,
  gpsResolvedAt: null,
  place: null,
};

const buildTimeline = (entries: unknown[]): string => JSON.stringify(entries);

const visitEntry = (startTime: string, endTime: string, lat: number, lon: number) => ({
  startTime,
  endTime,
  visit: { topCandidate: { placeLocation: `geo:${lat},${lon}` } },
});

const baseInput: { root: string | null; dryRun: boolean; toleranceMinutes: number; maxVisitHours: number; reresolvePlaces: boolean } = {
  root: null,
  dryRun: false,
  toleranceMinutes: 30,
  maxVisitHours: 36,
  reresolvePlaces: false,
};

describe('runGpsBackfill', () => {
  it('P7 + guard 1: a camera-sourced row is never modified and is counted separately', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addFile('/timeline.json', { content: buildTimeline([visitEntry('2026-01-01T09:00:00Z', '2026-01-01T11:00:00Z', 10, 20)]) });
    const media = new InMemoryMedia(fs);
    const catalog = new InMemoryGlobalCatalogStore();
    await catalog.upsertFolder(folder);
    await catalog.upsertFile({ ...baseFile, gpsLat: 1, gpsLon: 1, gpsSource: 'camera', capturedAt: '2026-01-01T10:00:00.000Z' });

    const result = await runGpsBackfill({ fs, media, places: new FakePlaces(), globalCatalog: catalog }, { ...baseInput, timelinePath: '/timeline.json' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.skipped.cameraGps).toBe(1);
    expect(result.value.filesConsidered).toBe(0);
    const stored = await catalog.getFile('fp-1');
    expect(stored.ok && stored.value?.gpsLat).toBe(1);
  });

  it('guard 2: dry-run reports the same counters as a real run but writes nothing', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addFile('/timeline.json', { content: buildTimeline([visitEntry('2026-01-01T09:00:00Z', '2026-01-01T11:00:00Z', 10, 20)]) });
    const media = new InMemoryMedia(fs);
    const catalog = new InMemoryGlobalCatalogStore();
    await catalog.upsertFolder(folder);
    await catalog.upsertFile({ ...baseFile, capturedAt: '2026-01-01T10:00:00.000Z' });

    const dryRun = await runGpsBackfill({ fs, media, places: new FakePlaces(), globalCatalog: catalog }, { ...baseInput, timelinePath: '/timeline.json', dryRun: true });
    expect(dryRun.ok && dryRun.value.matched.visit).toBe(1);
    expect(dryRun.ok && dryRun.value.written).toBe(0);
    const afterDryRun = await catalog.getFile('fp-1');
    expect(afterDryRun.ok && afterDryRun.value?.gpsLat).toBe(null);

    const realRun = await runGpsBackfill({ fs, media, places: new FakePlaces(), globalCatalog: catalog }, { ...baseInput, timelinePath: '/timeline.json', dryRun: false });
    expect(realRun.ok && realRun.value.matched.visit).toBe(1);
    expect(realRun.ok && realRun.value.written).toBe(1);
    const afterRealRun = await catalog.getFile('fp-1');
    expect(afterRealRun.ok && afterRealRun.value?.gpsLat).toBe(10);
  });

  it('guard 3: running twice is idempotent, second run reports written 0 and unchanged n', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addFile('/timeline.json', { content: buildTimeline([visitEntry('2026-01-01T09:00:00Z', '2026-01-01T11:00:00Z', 10, 20)]) });
    const media = new InMemoryMedia(fs);
    const catalog = new InMemoryGlobalCatalogStore();
    await catalog.upsertFolder(folder);
    await catalog.upsertFile({ ...baseFile, capturedAt: '2026-01-01T10:00:00.000Z' });

    await runGpsBackfill({ fs, media, places: new FakePlaces(), globalCatalog: catalog }, { ...baseInput, timelinePath: '/timeline.json' });
    const second = await runGpsBackfill({ fs, media, places: new FakePlaces(), globalCatalog: catalog }, { ...baseInput, timelinePath: '/timeline.json' });

    expect(second.ok && second.value.written).toBe(0);
    expect(second.ok && second.value.unchanged).toBe(1);
  });

  it('guard 4: a file with no captured_at in an offline folder is skipped without a probe', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addFile('/timeline.json', { content: buildTimeline([visitEntry('2026-01-01T09:00:00Z', '2026-01-01T11:00:00Z', 10, 20)]) });
    const media = new InMemoryMedia(fs);
    const catalog = new InMemoryGlobalCatalogStore();
    await catalog.upsertFolder({ ...folder, currentPath: '/media/offline-drive' });
    await catalog.upsertFile({ ...baseFile, folderId: folder.folderId });

    const result = await runGpsBackfill({ fs, media, places: new FakePlaces(), globalCatalog: catalog }, { ...baseInput, timelinePath: '/timeline.json' });

    expect(result.ok && result.value.skipped.offline).toBe(1);
    expect(result.ok && result.value.capturedAtProbed).toBe(0);
  });

  it('guard 5: visit and path matches record different interval kind and accuracy', async () => {
    const fs = new InMemoryFileSystem('/work');
    const timeline = buildTimeline([
      visitEntry('2026-01-01T09:00:00Z', '2026-01-01T11:00:00Z', 10, 20),
      {
        startTime: '2026-02-01T00:00:00Z',
        endTime: '2026-02-01T02:00:00Z',
        timelinePath: [
          { point: 'geo:30,40', durationMinutesOffsetFromStartTime: '0' },
          { point: 'geo:30.01,40.01', durationMinutesOffsetFromStartTime: '60' },
        ],
      },
    ]);
    fs.addFile('/timeline.json', { content: timeline });
    const media = new InMemoryMedia(fs);
    const catalog = new InMemoryGlobalCatalogStore();
    await catalog.upsertFolder(folder);
    await catalog.upsertFile({ ...baseFile, fingerprint: 'fp-visit', capturedAt: '2026-01-01T10:00:00.000Z' });
    await catalog.upsertFile({ ...baseFile, fingerprint: 'fp-path', fileName: 'clip2.mp4', capturedAt: '2026-02-01T00:30:00.000Z' });

    const result = await runGpsBackfill({ fs, media, places: new FakePlaces(), globalCatalog: catalog }, { ...baseInput, timelinePath: '/timeline.json' });

    expect(result.ok && result.value.matched.visit).toBe(1);
    expect(result.ok && result.value.matched.path).toBe(1);
    const visitFile = await catalog.getFile('fp-visit');
    const pathFile = await catalog.getFile('fp-path');
    expect(visitFile.ok && visitFile.value?.gpsIntervalKind).toBe('visit');
    expect(pathFile.ok && pathFile.value?.gpsIntervalKind).toBe('path');
    expect(visitFile.ok && visitFile.value?.gpsAccuracyM).not.toBe(pathFile.ok && pathFile.value?.gpsAccuracyM);
  });

  it('guard 6: place resolution fills place_* and makes the row searchable through applyGeoBackfill', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addFile('/timeline.json', { content: buildTimeline([visitEntry('2026-01-01T09:00:00Z', '2026-01-01T11:00:00Z', 10, 20)]) });
    const media = new InMemoryMedia(fs);
    const catalog = new InMemoryGlobalCatalogStore();
    await catalog.upsertFolder(folder);
    await catalog.upsertFile({ ...baseFile, capturedAt: '2026-01-01T10:00:00.000Z' });
    const places = new FakePlaces();
    places.installed = true;
    places.matches.set('10.00|20.00', { name: 'Fjordvik', region: null, country: 'Norway', countryCode: 'NO', distanceM: 42, dataset: 'test-dataset' });

    const result = await runGpsBackfill({ fs, media, places, globalCatalog: catalog }, { ...baseInput, timelinePath: '/timeline.json' });

    expect(result.ok && result.value.places.resolved).toBe(1);
    const stored = await catalog.getFile('fp-1');
    expect(stored.ok && stored.value?.place?.name).toBe('Fjordvik');
  });

  it('guard 7: a missing dataset still succeeds and reports skippedNoDataset', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addFile('/timeline.json', { content: buildTimeline([visitEntry('2026-01-01T09:00:00Z', '2026-01-01T11:00:00Z', 10, 20)]) });
    const media = new InMemoryMedia(fs);
    const catalog = new InMemoryGlobalCatalogStore();
    await catalog.upsertFolder(folder);
    await catalog.upsertFile({ ...baseFile, capturedAt: '2026-01-01T10:00:00.000Z' });

    const result = await runGpsBackfill({ fs, media, places: new FakePlaces(), globalCatalog: catalog }, { ...baseInput, timelinePath: '/timeline.json' });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.places.skippedNoDataset).toBe(1);
  });

  it('counts only tolerance-only matches in matchedWithinTolerance and buckets a low-accuracy fix', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addFile('/timeline.json', { content: buildTimeline([
      visitEntry('2026-01-01T09:00:00Z', '2026-01-01T11:00:00Z', 10, 20),
      visitEntry('2026-03-01T09:00:00Z', '2026-03-01T11:00:00Z', 30, 40),
    ]) });
    const media = new InMemoryMedia(fs);
    const catalog = new InMemoryGlobalCatalogStore();
    await catalog.upsertFolder(folder);
    await catalog.upsertFile({ ...baseFile, fingerprint: 'fp-inside', capturedAt: '2026-01-01T10:00:00.000Z' });
    await catalog.upsertFile({ ...baseFile, fingerprint: 'fp-outside', fileName: 'clip2.mp4', capturedAt: '2026-03-01T11:25:00.000Z' });

    const result = await runGpsBackfill({ fs, media, places: new FakePlaces(), globalCatalog: catalog }, { ...baseInput, timelinePath: '/timeline.json' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.matched.visit).toBe(2);
    expect(result.value.matchedWithinTolerance).toBe(1);
    const bucketed = result.value.accuracy.buckets.reduce((total, bucket) => total + bucket.files, 0);
    expect(bucketed).toBe(2);
    expect(result.value.accuracy.buckets.at(-1)?.upToM).toBe(null);
  });

  it('fails with file_not_found when the timeline export is missing', async () => {
    const fs = new InMemoryFileSystem('/work');
    const media = new InMemoryMedia(fs);
    const catalog = new InMemoryGlobalCatalogStore();

    const result = await runGpsBackfill({ fs, media, places: new FakePlaces(), globalCatalog: catalog }, { ...baseInput, timelinePath: '/missing.json' });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('file_not_found');
  });

  it('emits a loaded event, one file event per candidate, and a done event', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addFile('/timeline.json', { content: buildTimeline([visitEntry('2026-01-01T09:00:00Z', '2026-01-01T11:00:00Z', 10, 20)]) });
    const media = new InMemoryMedia(fs);
    const catalog = new InMemoryGlobalCatalogStore();
    await catalog.upsertFolder(folder);
    await catalog.upsertFile({ ...baseFile, capturedAt: '2026-01-01T10:00:00.000Z' });
    const events: JobProgress[] = [];
    const progress = {
      signal: new AbortController().signal,
      reportProgress: (event: JobProgress): Promise<Result<void, AppError>> => {
        events.push(event);
        return Promise.resolve(ok(undefined));
      },
    };

    await runGpsBackfill({ fs, media, places: new FakePlaces(), globalCatalog: catalog }, { ...baseInput, timelinePath: '/timeline.json' }, progress);

    expect(events.map((event) => event.step)).toEqual(['gps_timeline_loaded', 'gps_backfill_file', 'gps_backfill_done']);
  });
});
