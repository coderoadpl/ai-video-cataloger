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

const stubScan = (folder: string) => {
  server.use(http.get('/api/scan', () => HttpResponse.json({
    ok: true,
    data: {
      folder,
      databasePath: `${folder}/.ai-video-cataloger/catalog.db`,
      videos: [],
      summary: { total: 0, tracked: 0, pending: 0, inProgress: 0, completed: 0, error: 0, notTracked: 0 },
    },
  })));
};

const stubPhotosStatus = () => {
  server.use(http.get('/api/photos/status', ({ request }) => HttpResponse.json({
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
  })));
};

const stubPhotosTree = (roots: { root: string; photos: number; missing: number; lastScanAt: string }[]) => {
  server.use(http.get('/api/photos/tree', () => HttpResponse.json({ ok: true, data: { media: 'photo', roots } })));
};

const stubPhotosList = (byRoot: Record<string, { fingerprint: string; currentPath: string; fileName: string }[]>) => {
  server.use(http.get('/api/photos/list', ({ request }) => {
    const root = new URL(request.url).searchParams.get('root');
    const source = root === null ? Object.values(byRoot).flat() : byRoot[root] ?? [];
    const items = source.map((entry) => ({
      fileName: entry.fileName,
      currentPath: entry.currentPath,
      ext: 'jpg',
      capturedAt: null,
      capturedAtSource: null,
      width: null,
      height: null,
      proxyState: 'done',
      thumbState: 'done',
      missingAt: null,
      sightings: 1,
      thumbPath: null,
      gridThumbPath: null,
      proxyPath: null,
      analysed: false,
      exifReadAt: null,
      fingerprint: entry.fingerprint,
    }));
    return HttpResponse.json({ ok: true, data: { media: 'photo', root, total: items.length, offset: 0, items } });
  }));
};

const stubPhotosScan = (onScan: () => void = () => undefined) => {
  server.use(
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

const mockFolderBridge = (folder: string | null) => {
  vi.spyOn(bridge.folder, 'getCurrent').mockResolvedValue(folder);
  vi.spyOn(bridge.folder, 'getRecent').mockResolvedValue(folder === null ? [] : [folder]);
};

describe('the photos surface scopes to the current folder', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('avc.mode', 'analysis');
    window.localStorage.setItem('avc.analysisMedia', 'photos');
    stubScan('/a/b');
    stubPhotosStatus();
  });

  it('auto-scans the current folder and shows none of an unrelated known root\'s content', async () => {
    mockFolderBridge('/a/b');
    stubPhotosTree([{ root: '/old/pictures', photos: 1, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' }]);
    stubPhotosList({ '/old/pictures': [{ fingerprint: 'x', currentPath: '/old/pictures/x.jpg', fileName: 'x.jpg' }] });
    let scanCalls = 0;
    stubPhotosScan(() => { scanCalls += 1; });

    renderRoute();

    await screen.findByTestId('photos-sidebar-unscanned');
    await waitFor(() => expect(scanCalls).toBe(1));
    expect(screen.queryByText('pictures')).toBeNull();
    expect(screen.queryByTestId('photos-sidebar-row')).toBeNull();
  });

  it('requests the photo list scoped to the current folder once it is a known root, without auto-scanning it again', async () => {
    mockFolderBridge('/a/b');
    stubPhotosTree([{ root: '/a/b', photos: 1, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' }]);
    stubPhotosList({ '/a/b': [{ fingerprint: 'y', currentPath: '/a/b/y.jpg', fileName: 'y.jpg' }] });
    let scanCalls = 0;
    stubPhotosScan(() => { scanCalls += 1; });

    renderRoute();

    await waitFor(() => expect(screen.getAllByTestId('photos-sidebar-row').length).toBe(1));
    expect(scanCalls).toBe(0);
  });

  it('keeps the all-folders browse and its scope toggle reachable from an unscanned current folder', async () => {
    window.localStorage.setItem('avc.photosScope', 'all');
    mockFolderBridge('/a/b');
    stubPhotosTree([{ root: '/old/pictures', photos: 1, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' }]);
    stubPhotosList({ '/old/pictures': [{ fingerprint: 'x', currentPath: '/old/pictures/x.jpg', fileName: 'x.jpg' }] });
    stubPhotosScan();

    renderRoute();

    await waitFor(() => expect(screen.getAllByTestId('photos-sidebar-row').length).toBe(1));
    expect(screen.queryByTestId('photos-sidebar-unscanned')).toBeNull();
    expect(screen.getByTestId('photos-scope-folder')).toBeDefined();
  });

  it('ignores a stale persisted photos root in localStorage', async () => {
    window.localStorage.setItem('avc.photosRoot', '/old/pictures');
    mockFolderBridge('/a/b');
    stubPhotosTree([
      { root: '/old/pictures', photos: 1, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' },
      { root: '/a/b', photos: 1, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' },
    ]);
    stubPhotosList({
      '/old/pictures': [{ fingerprint: 'x', currentPath: '/old/pictures/x.jpg', fileName: 'x.jpg' }],
      '/a/b': [{ fingerprint: 'y', currentPath: '/a/b/y.jpg', fileName: 'y.jpg' }],
    });

    renderRoute();

    await waitFor(() => expect(screen.getAllByTestId('photos-sidebar-row').length).toBe(1));
    const row = screen.getAllByTestId('photos-sidebar-row')[0];
    expect(row?.getAttribute('title')).toBe('/a/b/y.jpg');
  });
});
