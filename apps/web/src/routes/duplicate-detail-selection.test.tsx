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

const FOLDER = '/videos';

const video = (path: string, duplicateOf: string | null) => ({
  path,
  filename: path.split('/').pop() ?? '',
  size: 1024,
  sizeFormatted: '1.0 KB',
  duration: 60,
  durationFormatted: '1:00',
  status: 'completed',
  errorMessage: null,
  contentHash: 'hash-shared',
  duplicate: duplicateOf === null ? null : { canonicalPath: duplicateOf },
  source: { width: 1920, height: 1080, rotation: 0 },
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
});

const readinessOk = () => ({
  ready: true,
  analyzer: {
    kind: 'analyzer', name: 'Analyzer', available: true, message: 'ok', suggestedAction: null, warning: null,
    family: 'local', providerId: 'ollama', model: 'gemma3:12b',
  },
  transcriber: {
    kind: 'transcriber', name: 'Transcriber', available: true, message: 'ok', suggestedAction: null, warning: null,
    mode: 'skip', model: null, engine: null, binaryPath: null,
  },
  missingPieces: [],
  suggestedAction: null,
});

describe('selecting a duplicate in the tree', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('avc.mode', 'analysis');
    window.localStorage.setItem('avc.analysisMedia', 'videos');
    vi.spyOn(bridge.folder, 'getCurrent').mockResolvedValue(FOLDER);
    vi.spyOn(bridge.folder, 'getRecent').mockResolvedValue([FOLDER]);

    server.use(
      http.get('/api/scan', () => HttpResponse.json({
        ok: true,
        data: {
          folder: FOLDER,
          databasePath: `${FOLDER}/.ai-video-cataloger/catalog.db`,
          videos: [video(`${FOLDER}/original.mp4`, null)],
          summary: { total: 1, tracked: 1, pending: 0, inProgress: 0, completed: 1, error: 0, notTracked: 0 },
        },
      })),
      http.get('/api/catalog-tree', () => HttpResponse.json({
        ok: true,
        data: {
          root: FOLDER,
          folders: [
            { path: `${FOLDER}/sub`, name: 'sub', relativePath: 'sub', depth: 1, videoCount: 1, pendingCount: 0, processedCount: 1 },
          ],
          pendingTotal: 0,
          processedTotal: 2,
          videoTotal: 2,
          hasUnknownPending: false,
        },
      })),
      http.get('/api/catalog-tree/folder', () => HttpResponse.json({
        ok: true,
        data: { videos: [video(`${FOLDER}/sub/kopia.mp4`, `${FOLDER}/original.mp4`)] },
      })),
      http.get('/api/readiness', () => HttpResponse.json({ ok: true, data: readinessOk() })),
    );
  });

  it('opens the duplicate own detail view instead of jumping to the original', async () => {
    renderRoute();

    await screen.findByTestId('video-item');
    await waitFor(
      () => expect(screen.getByTestId('scope-tree').hasAttribute('disabled')).toBe(false),
      { timeout: 5000 },
    );
    fireEvent.click(screen.getByTestId('scope-tree'));

    const folderRow = await screen.findByTestId('folder-row');
    fireEvent.click(folderRow);

    const duplicateRow = await screen.findByText('kopia.mp4');
    fireEvent.click(duplicateRow);

    await waitFor(() => expect(screen.getByTestId('detail-layout').textContent).toContain(`${FOLDER}/sub/kopia.mp4`));
    expect(screen.getByTestId('duplicate-canonical-link').textContent).toBe(`${FOLDER}/original.mp4`);
    expect(screen.getByTestId('analyze-anyway-button')).toBeDefined();
  }, 15_000);
});
