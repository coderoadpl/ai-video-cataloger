import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { bridge } from '../api.js';
import { renderWithProviders } from '../test/render.js';
import { server } from '../test/server.js';
import { createAppTheme } from '../theme.js';
import { IndexRoute } from './index.js';

const theme = createAppTheme('light');
const renderRoute = () => renderWithProviders(<ThemeProvider theme={theme}><IndexRoute /></ThemeProvider>);

const photo = (fingerprint: string) => ({
  fingerprint,
  fileName: `${fingerprint}.jpg`,
  currentPath: `/pictures/${fingerprint}.jpg`,
  ext: 'jpg',
  capturedAt: '2026-01-01T00:00:00.000Z',
  capturedAtSource: 'exif_offset',
  width: 100,
  height: 100,
  proxyState: 'done',
  thumbState: 'done',
  missingAt: null,
  sightings: 1,
  thumbPath: `/artifacts/thumbs/${fingerprint}.jpg`,
  gridThumbPath: null,
  proxyPath: `/artifacts/proxies/${fingerprint}.jpg`,
  analysed: true,
  exifReadAt: '2026-01-01T00:00:00.000Z',
});

const stubBaseline = () => {
  server.use(
    http.get('/api/scan', () => HttpResponse.json({
      ok: true,
      data: {
        folder: '/movies',
        databasePath: '/movies/.ai-video-cataloger/catalog.db',
        videos: [],
        summary: { total: 0, tracked: 0, pending: 0, inProgress: 0, completed: 0, error: 0, notTracked: 0 },
      },
    })),
    http.get('/api/photos/status', () => HttpResponse.json({
      ok: true,
      data: {
        media: 'photo',
        root: '/pictures',
        counts: {
          photos: 2,
          paths: 2,
          exifRead: 2,
          exifFailed: 0,
          missing: 0,
          duplicates: 0,
          proxied: 2,
          proxyFailed: 0,
          analysed: 2,
          facesIndexed: 0,
        },
      },
    })),
    http.get('/api/photos/tree', () => HttpResponse.json({
      ok: true,
      data: { media: 'photo', roots: [{ root: '/pictures', photos: 2, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' }] },
    })),
    http.get('/api/photos/list', () => HttpResponse.json({
      ok: true,
      data: { media: 'photo', root: '/pictures', total: 2, offset: 0, items: [photo('ph_0000000000000001'), photo('ph_0000000000000002')] },
    })),
  );
};

describe('selecting a photo from the Analysis photos sidebar', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('avc.mode', 'analysis');
    window.localStorage.setItem('avc.analysisMedia', 'photos');
    vi.spyOn(bridge.folder, 'getCurrent').mockResolvedValue('/movies');
    vi.spyOn(bridge.folder, 'getRecent').mockResolvedValue(['/movies']);
    stubBaseline();
  });

  it('selects the photo in the workspace without opening the full-screen viewer', async () => {
    renderRoute();

    const rows = await screen.findAllByTestId('photos-sidebar-row');
    const firstRow = rows[0];
    if (firstRow === undefined) throw new Error('missing sidebar row');
    fireEvent.click(firstRow);

    await waitFor(() => expect(screen.getAllByTestId('photos-tile').length).toBe(2));
    expect(screen.queryByTestId('photos-viewer')).toBeNull();
  });

  it('keeps the viewer closed when the route re-renders after a selection', async () => {
    renderRoute();

    const rows = await screen.findAllByTestId('photos-sidebar-row');
    const firstRow = rows[0];
    if (firstRow === undefined) throw new Error('missing sidebar row');
    fireEvent.click(firstRow);
    fireEvent.click(screen.getByTestId('photos-scope-all'));

    await waitFor(() => expect(screen.getByTestId('photos-scope-all').getAttribute('aria-pressed')).toBe('true'));
    expect(screen.queryByTestId('photos-viewer')).toBeNull();
  });
});
