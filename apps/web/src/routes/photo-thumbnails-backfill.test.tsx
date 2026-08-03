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

const photoItem = (fingerprint: string) => ({
  fingerprint,
  fileName: `${fingerprint}.jpg`,
  currentPath: `/photos/${fingerprint}.jpg`,
  ext: 'jpg',
  capturedAt: null,
  capturedAtSource: null,
  width: 800,
  height: 600,
  proxyState: 'done',
  thumbState: 'done',
  missingAt: null,
  sightings: 1,
  thumbPath: `/artifacts/thumbs/${fingerprint}.jpg`,
  gridThumbPath: null,
  proxyPath: `/artifacts/proxies/${fingerprint}.jpg`,
  analysed: false,
  exifReadAt: null,
});

const stubBaseline = (input: {
  roots?: { root: string; photos: number; missing: number; lastScanAt: string }[];
  items?: ReturnType<typeof photoItem>[];
} = {}) => {
  const items = input.items ?? [];
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
    http.get('/api/photos/tree', () => HttpResponse.json({ ok: true, data: { media: 'photo', roots: input.roots ?? [] } })),
    http.get('/api/photos/list', () => HttpResponse.json({
      ok: true,
      data: { media: 'photo', root: null, total: items.length, offset: 0, items },
    })),
    http.get('/api/search', () => HttpResponse.json({
      ok: true,
      data: { query: null, limit: 200, offset: 0, count: 0, total: 0, results: [] },
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

describe('Library photos surface triggers a photo grid-thumbs backfill', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('avc.mode', 'library');
    window.localStorage.setItem('avc.librarySurface', 'photos');
    vi.spyOn(bridge.folder, 'getCurrent').mockResolvedValue(FOLDER);
    vi.spyOn(bridge.folder, 'getRecent').mockResolvedValue([FOLDER]);
  });

  it('never requests a backfill when there are no photo roots yet', async () => {
    stubBaseline({ roots: [], items: [] });
    const requests: unknown[] = [];
    server.use(
      http.post('/api/photos/grid-thumbs', async ({ request }) => {
        requests.push(await request.json());
        return HttpResponse.json({ ok: true, data: { jobId: 'job-1' } });
      }),
    );

    renderRoute();

    await screen.findByTestId('photos-empty-no-roots');
    expect(requests).toHaveLength(0);
  });

  it('requests exactly one backfill, unforced, once a photo root is visible', async () => {
    stubBaseline({
      roots: [{ root: '/photos', photos: 1, missing: 0, lastScanAt: '2024-03-02T10:00:00.000Z' }],
      items: [photoItem('ph_0000000000000001')],
    });
    const requests: unknown[] = [];
    server.use(
      http.post('/api/photos/grid-thumbs', async ({ request }) => {
        requests.push(await request.json());
        return HttpResponse.json({ ok: true, data: { jobId: 'job-1' } });
      }),
    );

    renderRoute();

    await screen.findAllByTestId('photos-tile');
    await waitFor(() => expect(requests).toEqual([{ force: false }]));
  });
});
