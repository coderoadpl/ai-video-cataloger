import { ThemeProvider } from '@mui/material/styles';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

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

const findTileThumbnail = async (name: string): Promise<HTMLImageElement> => {
  const tile = await screen.findByRole('option', { name });
  let image: HTMLImageElement | null = null;
  await waitFor(() => {
    image = tile.querySelector('img');
    expect(image).not.toBeNull();
  });
  if (image === null) throw new Error(`tile ${name} renders no thumbnail image`);
  return image;
};

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

const stubVideoCollection = (items: () => Record<string, unknown>[]) => {
  stubBaseline([]);
  const request = vi.fn(() => {
    const videos = items();
    return HttpResponse.json({
      ok: true,
      data: {
        query: null,
        media: 'all',
        limit: 200,
        total: videos.length,
        videoTotal: videos.length,
        photoTotal: 0,
        mediaTotals: { all: videos.length, video: videos.length, photo: 0 },
        count: videos.length,
        items: videos,
        nextCursor: null,
      },
    });
  });
  server.use(http.get('/api/library/collection', request));
  return request;
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

  it('replaces the small video thumbnail after its grid backfill completes', async () => {
    const completed = deferred<boolean>();
    let gridThumbReady = false;
    const thumbnailPath = `${FOLDER}/.ai-video-cataloger/thumbnails/clip.jpg`;
    const gridThumbnailPath = `${FOLDER}/.ai-video-cataloger/thumbnails/clip.grid.jpg`;
    const collection = stubVideoCollection(() => [searchResult({
      thumbnailPath,
      gridThumbnailPath: gridThumbReady ? gridThumbnailPath : null,
    })]);
    server.use(
      http.post('/api/thumbnails', () => HttpResponse.json({ ok: true, data: { jobId: 'job-video-grid' } })),
      http.get('/api/jobs/status', async () => {
        await completed.promise;
        return HttpResponse.json({
          ok: true,
          data: { ...completedPhotoGridJob('job-video-grid'), kind: 'thumbnails' },
        });
      }),
    );

    renderRoute();

    const image = await findTileThumbnail('clip.mp4');
    expect(decodeURIComponent(image.getAttribute('src') ?? '')).toContain(thumbnailPath);
    expect(collection).toHaveBeenCalledTimes(1);
    gridThumbReady = true;
    completed.resolve(true);

    await waitFor(() => expect(decodeURIComponent(image.getAttribute('src') ?? '')).toContain(gridThumbnailPath));
    expect(collection).toHaveBeenCalledTimes(2);
  });

  it('keeps another folder polling when the first completed backfill refreshes the collection', async () => {
    const firstCompleted = deferred<boolean>();
    const secondCompleted = deferred<boolean>();
    const started: string[] = [];
    const ready = new Set<string>();
    const collection = stubVideoCollection(() => [FOLDER, OTHER_FOLDER].map((folder, index) => searchResult({
      fingerprint: `fp-${String(index)}`,
      fileName: `clip-${String(index)}.mp4`,
      thumbnailPath: `${folder}/clip.jpg`,
      gridThumbnailPath: ready.has(folder) ? `${folder}/clip.grid.jpg` : null,
      folder: {
        folderId: index === 0 ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222',
        currentPath: folder,
        displayName: folder,
        online: true,
      },
    })));
    const backfills: unknown[] = [];
    server.use(
      http.post('/api/thumbnails', async ({ request }) => {
        const input = z.object({ root: z.string(), force: z.boolean() }).parse(await request.json());
        backfills.push(input);
        const first = input.root === FOLDER;
        return HttpResponse.json({ ok: true, data: { jobId: first ? 'job-first' : 'job-second' } });
      }),
      http.get('/api/jobs/status', async ({ request }) => {
        const jobId = new URL(request.url).searchParams.get('jobId') ?? '';
        started.push(jobId);
        await (jobId === 'job-first' ? firstCompleted.promise : secondCompleted.promise);
        return HttpResponse.json({ ok: true, data: { ...completedPhotoGridJob(jobId), kind: 'thumbnails' } });
      }),
    );

    renderRoute();

    await waitFor(() => expect(started).toEqual(expect.arrayContaining(['job-first', 'job-second'])));
    const firstImage = await findTileThumbnail('clip-0.mp4');
    const secondImage = await findTileThumbnail('clip-1.mp4');
    ready.add(FOLDER);
    firstCompleted.resolve(true);
    await waitFor(() => expect(decodeURIComponent(firstImage.getAttribute('src') ?? '')).toContain(`${FOLDER}/clip.grid.jpg`));
    expect(decodeURIComponent(secondImage.getAttribute('src') ?? '')).toContain(`${OTHER_FOLDER}/clip.jpg`);
    ready.add(OTHER_FOLDER);
    secondCompleted.resolve(true);
    await waitFor(() => expect(decodeURIComponent(secondImage.getAttribute('src') ?? '')).toContain(`${OTHER_FOLDER}/clip.grid.jpg`));
    expect(collection).toHaveBeenCalledTimes(3);
    expect(backfills).toHaveLength(2);
  });

  it('produces no post-unmount invalidation while video backfill polling is pending', async () => {
    const statusStarted = deferred<boolean>();
    const statusCompleted = deferred<boolean>();
    stubBaseline([searchResult({ gridThumbnailPath: null })]);
    server.use(
      http.post('/api/thumbnails', () => HttpResponse.json({ ok: true, data: { jobId: 'job-video-unmount' } })),
      http.get('/api/jobs/status', async () => {
        statusStarted.resolve(true);
        await statusCompleted.promise;
        return HttpResponse.json({ ok: true, data: { ...completedPhotoGridJob('job-video-unmount'), kind: 'thumbnails' } });
      }),
    );
    const rendered = renderRoute();
    const invalidate = vi.spyOn(rendered.queryClient, 'invalidateQueries');

    await statusStarted.promise;
    rendered.unmount();
    const callsAtUnmount = invalidate.mock.calls.length;
    statusCompleted.resolve(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(invalidate).toHaveBeenCalledTimes(callsAtUnmount);
  });

  it('refetches video tiles when a completed backfill disappears before status polling', async () => {
    let gridThumbReady = false;
    const collection = stubVideoCollection(() => [searchResult({
      thumbnailPath: `${FOLDER}/clip.jpg`,
      gridThumbnailPath: gridThumbReady ? `${FOLDER}/clip.grid.jpg` : null,
    })]);
    server.use(
      http.post('/api/thumbnails', () => {
        gridThumbReady = true;
        return HttpResponse.json({ ok: true, data: { jobId: 'job-video-gone' } });
      }),
      http.get('/api/jobs/status', () => HttpResponse.json(
        { ok: false, error: { code: 'not_found', message: 'Job not found' } },
        { status: 404 },
      )),
    );

    renderRoute();

    const image = await findTileThumbnail('clip.mp4');
    await waitFor(() => expect(decodeURIComponent(image.getAttribute('src') ?? '')).toContain(`${FOLDER}/clip.grid.jpg`));
    expect(collection).toHaveBeenCalledTimes(2);
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

    const image = await findTileThumbnail('photo.jpg');
    expect(decodeURIComponent(image.getAttribute('src') ?? '')).toContain('/artifacts/grid-thumbs/ph_0000000000000001.jpg');
    expect(collectionRequests).toBe(2);
  });

  it('produces no post-unmount invalidation while photo backfill polling is pending', async () => {
    const statusStarted = deferred<boolean>();
    const statusCompleted = deferred<boolean>();
    stubBaseline([]);
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
          items: [photoResult()],
          nextCursor: null,
        },
      })),
      http.post('/api/photos/grid-thumbs', () => HttpResponse.json({ ok: true, data: { jobId: 'job-photo-unmount' } })),
      http.get('/api/jobs/status', async () => {
        statusStarted.resolve(true);
        await statusCompleted.promise;
        return HttpResponse.json({ ok: true, data: completedPhotoGridJob('job-photo-unmount') });
      }),
    );
    const rendered = renderRoute();
    const invalidate = vi.spyOn(rendered.queryClient, 'invalidateQueries');

    await statusStarted.promise;
    rendered.unmount();
    const callsAtUnmount = invalidate.mock.calls.length;
    statusCompleted.resolve(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(invalidate).toHaveBeenCalledTimes(callsAtUnmount);
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
    const image = await findTileThumbnail('photo.jpg');
    expect(decodeURIComponent(image.getAttribute('src') ?? '')).toContain('/artifacts/grid-thumbs/ph_0000000000000001.jpg');
    expect(collectionRequests).toBe(2);
  });
});
