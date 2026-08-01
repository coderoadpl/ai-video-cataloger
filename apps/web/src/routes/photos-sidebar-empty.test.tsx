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

const stubBaseline = () => {
  server.use(
    http.get('/api/scan', () => HttpResponse.json({ ok: true, data: scanResponse() })),
    http.get('/api/photos/tree', () => HttpResponse.json({ ok: true, data: { media: 'photo', roots: [] } })),
    http.get('/api/photos/list', () => HttpResponse.json({ ok: true, data: { media: 'photo', root: null, total: 0, offset: 0, items: [] } })),
  );
};

describe('Analysis sidebar with Zdjęcia active and no scanned photo roots', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('avc.mode', 'analysis');
    window.localStorage.setItem('avc.analysisMedia', 'photos');
    vi.spyOn(bridge.folder, 'getCurrent').mockResolvedValue('/movies');
    vi.spyOn(bridge.folder, 'getRecent').mockResolvedValue(['/movies']);
    stubBaseline();
  });

  it('shows the honest empty photos sidebar, never the video list, with the Zdjęcia heading', async () => {
    renderRoute();

    expect(await screen.findByTestId('photos-sidebar-empty')).toBeDefined();
    expect(screen.getByTestId('photos-sidebar-empty-scan')).toBeDefined();
    expect(screen.queryByTestId('video-item')).toBeNull();
    expect(screen.queryByTestId('folder-show-in-library')).toBeNull();
    await waitFor(() => {
      const heading = screen.getByText((_content, element) => element?.tagName.toLowerCase() === 'h2' && (element.textContent === 'Photos' || element.textContent === 'Zdjęcia'));
      expect(heading).toBeDefined();
    });
    expect(screen.queryByText((_content, element) => element?.tagName.toLowerCase() === 'h2' && (element.textContent === 'Videos' || element.textContent === 'Filmy'))).toBeNull();
  });

  it('swaps the sidebar between videos and photos content on the media toggle', async () => {
    renderRoute();
    await screen.findByTestId('photos-sidebar-empty');

    (await screen.findByTestId('analysis-media-videos')).click();

    await waitFor(() => expect(screen.getAllByTestId('video-item').length).toBeGreaterThan(0));
    expect(screen.queryByTestId('photos-sidebar-empty')).toBeNull();

    (await screen.findByTestId('analysis-media-photos')).click();

    await waitFor(() => expect(screen.getByTestId('photos-sidebar-empty')).toBeDefined());
    expect(screen.queryByTestId('video-item')).toBeNull();
  });
});
