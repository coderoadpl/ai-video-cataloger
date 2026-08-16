import { ThemeProvider } from '@mui/material/styles';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { bridge } from '../api.js';
import { renderWithProviders } from '../test/render.js';
import { server } from '../test/server.js';
import { createAppTheme } from '../theme.js';
import { IndexRoute } from './index.js';

const theme = createAppTheme('light');
const renderRoute = () => renderWithProviders(<ThemeProvider theme={theme}><IndexRoute /></ThemeProvider>);

const FOLDER = '/movies';
const OTHER_FOLDER = '/movies/holidays';

const searchResult = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  media: 'video',
  fingerprint: 'fp-1',
  variantCount: 1,
  fileName: 'clip.mp4',
  finalName: null,
  description: null,
  snippet: '',
  thumbnailPath: null,
  gridThumbnailPath: `${FOLDER}/.ai-video-cataloger/thumbnails/clip.grid.jpg`,
  tags: [],
  folder: { folderId: '11111111-1111-4111-8111-111111111111', currentPath: FOLDER, displayName: 'movies', online: true },
  gps: null,
  missing: false,
  capturedAt: null,
  place: null,
  width: null,
  height: null,
  ...overrides,
});

const photoResult = (): Record<string, unknown> => ({
  media: 'photo',
  fingerprint: 'ph_0000000000000001',
  fileName: 'photo.jpg',
  currentPath: '/photos/photo.jpg',
  ext: 'jpg',
  capturedAt: '2026-01-02T10:00:00.000Z',
  description: null,
  snippet: '',
  tags: [],
  variantCount: 1,
  missingAt: null,
  thumbPath: '/artifacts/thumbs/ph_0000000000000001.jpg',
  gridThumbPath: null,
  proxyPath: '/artifacts/proxies/ph_0000000000000001.jpg',
});

const completedPhotoGridJob = (jobId: string) => ({
  jobId,
  kind: 'photo_grid_thumbs',
  status: 'completed',
  progress: null,
  progressEvents: [],
  error: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:01.000Z',
});

const deferred = <T,>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolver: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promise, resolve: resolver };
};

const stubBaseline = (items: Record<string, unknown>[] = []) => {
  server.use(
    http.get('/api/scan', () => HttpResponse.json({
      ok: true,
      data: {
        folder: FOLDER,
        databasePath: `${FOLDER}/.ai-video-cataloger/catalog.db`,
        videos: [],
        summary: { total: 0, tracked: 0, pending: 0, inProgress: 0, completed: 0, error: 0, notTracked: 0 },
      },
    })),
    http.get('/api/photos/tree', () => HttpResponse.json({ ok: true, data: { media: 'photo', roots: [] } })),
    http.get('/api/photos/list', () => HttpResponse.json({
      ok: true,
      data: { media: 'photo', root: null, total: 0, offset: 0, items: [] },
    })),
    http.get('/api/library/collection', () => HttpResponse.json({
      ok: true,
      data: {
        query: null,
        media: 'all',
        limit: 200,
        total: items.length,
        videoTotal: items.length,
        photoTotal: 0,
        mediaTotals: { all: items.length, video: items.length, photo: 0 },
        count: items.length,
        items,
        nextCursor: null,
      },
    })),
    http.get('/api/library/facets', () => HttpResponse.json({
      ok: true,
      data: {
        tags: [],
        people: [],
        places: [],
        years: [],
        folders: [],
        counts: { total: 0, withGps: 0, withoutCaptureDate: 0, missing: 0, offlineFolders: 0 },
      },
    })),
  );
};

describe('Library collection activation triggers a thumbnails backfill', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('avc.mode', 'library');
    vi.spyOn(bridge.folder, 'getCurrent').mockResolvedValue(FOLDER);
    vi.spyOn(bridge.folder, 'getRecent').mockResolvedValue([FOLDER]);
  });

  it('never requests a backfill for an empty Kolekcja grid, regardless of which folder is currently open', async () => {
    stubBaseline([]);
    const backfillRequests: unknown[] = [];
    server.use(
      http.post('/api/thumbnails', async ({ request }) => {
        backfillRequests.push(await request.json());
        return HttpResponse.json({ ok: true, data: { jobId: 'job-1' } });
      }),
    );

    renderRoute();

    await screen.findByTestId('library-empty-catalog');
    expect(backfillRequests).toHaveLength(0);
  });

  it('backfills every distinct online folder that contributed a visible tile, once each', async () => {
    stubBaseline([
      searchResult({ fingerprint: 'fp-1', fileName: 'clip.mp4' }),
      searchResult({
        fingerprint: 'fp-2',
        fileName: 'beach.mp4',
        gridThumbnailPath: `${OTHER_FOLDER}/.ai-video-cataloger/thumbnails/beach.grid.jpg`,
        folder: { folderId: '22222222-2222-4222-8222-222222222222', currentPath: OTHER_FOLDER, displayName: 'holidays', online: true },
      }),
      searchResult({ fingerprint: 'fp-3', fileName: 'clip2.mp4' }),
    ]);
    const backfillRequests: unknown[] = [];
    server.use(
      http.post('/api/thumbnails', async ({ request }) => {
        backfillRequests.push(await request.json());
        return HttpResponse.json({ ok: true, data: { jobId: 'job-1' } });
      }),
    );

    renderRoute();

    await screen.findAllByTestId('library-tile');
    await waitFor(() => expect(backfillRequests).toHaveLength(2));
    expect(backfillRequests).toEqual(
      expect.arrayContaining([
        { root: FOLDER, force: false },
        { root: OTHER_FOLDER, force: false },
      ]),
    );
  });

  it('backfills a folder whose visible tile still falls back to the small cover, the blurriest case of all', async () => {
    stubBaseline([searchResult({ gridThumbnailPath: null })]);
    const backfillRequests: unknown[] = [];
    server.use(
      http.post('/api/thumbnails', async ({ request }) => {
        backfillRequests.push(await request.json());
        return HttpResponse.json({ ok: true, data: { jobId: 'job-1' } });
      }),
    );

    renderRoute();

    await screen.findByTestId('library-tile');
    await waitFor(() => expect(backfillRequests).toEqual([{ root: FOLDER, force: false }]));
  });

  it('never backfills an offline folder, whose files cannot be read at all', async () => {
    stubBaseline([
      searchResult({
        gridThumbnailPath: null,
        folder: { folderId: '33333333-3333-4333-8333-333333333333', currentPath: OTHER_FOLDER, displayName: 'holidays', online: false },
      }),
    ]);
    const backfillRequests: unknown[] = [];
    server.use(
      http.post('/api/thumbnails', async ({ request }) => {
        backfillRequests.push(await request.json());
        return HttpResponse.json({ ok: true, data: { jobId: 'job-1' } });
      }),
    );

    renderRoute();

    await screen.findByTestId('library-tile');
    expect(backfillRequests).toHaveLength(0);
  });

  it('moves the photo grid-thumbs backfill trigger to Kolekcja', async () => {
    stubBaseline([]);
    const item = photoResult();
    const backfillRequests: unknown[] = [];
    server.use(
      http.get('/api/photos/tree', () => HttpResponse.json({
        ok: true,
        data: { media: 'photo', roots: [{ root: '/photos', photos: 1, missing: 0, lastScanAt: '2026-01-02T10:00:00.000Z' }] },
      })),
      http.get('/api/library/collection', () => HttpResponse.json({
        ok: true,
        data: {
          query: null,
          media: 'all',
          limit: 200,
          total: 1,
          videoTotal: 0,
          photoTotal: 1,
          mediaTotals: { all: 1, video: 0, photo: 1 },
          count: 1,
          items: [item],
          nextCursor: null,
        },
      })),
      http.post('/api/photos/grid-thumbs', async ({ request }) => {
        backfillRequests.push(await request.json());
        return HttpResponse.json({ ok: true, data: { jobId: 'job-photo-thumbs' } });
      }),
      http.get('/api/jobs/status', () => HttpResponse.json({ ok: true, data: completedPhotoGridJob('job-photo-thumbs') })),
    );

    renderRoute();

    await screen.findByTestId('library-tile');
    await waitFor(() => expect(backfillRequests).toEqual([{ force: false }]));
  });

  it('refetches the collection after the photo grid-thumb job completes', async () => {
    const completed = deferred<boolean>();
    let collectionRequests = 0;
    let gridThumbReady = false;
    stubBaseline([]);
    server.use(
      http.get('/api/photos/tree', () => HttpResponse.json({
        ok: true,
        data: { media: 'photo', roots: [{ root: '/photos', photos: 1, missing: 0, lastScanAt: '2026-01-02T10:00:00.000Z' }] },
      })),
      http.get('/api/library/collection', () => {
        collectionRequests += 1;
        return HttpResponse.json({
          ok: true,
          data: {
            query: null,
            media: 'all',
            limit: 200,
            total: 1,
            videoTotal: 0,
            photoTotal: 1,
            mediaTotals: { all: 1, video: 0, photo: 1 },
            count: 1,
            items: [{
              ...photoResult(),
              thumbPath: null,
              gridThumbPath: gridThumbReady ? '/artifacts/grid-thumbs/ph_0000000000000001.jpg' : null,
            }],
            nextCursor: null,
          },
        });
      }),
      http.post('/api/photos/grid-thumbs', () => HttpResponse.json({ ok: true, data: { jobId: 'job-photo-race' } })),
      http.get('/api/jobs/status', async () => {
        await completed.promise;
        gridThumbReady = true;
        return HttpResponse.json({
          ok: true,
          data: completedPhotoGridJob('job-photo-race'),
        });
      }),
    );

    renderRoute();

    await screen.findByTestId('library-tile-placeholder');
    expect(collectionRequests).toBe(1);
    completed.resolve(true);

    const image = await screen.findByRole('img', { name: 'photo.jpg' });
    expect(decodeURIComponent(image.getAttribute('src') ?? '')).toContain('/artifacts/grid-thumbs/ph_0000000000000001.jpg');
    expect(collectionRequests).toBe(2);
  });

  it('refetches photo tiles when a completed backfill disappears before status polling', async () => {
    let collectionRequests = 0;
    let gridThumbReady = false;
    stubBaseline([]);
    server.use(
      http.get('/api/photos/tree', () => HttpResponse.json({
        ok: true,
        data: { media: 'photo', roots: [{ root: '/photos', photos: 1, missing: 0, lastScanAt: '2026-01-02T10:00:00.000Z' }] },
      })),
      http.get('/api/library/collection', () => {
        collectionRequests += 1;
        return HttpResponse.json({
          ok: true,
          data: {
            query: null,
            media: 'all',
            limit: 200,
            total: 1,
            videoTotal: 0,
            photoTotal: 1,
            mediaTotals: { all: 1, video: 0, photo: 1 },
            count: 1,
            items: [{
              ...photoResult(),
              thumbPath: null,
              gridThumbPath: gridThumbReady ? '/artifacts/grid-thumbs/ph_0000000000000001.jpg' : null,
            }],
            nextCursor: null,
          },
        });
      }),
      http.post('/api/photos/grid-thumbs', () => {
        gridThumbReady = true;
        return HttpResponse.json({ ok: true, data: { jobId: 'job-photo-gone' } });
      }),
      http.get('/api/jobs/status', () => HttpResponse.json(
        { ok: false, error: { code: 'not_found', message: 'Job not found' } },
        { status: 404 },
      )),
    );

    renderRoute();

    await screen.findByTestId('library-tile-placeholder');
    const image = await screen.findByRole('img', { name: 'photo.jpg' });
    expect(decodeURIComponent(image.getAttribute('src') ?? '')).toContain('/artifacts/grid-thumbs/ph_0000000000000001.jpg');
    expect(collectionRequests).toBe(2);
  });
});
