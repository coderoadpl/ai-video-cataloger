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

const scanVideo = (status: 'pending' | 'completed') => ({
  path: `${FOLDER}/main.mp4`,
  filename: 'main.mp4',
  size: 1024,
  sizeFormatted: '1.0 KB',
  duration: 60,
  durationFormatted: '1:00',
  status,
  errorMessage: null,
  contentHash: 'hash-main',
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

const runningJob = (jobId: string) => ({
  jobId,
  kind: 'process_drive',
  status: 'running' as const,
  progress: null,
  progressEvents: [
    { sequence: 1, progress: { step: 'run-started', data: { runId: 'r1', root: FOLDER, foldersTotal: 2, filesTotal: 2 } } },
    { sequence: 2, progress: { step: 'folder-started', data: { path: FOLDER, filesTotal: 1 } } },
    {
      sequence: 3,
      progress: { step: 'renaming_video', percentage: 100, current: 1, total: 2, data: { video: `${FOLDER}/main.mp4` } },
    },
  ],
  error: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const completedJob = (jobId: string) => ({
  jobId,
  kind: 'process_drive',
  status: 'completed' as const,
  progress: null,
  progressEvents: [
    ...runningJob(jobId).progressEvents,
    { sequence: 4, progress: { step: 'folder-done', data: { path: FOLDER, filesDone: 1, filesSkipped: 0, filesFailed: 0 } } },
    {
      sequence: 5,
      progress: {
        step: 'run-summary',
        data: { runId: 'r1', root: FOLDER, foldersTotal: 1, foldersDone: 1, filesTotal: 1, filesDone: 1, filesSkipped: 0, filesFailed: 0, elapsedMs: 1000, failures: [] },
      },
    },
  ],
  error: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('whole-tree analysis refreshes the tree row after every finished file', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('avc.mode', 'analysis');
    window.localStorage.setItem('avc.analysisMedia', 'videos');
    vi.spyOn(bridge.folder, 'getCurrent').mockResolvedValue(FOLDER);
    vi.spyOn(bridge.folder, 'getRecent').mockResolvedValue([FOLDER]);

    let statusCalls = 0;
    server.use(
      http.get('/api/scan', () => HttpResponse.json({
        ok: true,
        data: {
          folder: FOLDER,
          databasePath: `${FOLDER}/.ai-video-cataloger/catalog.db`,
          videos: [scanVideo(statusCalls > 0 ? 'completed' : 'pending')],
          summary: { total: 1, tracked: 1, pending: statusCalls > 0 ? 0 : 1, inProgress: 0, completed: statusCalls > 0 ? 1 : 0, error: 0, notTracked: 0 },
        },
      })),
      http.get('/api/catalog-tree', () => HttpResponse.json({
        ok: true,
        data: {
          root: FOLDER,
          folders: [
            { path: `${FOLDER}/sub`, name: 'sub', relativePath: 'sub', depth: 1, videoCount: 1, pendingCount: 1, processedCount: 0 },
          ],
          pendingTotal: 2,
          processedTotal: 0,
          videoTotal: 2,
          hasUnknownPending: false,
        },
      })),
      http.get('/api/readiness', () => HttpResponse.json({ ok: true, data: readinessOk() })),
      http.post('/api/process-drive', () => HttpResponse.json({ ok: true, data: { jobId: 'job:drive' } })),
      http.get('/api/jobs/status', ({ request }) => {
        const jobId = new URL(request.url).searchParams.get('jobId') ?? '';
        statusCalls += 1;
        return HttpResponse.json({ ok: true, data: statusCalls === 1 ? runningJob(jobId) : completedJob(jobId) });
      }),
    );
  });

  it('flips the video row status after a per-file event, before any folder-done event', async () => {
    renderRoute();

    const initialRow = await screen.findByTestId('video-item');
    expect(initialRow.getAttribute('data-video-status')).toBe('pending');

    await waitFor(
      () => expect(screen.getByTestId('scope-tree').hasAttribute('disabled')).toBe(false),
      { timeout: 5000 },
    );
    fireEvent.click(screen.getByTestId('scope-tree'));
    await waitFor(() => expect(screen.getByTestId('scope-tree').getAttribute('aria-pressed')).toBe('true'));

    await waitFor(() => expect(screen.getByTestId('analyze-all-button').hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByTestId('analyze-all-button'));

    await waitFor(() => {
      const row = screen.getByTestId('video-item');
      expect(row.getAttribute('data-video-status')).toBe('completed');
    });
  }, 10_000);
});
