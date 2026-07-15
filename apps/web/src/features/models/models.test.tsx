import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import type { z } from 'zod';

import type {
  localAiRequirementsOutputSchema,
  localAiTierSchema,
  whisperModelListEntrySchema,
} from '@core/contract/index.js';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { ModelManagerModal } from './ModelManagerModal.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

type WhisperEntry = z.output<typeof whisperModelListEntrySchema>;
type Tier = z.output<typeof localAiTierSchema>;
type Requirements = z.output<typeof localAiRequirementsOutputSchema>;

const whisperModels: WhisperEntry[] = [
  { name: 'tiny', size: '75MB', downloaded: false, active: false },
  { name: 'base', size: '142MB', downloaded: true, active: true },
  { name: 'small', size: '466MB', downloaded: true, active: false },
];

const makeTier = (overrides: Partial<Tier> & { tag: Tier['tag'] }): Tier => ({
  label: 'A tier',
  downloadGB: 8.1,
  minTotalMemGB: 16,
  supportLevel: 'ok',
  installed: false,
  recommended: false,
  ...overrides,
});

const requirements: Requirements = {
  machine: { platform: 'darwin', arch: 'arm64', totalMemGB: 16, appleSilicon: true },
  runtimeUp: false,
  runtimeVersion: '',
  tiers: [
    makeTier({ tag: 'gemma3:12b', supportLevel: 'ok', recommended: true }),
    makeTier({ tag: 'gemma3:27b', supportLevel: 'insufficient-ram' }),
  ],
};

const managedRuntime = {
  available: true,
  path: '/home/.ai-video-cataloger/bin/whisper',
  source: 'managed',
  version: 'v1.9.1',
  managedInstalled: true,
  buildToolsAvailable: true,
  missingBuildTools: [],
};

const terminalJob = (jobId: string, kind: string) => ({
  jobId,
  kind,
  status: 'completed',
  progress: null,
  progressEvents: [],
  error: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const stubList = () => {
  server.use(
    http.get('/api/models/whisper', () => HttpResponse.json({ ok: true, data: { models: whisperModels } })),
    http.get('/api/models/whisper-runtime', () => HttpResponse.json({ ok: true, data: managedRuntime })),
    http.get('/api/models/local-ai/requirements', () => HttpResponse.json({ ok: true, data: requirements })),
    http.get('/api/jobs/status', ({ request }) => {
      const jobId = new URL(request.url).searchParams.get('jobId') ?? '';
      return HttpResponse.json({ ok: true, data: terminalJob(jobId, 'whisper_download') });
    }),
  );
};

describe('model manager', () => {
  it('lists whisper models with disk usage and machine summary', async () => {
    stubList();
    renderThemed(<ModelManagerModal open onClose={vi.fn()} addLine={vi.fn()} intervalMs={0} />);

    await screen.findByText('Disk space used: 608 MB');
    expect(screen.getAllByTestId('whisper-model-row')).toHaveLength(3);
    expect(await screen.findByTestId('local-ai-machine')).toBeDefined();
    expect(screen.getAllByTestId('local-ai-tier-row')).toHaveLength(2);
  });

  it('downloads a missing whisper model as a job', async () => {
    let downloadHit = false;
    stubList();
    server.use(
      http.post('/api/models/whisper/download', () => {
        downloadHit = true;
        return HttpResponse.json({ ok: true, data: { jobId: 'dl-1' } });
      }),
    );
    const addLine = vi.fn();
    renderThemed(<ModelManagerModal open onClose={vi.fn()} addLine={addLine} intervalMs={0} />);

    fireEvent.click(await screen.findByTestId('whisper-download-button'));

    await waitFor(() =>
      expect(addLine).toHaveBeenCalledWith('Model tiny downloaded successfully', 'success'),
    );
    expect(downloadHit).toBe(true);
  });

  it('installs the managed whisper runtime as a job', async () => {
    let installed = false;
    stubList();
    server.use(
      http.get('/api/models/whisper-runtime', () => HttpResponse.json({
        ok: true,
        data: installed
          ? managedRuntime
          : {
              available: false,
              path: null,
              source: null,
              version: null,
              managedInstalled: false,
              buildToolsAvailable: true,
              missingBuildTools: [],
            },
      })),
      http.post('/api/models/whisper-runtime/install', () => {
        installed = true;
        return HttpResponse.json({ ok: true, data: { jobId: 'runtime-1' } });
      }),
      http.get('/api/jobs/status', ({ request }) => {
        const jobId = new URL(request.url).searchParams.get('jobId') ?? '';
        return HttpResponse.json({ ok: true, data: terminalJob(jobId, 'whisper_runtime_install') });
      }),
    );
    const addLine = vi.fn();
    renderThemed(<ModelManagerModal open onClose={vi.fn()} addLine={addLine} intervalMs={0} />);

    fireEvent.click(await screen.findByTestId('whisper-runtime-install'));

    await waitFor(() => expect(addLine).toHaveBeenCalledWith('Managed whisper.cpp runtime is ready', 'success'));
    expect(await screen.findByTestId('whisper-runtime-status')).toBeDefined();
  });

  it('activates a downloaded model when its row is clicked', async () => {
    let useBody: unknown = null;
    stubList();
    server.use(
      http.post('/api/models/whisper/use', async ({ request }) => {
        useBody = await request.json();
        return HttpResponse.json({ ok: true, data: { model: 'small', downloaded: true } });
      }),
    );
    const addLine = vi.fn();
    renderThemed(<ModelManagerModal open onClose={vi.fn()} addLine={addLine} intervalMs={0} />);

    await screen.findByText('Disk space used: 608 MB');
    fireEvent.click(screen.getByText('small'));

    await waitFor(() => expect(addLine).toHaveBeenCalledWith('Model small is now active', 'success'));
    expect(useBody).toEqual({ modelName: 'small' });
  });

  it('deletes a downloaded model after confirmation', async () => {
    let deleteHit = false;
    stubList();
    server.use(
      http.delete('/api/models/whisper', () => {
        deleteHit = true;
        return HttpResponse.json({
          ok: true,
          data: { model: 'small', path: '/x', deleted: true },
        });
      }),
    );
    const addLine = vi.fn();
    renderThemed(<ModelManagerModal open onClose={vi.fn()} addLine={addLine} intervalMs={0} />);

    await screen.findByText('Disk space used: 608 MB');
    const baseRow = screen
      .getAllByTestId('whisper-model-row')
      .find((row) => row.getAttribute('data-model-name') === 'base');
    const deleteButton = baseRow?.querySelector('[data-testid="whisper-delete-button"]');
    if (!(deleteButton instanceof HTMLElement)) throw new Error('missing delete button');
    fireEvent.click(deleteButton);
    fireEvent.click(await screen.findByTestId('delete-model-confirm'));

    await waitFor(() => expect(addLine).toHaveBeenCalledWith('Model base deleted', 'success'));
    expect(deleteHit).toBe(true);
  });

  it('disables the download button for an unsupported local-ai tier', async () => {
    stubList();
    renderThemed(<ModelManagerModal open onClose={vi.fn()} addLine={vi.fn()} intervalMs={0} />);

    await screen.findByTestId('local-ai-machine');
    const unsupportedRow = screen
      .getAllByTestId('local-ai-tier-row')
      .find((row) => row.getAttribute('data-tier-tag') === 'gemma3:27b');
    const button = unsupportedRow?.querySelector('[data-testid="local-ai-download-button"]');
    expect(button?.getAttribute('disabled')).not.toBeNull();
  });
});
