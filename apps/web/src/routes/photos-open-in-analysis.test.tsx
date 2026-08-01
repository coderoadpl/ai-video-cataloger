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
          photos: 1,
          paths: 1,
          exifRead: 1,
          exifFailed: 0,
          missing: 0,
          duplicates: 0,
          proxied: 1,
          proxyFailed: 0,
          analysed: 1,
          facesIndexed: 0,
        },
      },
    })),
    http.get('/api/photos/tree', () => HttpResponse.json({
      ok: true,
      data: { media: 'photo', roots: [{ root: '/pictures', photos: 1, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' }] },
    })),
    http.get('/api/photos/list', () => HttpResponse.json({
      ok: true,
      data: { media: 'photo', root: '/pictures', total: 1, offset: 0, items: [photo('ph_0000000000000001')] },
    })),
    http.get('/api/photos/detail', ({ request }) => {
      const fingerprint = new URL(request.url).searchParams.get('fingerprint') ?? '';
      const item = photo(fingerprint);
      return HttpResponse.json({
        ok: true,
        data: {
          media: 'photo',
          photo: {
            fingerprint: item.fingerprint,
            folderId: 'folder-1',
            fileName: item.fileName,
            currentPath: item.currentPath,
            ext: item.ext,
            size: 1024,
            width: item.width,
            height: item.height,
            orientation: null,
            cameraMake: null,
            cameraModel: null,
            lens: null,
            iso: null,
            fNumber: null,
            exposureTime: null,
            exifRating: null,
            capturedAt: item.capturedAt,
            capturedAtSource: item.capturedAtSource,
            discoveredAt: '2026-01-01T00:00:00.000Z',
            exifReadAt: item.exifReadAt,
            proxyState: item.proxyState,
            proxyWidth: null,
            proxyHeight: null,
            thumbState: item.thumbState,
            missingAt: item.missingAt,
          },
          sightings: [{ currentPath: item.currentPath, folderId: 'folder-1', lastSeenAt: '2026-01-01T00:00:00.000Z' }],
          ownerPath: item.currentPath,
          proxyPath: item.proxyPath,
          thumbPath: item.thumbPath,
          gridThumbPath: item.gridThumbPath,
          analysis: null,
        },
      });
    }),
    http.get('/api/photos/variants', ({ request }) => {
      const fingerprint = new URL(request.url).searchParams.get('fingerprint') ?? '';
      return HttpResponse.json({
        ok: true,
        data: { media: 'photo', fingerprint, selectedConfigId: null, variants: [] },
      });
    }),
  );
};

describe('Library > Zdjęcia "Otwórz w Analizie" escape hatch', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('avc.mode', 'library');
    window.localStorage.setItem('avc.librarySurface', 'photos');
    vi.spyOn(bridge.folder, 'getCurrent').mockResolvedValue(null);
    vi.spyOn(bridge.folder, 'getRecent').mockResolvedValue([]);
    stubBaseline();
  });

  it('switches to Analysis > Zdjęcia with the photo folder and photo selected, instead of Analysis > Filmy', async () => {
    renderRoute();

    const tiles = await screen.findAllByTestId('photos-tile');
    fireEvent.click(tiles[0] ?? (() => { throw new Error('missing tile'); })());

    const link = await screen.findByTestId('photos-open-analysis');
    fireEvent.click(link);

    await waitFor(() => expect(screen.getByTestId('photos-analysis-detail')).toBeDefined());
    const rows = await screen.findAllByTestId('photos-sidebar-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.className).toContain('Mui-selected');
  });
});
