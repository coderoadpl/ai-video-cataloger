import { ThemeProvider } from '@mui/material/styles';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { bridge } from '../api.js';
import { en } from '../i18n/dictionary.js';
import { renderWithProviders } from '../test/render.js';
import { server } from '../test/server.js';
import { createAppTheme } from '../theme.js';
import { IndexRoute } from './index.js';

const theme = createAppTheme('light');
const renderRoute = () => renderWithProviders(<ThemeProvider theme={theme}><IndexRoute /></ThemeProvider>);

const scanResponse = () => ({
  folder: '/movies',
  databasePath: '/movies/.ai-video-cataloger/catalog.db',
  videos: [{
    path: '/movies/clip.mp4',
    filename: 'clip.mp4',
    size: 1024,
    sizeFormatted: '1 KB',
    duration: 10,
    durationFormatted: '0:10',
    status: 'completed',
    contentHash: 'hash-1',
    artifacts: {
      framePaths: null,
      transcriptContent: null,
      transcriptPath: null,
      summary: null,
      summaryPath: null,
      thumbnailPath: null,
      thumbnailMtime: null,
      newFilename: null,
    },
  }],
  summary: { total: 1, tracked: 1, pending: 0, inProgress: 0, completed: 1, error: 0, notTracked: 0 },
});

const stubBaseline = (onScan: () => void = () => undefined) => {
  server.use(
    http.get('/api/scan', () => HttpResponse.json({ ok: true, data: scanResponse() })),
    http.get('/api/photos/tree', () => HttpResponse.json({ ok: true, data: { media: 'photo', roots: [] } })),
    http.get('/api/photos/list', () => HttpResponse.json({ ok: true, data: { media: 'photo', root: null, total: 0, offset: 0, items: [] } })),
    http.post('/api/photos/scan', () => {
      onScan();
      return HttpResponse.json({ ok: true, data: { jobId: 'job-auto-scan' } });
    }),
    http.get('/api/jobs/status', () => HttpResponse.json({
      ok: true,
      data: {
        jobId: 'job-auto-scan',
        kind: 'photo_scan',
        status: 'completed',
        progress: null,
        progressEvents: [],
        error: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    })),
  );
};

const stubScannedEmptyAfterScan = () => {
  let scanned = false;
  server.use(
    http.get('/api/scan', () => HttpResponse.json({ ok: true, data: scanResponse() })),
    http.get('/api/photos/tree', () => HttpResponse.json({
      ok: true,
      data: {
        media: 'photo',
        roots: scanned ? [{ root: '/movies', photos: 0, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' }] : [],
      },
    })),
    http.get('/api/photos/list', () => HttpResponse.json({ ok: true, data: { media: 'photo', root: null, total: 0, offset: 0, items: [] } })),
    http.get('/api/photos/status', ({ request }) => HttpResponse.json({
      ok: true,
      data: {
        media: 'photo',
        root: new URL(request.url).searchParams.get('root'),
        counts: {
          photos: 0,
          paths: 0,
          exifRead: 0,
          exifFailed: 0,
          missing: 0,
          duplicates: 0,
          proxied: 0,
          proxyFailed: 0,
          analysed: 0,
          facesIndexed: 0,
        },
      },
    })),
    http.post('/api/photos/scan', () => {
      scanned = true;
      return HttpResponse.json({ ok: true, data: { jobId: 'job-auto-scan' } });
    }),
    http.get('/api/jobs/status', () => HttpResponse.json({
      ok: true,
      data: {
        jobId: 'job-auto-scan',
        kind: 'photo_scan',
        status: 'completed',
        progress: null,
        progressEvents: [],
        error: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    })),
  );
};

describe('Analysis sidebar with Zdjęcia active and no scanned photo roots', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('avc.mode', 'analysis');
    window.localStorage.setItem('avc.analysisMedia', 'photos');
    vi.spyOn(bridge.folder, 'getCurrent').mockResolvedValue('/movies');
    vi.spyOn(bridge.folder, 'getRecent').mockResolvedValue(['/movies']);
  });

  it('auto-starts the folder scan and shows the honest scanning sidebar, never the video list or a CTA', async () => {
    let scanCalls = 0;
    stubBaseline(() => { scanCalls += 1; });
    renderRoute();

    expect(await screen.findByTestId('photos-sidebar-unscanned')).toBeDefined();
    await waitFor(() => expect(scanCalls).toBe(1));
    expect(screen.queryByTestId('photos-scan-action')).toBeNull();
    expect(screen.queryByTestId('video-item')).toBeNull();
    expect(screen.queryByTestId('folder-show-in-library')).toBeNull();
  });

  it('lands on the honest empty state, not a scan prompt, once the auto-scan finds no photos in the folder', async () => {
    stubScannedEmptyAfterScan();
    renderRoute();

    await screen.findByTestId('photos-sidebar-unscanned');

    await waitFor(() => expect(screen.getByText(en.photos.emptyNoPhotos)).toBeDefined());
    expect(screen.queryByTestId('photos-sidebar-unscanned')).toBeNull();
    expect(screen.queryByTestId('photos-sidebar-row')).toBeNull();
  });

  it('swaps the sidebar between videos and photos content on the media toggle, and does not re-fire the scan on the second visit', async () => {
    let scanCalls = 0;
    stubBaseline(() => { scanCalls += 1; });
    renderRoute();
    await screen.findByTestId('photos-sidebar-unscanned');
    await waitFor(() => expect(scanCalls).toBe(1));

    (await screen.findByTestId('analysis-media-videos')).click();

    await waitFor(() => expect(screen.getAllByTestId('video-item').length).toBeGreaterThan(0));
    expect(screen.queryByTestId('photos-sidebar-unscanned')).toBeNull();

    (await screen.findByTestId('analysis-media-photos')).click();

    await waitFor(() => expect(screen.getByTestId('photos-sidebar-unscanned')).toBeDefined());
    expect(screen.queryByTestId('video-item')).toBeNull();
    expect(scanCalls).toBe(1);
  });
});
