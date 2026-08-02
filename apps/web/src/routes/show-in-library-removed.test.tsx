import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen } from '@testing-library/react';
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

describe('the Analysis surface offers no show-in-library affordance anywhere', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('avc.mode', 'analysis');
    window.localStorage.setItem('avc.analysisMedia', 'videos');
    vi.spyOn(bridge.folder, 'getCurrent').mockResolvedValue('/movies');
    vi.spyOn(bridge.folder, 'getRecent').mockResolvedValue(['/movies']);
    server.use(http.get('/api/scan', () => HttpResponse.json({ ok: true, data: scanResponse() })));
  });

  it('renders the open folder header without a show-in-library button', async () => {
    renderRoute();

    expect(await screen.findByTestId('sidebar-folder-panel')).toBeDefined();
    expect(await screen.findByText('/movies')).toBeDefined();
    expect(screen.queryByTestId('folder-show-in-library')).toBeNull();
  });

  it('offers no show-in-library item on a video tile context menu', async () => {
    renderRoute();

    fireEvent.contextMenu(await screen.findByTestId('video-item'));

    expect(await screen.findByTestId('reveal-in-finder-item')).toBeDefined();
    expect(screen.queryByTestId('show-in-library-item')).toBeNull();
  });

  it('offers no show-in-library action on the selected video details card', async () => {
    renderRoute();

    fireEvent.click(await screen.findByTestId('video-item'));

    expect(await screen.findByTestId('detail-layout')).toBeDefined();
    expect(screen.queryByTestId('details-show-in-library')).toBeNull();
  });
});
