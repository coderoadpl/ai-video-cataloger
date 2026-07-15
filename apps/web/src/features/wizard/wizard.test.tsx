import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { SetupWizard } from './SetupWizard.js';

const ok = (data: unknown) => HttpResponse.json({ ok: true, data });

const machine = { platform: 'darwin', arch: 'arm64', totalMemGB: 32, appleSilicon: true };

const tiers = [
  { tag: 'gemma3:4b', label: 'Gemma 3 4B', downloadGB: 3, minTotalMemGB: 8, supportLevel: 'ok', installed: false, recommended: false },
  { tag: 'gemma3:12b', label: 'Gemma 3 12B', downloadGB: 8, minTotalMemGB: 16, supportLevel: 'ok', installed: false, recommended: true },
];

const completedJob = (jobId: string) => ({
  jobId,
  kind: 'local_ai_pull',
  status: 'completed',
  progress: null,
  progressEvents: [],
  error: null,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
});

const readiness = (ready: boolean) => ({
  ready,
  analyzer: {
    kind: 'analyzer',
    family: 'local',
    providerId: 'local',
    name: 'local',
    available: ready,
    message: ready ? 'local is available' : 'local is unavailable',
    suggestedAction: ready ? null : 'Download the model',
  },
  transcriber: {
    kind: 'transcriber',
    mode: 'local',
    model: 'base',
    name: 'whisper',
    available: ready,
    message: ready ? 'whisper is available' : 'whisper is unavailable',
    suggestedAction: null,
  },
  missingPieces: ready ? [] : [{ kind: 'analyzer', name: 'local', available: false, message: 'x', suggestedAction: null }],
  suggestedAction: ready ? null : 'Finish setup',
});

interface Recorders {
  configWrites: { key: string; value: string }[];
  credentialWrites: { providerId: string }[];
  providerTests: { family: string; providerId: string }[];
  readinessRefreshed: boolean;
}

const configBodySchema = z.object({ key: z.string(), value: z.string() });
const credentialBodySchema = z.object({ providerId: z.string() });
const providerBodySchema = z.object({ family: z.string(), providerId: z.string() });

const installHandlers = (
  overrides: {
    runtimeAvailable?: boolean;
    apiAuthenticated?: boolean;
    harnessAvailable?: (providerId: string) => boolean;
    ready?: boolean;
  } = {},
): Recorders => {
  const recorders: Recorders = {
    configWrites: [],
    credentialWrites: [],
    providerTests: [],
    readinessRefreshed: false,
  };
  server.use(
    http.get('/api/models/local-ai/requirements', () =>
      ok({ machine, runtimeUp: true, runtimeVersion: '0.1.0', tiers }),
    ),
    http.get('/api/models/whisper-runtime', () =>
      ok({
        available: overrides.runtimeAvailable ?? false,
        path: null,
        source: null,
        version: null,
        managedInstalled: false,
        buildToolsAvailable: true,
        missingBuildTools: [],
      }),
    ),
    http.post('/api/providers/test', async ({ request }) => {
      const body = providerBodySchema.parse(await request.json());
      recorders.providerTests.push({ family: body.family, providerId: body.providerId });
      if (body.family === 'api') {
        return ok({
          providerId: body.providerId,
          latencyMs: 12,
          message: 'checked',
          family: 'api',
          reachable: true,
          authenticated: overrides.apiAuthenticated ?? true,
        });
      }
      if (body.family === 'harness') {
        const available = overrides.harnessAvailable?.(body.providerId) ?? true;
        return ok({
          providerId: body.providerId,
          latencyMs: 5,
          message: 'checked',
          family: 'harness',
          available,
          version: available ? '1.0.0' : null,
        });
      }
      return ok({
        providerId: body.providerId,
        latencyMs: 5,
        message: 'checked',
        family: 'local',
        runtimeAvailable: true,
        modelAvailable: true,
        version: '0.1.0',
      });
    }),
    http.post('/api/config', async ({ request }) => {
      const body = configBodySchema.parse(await request.json());
      recorders.configWrites.push(body);
      return ok({ key: body.key, value: body.value, previousValue: null });
    }),
    http.post('/api/credentials', async ({ request }) => {
      const body = credentialBodySchema.parse(await request.json());
      recorders.credentialWrites.push(body);
      return ok({ providerId: body.providerId, stored: true });
    }),
    http.post('/api/models/local-ai/pull', () => ok({ jobId: 'job-local' })),
    http.post('/api/models/whisper-runtime/install', () => ok({ jobId: 'job-runtime' })),
    http.post('/api/models/whisper/download', () => ok({ jobId: 'job-whisper' })),
    http.get('/api/jobs/status', ({ request }) => {
      const jobId = new URL(request.url).searchParams.get('jobId') ?? 'job';
      return ok(completedJob(jobId));
    }),
    http.get('/api/readiness', ({ request }) => {
      if (new URL(request.url).searchParams.get('refresh') === 'true') recorders.readinessRefreshed = true;
      return ok(readiness(overrides.ready ?? true));
    }),
  );
  return recorders;
};

const clickNext = () => fireEvent.click(screen.getByTestId('wizard-next'));

describe('SetupWizard', () => {
  it('takes a fresh Apple-Silicon user through a fully local setup to a ready state', async () => {
    const recorders = installHandlers({ ready: true });
    const onClose = vi.fn();
    renderWithProviders(<SetupWizard open folder="/videos" onClose={onClose} />);

    expect(screen.getByTestId('wizard-step-welcome')).toBeDefined();
    clickNext();

    await screen.findByTestId('wizard-step-analyzer');
    await waitFor(() =>
      expect(screen.getByTestId('analyzer-family-local').textContent).toContain('recommended'),
    );
    clickNext();

    await screen.findByTestId('wizard-step-transcription');
    clickNext();

    await screen.findByTestId('wizard-step-downloads');
    expect(screen.getAllByTestId('download-task').length).toBe(3);
    clickNext();

    await screen.findByTestId('wizard-step-readiness');
    await screen.findByTestId('readiness-ready');
    expect(recorders.readinessRefreshed).toBe(true);
    clickNext();

    await screen.findByTestId('wizard-step-done');
    clickNext();
    expect(onClose).toHaveBeenCalledOnce();

    const providerWrite = recorders.configWrites.find((write) => write.key === 'analyzer_provider');
    expect(providerWrite).toBeDefined();
    expect(providerWrite?.value).toContain('"family":"local"');
  });

  it('shows the mandatory cost notice and stores the key when API is chosen', async () => {
    const recorders = installHandlers();
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    clickNext();
    await screen.findByTestId('wizard-step-analyzer');

    fireEvent.click(screen.getByTestId('analyzer-family-api'));
    expect(screen.getByTestId('api-cost-notice').textContent).toContain('charged by your API provider');

    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-secret' } });
    clickNext();

    await screen.findByTestId('wizard-step-transcription');
    expect(recorders.credentialWrites).toEqual([{ providerId: 'openai' }]);
    expect(recorders.providerTests.some((test) => test.family === 'api')).toBe(true);
    const providerWrite = recorders.configWrites.find((write) => write.key === 'analyzer_provider');
    expect(providerWrite?.value).toContain('"family":"api"');
    expect(providerWrite?.value).not.toContain('sk-secret');
  });

  it('blocks advancing when the API key fails validation', async () => {
    installHandlers({ apiAuthenticated: false });
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    clickNext();
    await screen.findByTestId('wizard-step-analyzer');
    fireEvent.click(screen.getByTestId('analyzer-family-api'));
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'bad' } });
    clickNext();

    await screen.findByTestId('analyzer-validation-error');
    expect(screen.getByTestId('wizard-step-analyzer')).toBeDefined();
  });

  it('shows detected-installed badges for agent harnesses', async () => {
    installHandlers({ harnessAvailable: (providerId) => providerId === 'claude-code' });
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    clickNext();
    await screen.findByTestId('wizard-step-analyzer');
    fireEvent.click(screen.getByTestId('analyzer-family-harness'));

    const claude = await screen.findByTestId('harness-claude-code');
    await waitFor(() => expect(claude.textContent).toContain('Installed'));
    const codex = screen.getByTestId('harness-codex');
    await waitFor(() => expect(codex.textContent).toContain('Not detected'));
  });

  it('skips downloads when transcription is skipped and a harness is available', async () => {
    installHandlers();
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    clickNext();
    await screen.findByTestId('wizard-step-analyzer');
    fireEvent.click(screen.getByTestId('analyzer-family-harness'));
    await screen.findByTestId('harness-claude-code');
    clickNext();

    await screen.findByTestId('wizard-step-transcription');
    fireEvent.click(screen.getByTestId('transcription-skip'));
    clickNext();

    await screen.findByTestId('wizard-step-downloads');
    expect(screen.getByTestId('downloads-none')).toBeDefined();
  });

  it('lets the user configure later without finishing', async () => {
    installHandlers();
    const onClose = vi.fn();
    renderWithProviders(<SetupWizard open folder="/videos" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('wizard-configure-later'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
