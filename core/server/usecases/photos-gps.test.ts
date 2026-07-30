import { describe, expect, it } from 'vitest';

import { ok, type AppError, type Result } from '@core/domain/index.js';

import type { DependencyStatus, JobProgress, PhotoFolderRecord, PhotoRecord, PlaceMatch, PlacesPort } from '../ports.js';
import { runPhotoGpsBackfill } from './photos-gps.js';
import { InMemoryFileSystem, InMemoryPhotosStore } from '../../../test/server/usecases/test-fakes.js';

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

const folder: PhotoFolderRecord = {
  folderId: 'path-aaaaaaaa',
  currentPath: '/media/photos',
  displayName: 'photos',
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
  defaultConfigId: null,
};

const photo = (overrides: Partial<PhotoRecord> = {}): PhotoRecord => ({
  fingerprint: 'ph_0000000000000001',
  folderId: folder.folderId,
  fileName: 'a.jpg',
  currentPath: '/media/photos/a.jpg',
  ext: 'jpg',
  size: 1024,
  width: 100,
  height: 100,
  orientation: 1,
  cameraMake: null,
  cameraModel: null,
  lens: null,
  iso: null,
  fNumber: null,
  exposureTime: null,
  exifRating: null,
  capturedAt: null,
  capturedAtSource: null,
  gpsLat: null,
  gpsLon: null,
  gpsSource: null,
  gpsAccuracyM: null,
  gpsIntervalKind: null,
  gpsResolvedAt: null,
  placeName: null,
  placeRegion: null,
  placeCountry: null,
  placeCountryCode: null,
  placeDistanceM: null,
  placeDataset: null,
  discoveredAt: '2026-01-01T00:00:00.000Z',
  exifReadAt: null,
  proxyState: 'done',
  proxyWidth: null,
  proxyHeight: null,
  thumbState: 'done',
  missingAt: null,
  selectedConfigId: null,
  ...overrides,
});

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

describe('runPhotoGpsBackfill', () => {
  it('a camera-sourced photo is never matched but is counted and place-resolved', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addFile('/timeline.json', { content: buildTimeline([visitEntry('2026-01-01T09:00:00Z', '2026-01-01T11:00:00Z', 10, 20)]) });
    const photos = new InMemoryPhotosStore();
    await photos.upsertFolder(folder);
    await photos.upsertPhoto(photo({ gpsLat: 1, gpsLon: 1, gpsSource: 'camera', capturedAt: '2026-01-01T10:00:00.000Z' }));
    const places = new FakePlaces();
    places.installed = true;
    places.matches.set('1.00|1.00', { name: 'Fjordvik', region: null, country: 'Norway', countryCode: 'NO', distanceM: 5, dataset: 'test' });

    const result = await runPhotoGpsBackfill({ fs, photos, places }, { ...baseInput, timelinePath: '/timeline.json' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.skipped.cameraGps).toBe(1);
    expect(result.value.photosConsidered).toBe(0);
    expect(result.value.places.resolved).toBe(1);
    const stored = await photos.getPhoto(photo().fingerprint);
    expect(stored.ok && stored.value?.gpsLat).toBe(1);
    expect(stored.ok && stored.value?.placeName).toBe('Fjordvik');
  });

  it('a manual-sourced photo is fully skipped except place resolution', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addFile('/timeline.json', { content: buildTimeline([visitEntry('2026-01-01T09:00:00Z', '2026-01-01T11:00:00Z', 10, 20)]) });
    const photos = new InMemoryPhotosStore();
    await photos.upsertFolder(folder);
    await photos.upsertPhoto(photo({ gpsLat: 9, gpsLon: 9, gpsSource: 'manual', capturedAt: '2026-01-01T10:00:00.000Z' }));

    const result = await runPhotoGpsBackfill({ fs, photos, places: new FakePlaces() }, { ...baseInput, timelinePath: '/timeline.json' });

    expect(result.ok && result.value.skipped.manualGps).toBe(1);
    expect(result.ok && result.value.photosConsidered).toBe(0);
    const stored = await photos.getPhoto(photo().fingerprint);
    expect(stored.ok && stored.value?.gpsLat).toBe(9);
  });

  it('a timeline match writes provenance and a miss never erases existing GPS', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addFile('/timeline.json', { content: buildTimeline([visitEntry('2026-01-01T09:00:00Z', '2026-01-01T11:00:00Z', 10, 20)]) });
    const photos = new InMemoryPhotosStore();
    await photos.upsertFolder(folder);
    await photos.upsertPhoto(photo({ capturedAt: '2026-01-01T10:00:00.000Z' }));
    await photos.upsertPhoto(photo({
      fingerprint: 'ph_0000000000000002',
      currentPath: '/media/photos/b.jpg',
      fileName: 'b.jpg',
      capturedAt: '2030-01-01T10:00:00.000Z',
    }));

    const result = await runPhotoGpsBackfill({ fs, photos, places: new FakePlaces() }, { ...baseInput, timelinePath: '/timeline.json' });

    expect(result.ok && result.value.matched.visit).toBe(1);
    expect(result.ok && result.value.written).toBe(1);
    expect(result.ok && result.value.unmatched).toBe(1);
    const matched = await photos.getPhoto(photo().fingerprint);
    expect(matched.ok && matched.value?.gpsLat).toBe(10);
    expect(matched.ok && matched.value?.gpsSource).toBe('timeline');
    expect(matched.ok && matched.value?.gpsIntervalKind).toBe('visit');
    const missed = await photos.getPhoto('ph_0000000000000002');
    expect(missed.ok && missed.value?.gpsLat).toBe(null);
  });

  it('an exif_local_assumed row matches only under the widened tolerance and is counted', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addFile('/timeline.json', { content: buildTimeline([visitEntry('2026-01-01T09:00:00Z', '2026-01-01T11:00:00Z', 10, 20)]) });
    const photos = new InMemoryPhotosStore();
    await photos.upsertFolder(folder);
    await photos.upsertPhoto(photo({
      fingerprint: 'ph_assumed',
      currentPath: '/media/photos/assumed.jpg',
      fileName: 'assumed.jpg',
      capturedAtSource: 'exif_local_assumed',
      capturedAt: '2026-01-01T13:30:00.000Z',
    }));
    await photos.upsertPhoto(photo({
      fingerprint: 'ph_offset',
      currentPath: '/media/photos/offset.jpg',
      fileName: 'offset.jpg',
      capturedAtSource: 'exif_offset',
      capturedAt: '2026-01-01T13:30:00.000Z',
    }));

    const result = await runPhotoGpsBackfill({ fs, photos, places: new FakePlaces() }, { ...baseInput, toleranceMinutes: 90, timelinePath: '/timeline.json' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.matched.visit).toBe(1);
    expect(result.value.assumedWidened).toBe(1);
    expect(result.value.unmatched).toBe(1);
    const assumed = await photos.getPhoto('ph_assumed');
    expect(assumed.ok && assumed.value?.gpsLat).toBe(10);
    const offset = await photos.getPhoto('ph_offset');
    expect(offset.ok && offset.value?.gpsLat).toBe(null);
  });

  it('a photo with no captured_at is counted noCapturedAt without touching the store', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addFile('/timeline.json', { content: buildTimeline([visitEntry('2026-01-01T09:00:00Z', '2026-01-01T11:00:00Z', 10, 20)]) });
    const photos = new InMemoryPhotosStore();
    await photos.upsertFolder(folder);
    await photos.upsertPhoto(photo({ capturedAt: null }));

    const result = await runPhotoGpsBackfill({ fs, photos, places: new FakePlaces() }, { ...baseInput, timelinePath: '/timeline.json' });

    expect(result.ok && result.value.skipped.noCapturedAt).toBe(1);
    expect(result.ok && result.value.photosConsidered).toBe(1);
  });

  it('dry run reports matches without writing', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addFile('/timeline.json', { content: buildTimeline([visitEntry('2026-01-01T09:00:00Z', '2026-01-01T11:00:00Z', 10, 20)]) });
    const photos = new InMemoryPhotosStore();
    await photos.upsertFolder(folder);
    await photos.upsertPhoto(photo({ capturedAt: '2026-01-01T10:00:00.000Z' }));

    const result = await runPhotoGpsBackfill({ fs, photos, places: new FakePlaces() }, { ...baseInput, dryRun: true, timelinePath: '/timeline.json' });

    expect(result.ok && result.value.matched.visit).toBe(1);
    expect(result.ok && result.value.written).toBe(0);
    const stored = await photos.getPhoto(photo().fingerprint);
    expect(stored.ok && stored.value?.gpsLat).toBe(null);
  });

  it('fails with file_not_found when the timeline export is missing', async () => {
    const fs = new InMemoryFileSystem('/work');
    const photos = new InMemoryPhotosStore();

    const result = await runPhotoGpsBackfill({ fs, photos, places: new FakePlaces() }, { ...baseInput, timelinePath: '/missing.json' });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('file_not_found');
  });

  it('cancellation between candidates stops the pass with the cancelled-job error', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addFile('/timeline.json', { content: buildTimeline([visitEntry('2026-01-01T09:00:00Z', '2026-01-01T11:00:00Z', 10, 20)]) });
    const photos = new InMemoryPhotosStore();
    await photos.upsertFolder(folder);
    await photos.upsertPhoto(photo({ fingerprint: 'fp-a', currentPath: '/media/photos/a.jpg', capturedAt: '2026-01-01T10:00:00.000Z' }));
    await photos.upsertPhoto(photo({ fingerprint: 'fp-b', currentPath: '/media/photos/b.jpg', fileName: 'b.jpg', capturedAt: '2026-01-01T10:05:00.000Z' }));
    const controller = new AbortController();
    const progress: JobProgress[] = [];

    const result = await runPhotoGpsBackfill({ fs, photos, places: new FakePlaces() }, { ...baseInput, timelinePath: '/timeline.json' }, {
      signal: controller.signal,
      reportProgress: (event) => {
        progress.push(event);
        if (event.step === 'gps_backfill_file') controller.abort();
        return Promise.resolve(ok(undefined));
      },
    });

    expect(result).toMatchObject({ ok: false, error: { message: 'Job cancelled' } });
  });

  it('emits a loaded event, one file event per candidate, and a done event', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addFile('/timeline.json', { content: buildTimeline([visitEntry('2026-01-01T09:00:00Z', '2026-01-01T11:00:00Z', 10, 20)]) });
    const photos = new InMemoryPhotosStore();
    await photos.upsertFolder(folder);
    await photos.upsertPhoto(photo({ capturedAt: '2026-01-01T10:00:00.000Z' }));
    const events: JobProgress[] = [];
    const progress = {
      signal: new AbortController().signal,
      reportProgress: (event: JobProgress): Promise<Result<void, AppError>> => {
        events.push(event);
        return Promise.resolve(ok(undefined));
      },
    };

    await runPhotoGpsBackfill({ fs, photos, places: new FakePlaces() }, { ...baseInput, timelinePath: '/timeline.json' }, progress);

    expect(events.map((event) => event.step)).toEqual(['gps_timeline_loaded', 'gps_backfill_file', 'gps_backfill_done']);
  });
});
