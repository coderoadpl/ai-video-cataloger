import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { FacesIndexAction } from './FacesIndexAction.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) => renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

const FOLDER = '/videos';

const defaults = (facesEnabled: boolean) => ({
  whisper_binary_path: '',
  whisper_model: 'base',
  whisper_language: 'auto',
  whisper_mode: 'local',
  whisper_api_base_url: 'https://api.openai.com/v1',
  whisper_api_model: 'whisper-1',
  frames: '3',
  timeout: '120',
  skip_rename: 'false',
  analyzer_backend: 'claude',
  local_model: 'gemma3:12b',
  analyzer_provider: JSON.stringify({
    family: 'harness',
    providerId: 'claude-code',
    command: 'claude',
    argsTemplate: ['--add-dir', '{videoDir}', '-p', '{prompt}'],
    promptStyle: 'file-urls',
  }),
  faces_enabled: facesEnabled ? 'true' : 'false',
  gemini_batch_mode: 'false',
  gemini_monthly_budget_usd: 'null',
  output_language: 'auto',
  tag_language: 'auto',
  ui_language: 'en',
});

const configData = (facesEnabled: boolean) => ({
  config: {
    whisper_binary_path: null,
    whisper_model: null,
    whisper_language: null,
    whisper_mode: null,
    whisper_api_base_url: null,
    whisper_api_model: null,
    frames: null,
    timeout: null,
    skip_rename: null,
    analyzer_backend: null,
    local_model: null,
    analyzer_provider: null,
    faces_enabled: facesEnabled ? 'true' : 'false',
    gemini_batch_mode: null,
    gemini_monthly_budget_usd: null,
    output_language: null,
    tag_language: null,
    ui_language: null,
  },
  defaults: defaults(facesEnabled),
  effective: defaults(facesEnabled),
  sources: {
    whisper_binary_path: 'default',
    whisper_model: 'default',
    whisper_language: 'default',
    whisper_mode: 'default',
    whisper_api_base_url: 'default',
    whisper_api_model: 'default',
    frames: 'default',
    timeout: 'default',
    skip_rename: 'default',
    analyzer_backend: 'default',
    local_model: 'default',
    analyzer_provider: 'default',
    faces_enabled: 'home',
    gemini_batch_mode: 'default',
    gemini_monthly_budget_usd: 'default',
    output_language: 'default',
    tag_language: 'default',
    ui_language: 'default',
  },
});

const stubFaces = (input: { facesEnabled: boolean; artifactsReady?: boolean }) => {
  server.use(
    http.get('/api/config', () => HttpResponse.json({ ok: true, data: configData(input.facesEnabled) })),
    http.get('/api/models/faces', () => HttpResponse.json({
      ok: true,
      data: { artifacts: [], ready: input.artifactsReady ?? true },
    })),
    http.get('/api/jobs/status', ({ request }) => {
      const jobId = new URL(request.url).searchParams.get('jobId') ?? '';
      return HttpResponse.json({
        ok: true,
        data: {
          jobId,
          kind: 'faces_index',
          status: 'completed',
          progress: null,
          progressEvents: [],
          error: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      });
    }),
  );
};

describe('FacesIndexAction', () => {
  it('is disabled without a folder', async () => {
    stubFaces({ facesEnabled: true, artifactsReady: true });

    renderThemed(<FacesIndexAction active folder={null} addLine={vi.fn()} hasAnalyzedPhotos={false} />);

    await waitFor(() => expect(screen.getByTestId('people-index').getAttribute('disabled')).not.toBeNull());
  });

  it('fires the index job for the given folder once enabled', async () => {
    const addLine = vi.fn();
    let indexBody: unknown = null;
    stubFaces({ facesEnabled: true, artifactsReady: true });
    server.use(
      http.post('/api/faces/index', async ({ request }) => {
        indexBody = await request.json();
        return HttpResponse.json({ ok: true, data: { jobId: 'faces-index-1' } });
      }),
    );

    renderThemed(<FacesIndexAction active folder={FOLDER} addLine={addLine} hasAnalyzedPhotos />);

    await waitFor(() => expect(screen.getByTestId('people-index').getAttribute('disabled')).toBeNull());
    fireEvent.click(screen.getByTestId('people-index'));

    await waitFor(() => expect(addLine).toHaveBeenCalledWith('Face grouping index is updated', 'success'));
    expect(indexBody).toEqual({ root: FOLDER });
  });

  it('is disabled with an explanatory tooltip when the current root has no analyzed photos', async () => {
    stubFaces({ facesEnabled: true, artifactsReady: true });

    renderThemed(<FacesIndexAction active folder={FOLDER} addLine={vi.fn()} hasAnalyzedPhotos={false} />);

    const button = screen.getByTestId('people-index');
    await waitFor(() => expect(button.getAttribute('disabled')).not.toBeNull());
    expect(button.getAttribute('title')).toBe('Analyze at least one photo in this folder before indexing faces.');
  });

  it('surfaces a failed faces index job via a visible alert instead of only the terminal', async () => {
    stubFaces({ facesEnabled: true, artifactsReady: true });
    server.use(
      http.post('/api/faces/index', () => HttpResponse.json(
        { ok: false, error: { code: 'internal', message: 'index build crashed' } },
        { status: 500 },
      )),
    );

    renderThemed(<FacesIndexAction active folder={FOLDER} addLine={vi.fn()} hasAnalyzedPhotos />);

    await waitFor(() => expect(screen.getByTestId('people-index').getAttribute('disabled')).toBeNull());
    fireEvent.click(screen.getByTestId('people-index'));

    expect((await screen.findByTestId('people-index-error')).textContent).toContain('index build crashed');
  });

  it('sanitizes an empty-catalog failure without exposing raw server copy or its path', async () => {
    stubFaces({ facesEnabled: true, artifactsReady: true });
    server.use(
      http.post('/api/faces/index', () => HttpResponse.json(
        { ok: false, error: { code: 'drive_root_empty', message: `No catalog folders found under: ${FOLDER}` } },
        { status: 404 },
      )),
    );

    renderThemed(<FacesIndexAction active folder={FOLDER} addLine={vi.fn()} hasAnalyzedPhotos />);

    await waitFor(() => expect(screen.getByTestId('people-index').getAttribute('disabled')).toBeNull());
    fireEvent.click(screen.getByTestId('people-index'));

    const error = await screen.findByTestId('people-index-error');
    expect(error.textContent).toContain('No analyzed catalog data is available for this folder.');
    expect(error.textContent).not.toContain('No catalog folders found');
    expect(error.textContent).not.toContain(FOLDER);
  });
});
