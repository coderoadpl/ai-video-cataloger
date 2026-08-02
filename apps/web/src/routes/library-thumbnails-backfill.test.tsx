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

const stubBaseline = () => {
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

describe('Library collection activation triggers a thumbnails backfill', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('avc.mode', 'library');
    vi.spyOn(bridge.folder, 'getCurrent').mockResolvedValue(FOLDER);
    vi.spyOn(bridge.folder, 'getRecent').mockResolvedValue([FOLDER]);
    stubBaseline();
  });

  it('requests the existing-thumbnails backfill for the open folder once when the Kolekcja surface activates', async () => {
    const backfillRequests: unknown[] = [];
    server.use(
      http.post('/api/thumbnails', async ({ request }) => {
        backfillRequests.push(await request.json());
        return HttpResponse.json({ ok: true, data: { jobId: 'job-1' } });
      }),
    );

    renderRoute();

    await screen.findByTestId('library-empty-catalog');
    await waitFor(() => expect(backfillRequests).toHaveLength(1));
    expect(backfillRequests[0]).toMatchObject({ root: FOLDER, force: false });
  });
});
