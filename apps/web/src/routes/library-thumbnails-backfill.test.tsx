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
  ...overrides,
});

const stubBaseline = (results: Record<string, unknown>[] = []) => {
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
    http.get('/api/search', () => HttpResponse.json({
      ok: true,
      data: { query: null, limit: 200, offset: 0, count: results.length, total: results.length, results },
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
});
