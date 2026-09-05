import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { en, pl } from '../../i18n/dictionary.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { scaledTimeout } from '../../../../../test/helpers/gate-timeout.js';
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
  configWrites: { folder?: string | undefined; key: string; value: string }[];
  configUnsets: { folder: string; key: string }[];
  credentialWrites: { providerId: string }[];
  providerTests: { family: string; providerId: string }[];
  faceInstallRequests: number;
  readinessRefreshed: boolean;
  readinessScopes: Array<string | null>;
}

const configBodySchema = z.object({ folder: z.string().optional(), key: z.string(), value: z.string() });
const configUnsetBodySchema = z.object({ folder: z.string(), key: z.string() });
const credentialBodySchema = z.object({ providerId: z.string() });
const providerBodySchema = z.object({ family: z.string(), providerId: z.string() });
const faceInstallBodySchema = z.object({ force: z.boolean() });

const installHandlers = (
  overrides: {
    runtimeAvailable?: boolean;
    whisperDownloaded?: boolean;
    apiAuthenticated?: boolean;
    harnessAvailable?: (providerId: string) => boolean;
    ready?: boolean;
    rejectWhisperPath?: boolean;
    rejectConfigKey?: string;
    facesEnabled?: boolean;
    faceArtifactsReady?: boolean;
  } = {},
): Recorders => {
  const recorders: Recorders = {
    configWrites: [],
    configUnsets: [],
    credentialWrites: [],
    providerTests: [],
    faceInstallRequests: 0,
    readinessRefreshed: false,
    readinessScopes: [],
  };
  server.use(
    http.get('/api/config', () => ok(configView('en', 'auto', overrides.facesEnabled ?? false))),
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
    http.get('/api/models/whisper', () =>
      ok({
        models: [{ name: 'base', size: '142 MB', downloaded: overrides.whisperDownloaded ?? false, active: true }],
      }),
    ),
    http.get('/api/models/faces', () =>
      ok({ artifacts: [], ready: overrides.faceArtifactsReady ?? false }),
    ),
    http.post('/api/providers/test', async ({ request }) => {
      const body = providerBodySchema.parse(await request.json());
      recorders.providerTests.push({ family: body.family, providerId: body.providerId });
      if (body.family === 'api' || body.family === 'gemini-native') {
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
      if ((overrides.rejectWhisperPath === true && body.key === 'whisper_binary_path') || body.key === overrides.rejectConfigKey) {
        return HttpResponse.json(
          { ok: false, error: { code: 'invalid_config_value', message: `Could not persist ${body.key}: ${body.value}` } },
          { status: 400 },
        );
      }
      return ok({ key: body.key, value: body.value, previousValue: null, scope: 'home' as const, ignoredFolderValue: null });
    }),
    http.delete('/api/config', async ({ request }) => {
      const body = configUnsetBodySchema.parse(await request.json());
      recorders.configUnsets.push(body);
      return ok({ key: body.key, previousValue: null, scope: 'folder' as const });
    }),
    http.post('/api/credentials', async ({ request }) => {
      const body = credentialBodySchema.parse(await request.json());
      recorders.credentialWrites.push(body);
      return ok({ providerId: body.providerId, stored: true, backend: { backend: 'keychain', reason: 'ok' } });
    }),
    http.post('/api/models/local-ai/pull', () => ok({ jobId: 'job-local' })),
    http.post('/api/models/whisper-runtime/install', () => ok({ jobId: 'job-runtime' })),
    http.post('/api/models/whisper/download', () => ok({ jobId: 'job-whisper' })),
    http.post('/api/models/faces/install', async ({ request }) => {
      faceInstallBodySchema.parse(await request.json());
      recorders.faceInstallRequests += 1;
      return ok({ jobId: 'job-faces' });
    }),
    http.get('/api/jobs/status', ({ request }) => {
      const jobId = new URL(request.url).searchParams.get('jobId') ?? 'job';
      return ok(completedJob(jobId));
    }),
    http.get('/api/readiness', ({ request }) => {
      const url = new URL(request.url);
      if (url.searchParams.get('refresh') === 'true') recorders.readinessRefreshed = true;
      recorders.readinessScopes.push(url.searchParams.get('scope'));
      return ok(readiness(overrides.ready ?? true));
    }),
    http.get('/api/doctor', () =>
      ok({
        dependencies: [
          { name: 'ffmpeg', available: true, version: '6.0', source: 'system', path: '/usr/bin/ffmpeg', installHint: '' },
          { name: 'ffprobe', available: true, version: '6.0', source: 'system', path: '/usr/bin/ffprobe', installHint: '' },
          {
            name: 'whisper',
            available: overrides.runtimeAvailable ?? true,
            version: overrides.runtimeAvailable === false ? null : '1.5.0',
            source: overrides.runtimeAvailable === false ? null : 'managed',
            path: null,
            installHint: 'Managed whisper runtime',
          },
          { name: 'local-ai', available: true, version: 'managed', source: 'bundled', path: null, installHint: '' },
        ],
        harnesses: [],
        machine,
        recommendedLocalModel: 'gemma3:12b',
        allAvailable: overrides.ready ?? true,
        warnings: [],
        credentials: { backend: 'keychain', reason: 'ok' },
        configured: readiness(overrides.ready ?? true),
      }),
    ),
  );
  return recorders;
};

const clickNext = () => fireEvent.click(screen.getByTestId('wizard-next'));

const configDefaults = {
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
  faces_enabled: 'false',
  gemini_batch_mode: 'false',
  gemini_monthly_budget_usd: 'null',
  output_language: 'auto',
  tag_language: 'auto',
  ui_language: 'en',
  backup_enabled: 'false',
  backup_provider: 'google_oauth',
  backup_include_optional: 'false',
  backup_keep_last: '7',
  backup_keep_weekly: '8',
  backup_folder_id: '',
  backup_shared_drive_id: '',
  backup_service_account_fingerprint: '',
  backup_account_email: '',
};

const configView = (uiLanguage: string, outputLanguage: string, facesEnabled = false) => {
  const effective = {
    ...configDefaults,
    faces_enabled: facesEnabled ? 'true' : 'false',
    ui_language: uiLanguage,
    output_language: outputLanguage,
  };
  const config = Object.fromEntries(Object.keys(configDefaults).map((key) => [key, null]));
  const sources = Object.fromEntries(Object.keys(configDefaults).map((key) => [key, 'default']));
  return { config, defaults: configDefaults, effective, sources };
};

const openSelect = (testId: string) =>
  fireEvent.mouseDown(within(screen.getByTestId(testId)).getByRole('combobox'));

const enterLanguageStep = async () => {
  clickNext();
  await screen.findByTestId('wizard-step-language');
};

const passLanguageStep = async () => {
  await enterLanguageStep();
  clickNext();
  await screen.findByTestId('wizard-step-analyzer');
};

const advanceFromFaces = async () => {
  await screen.findByTestId('wizard-step-faces');
  clickNext();
  await screen.findByTestId('wizard-step-downloads');
};

describe('SetupWizard', () => {
  it('takes a fresh Apple-Silicon user through a fully local setup to a ready state', async () => {
    const recorders = installHandlers({ ready: true });
    const onClose = vi.fn();
    renderWithProviders(<SetupWizard open folder="/videos" onClose={onClose} />);

    expect(screen.getByTestId('wizard-step-welcome')).toBeDefined();
    await passLanguageStep();
    expect(screen.getByTestId('analyzer-family-local').textContent).toBe('Local');
    fireEvent.click(screen.getByTestId('analyzer-family-local'));
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: /Gemma 3 4B/ }));
    clickNext();

    await screen.findByTestId('wizard-step-transcription');
    clickNext();
    await advanceFromFaces();
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
    expect(providerWrite?.value).toContain('"modelTag":"gemma3:4b"');
    expect(recorders.configWrites).toContainEqual({ key: 'local_model', value: 'gemma3:4b' });
    expect(recorders.configWrites).toContainEqual({ key: 'whisper_binary_path', value: '' });
    expect(recorders.configWrites.every((write) => write.folder === undefined)).toBe(true);
    expect(recorders.configUnsets).toEqual([]);
  }, scaledTimeout(10_000));

  it('opens the analyzer step on the configured harness family, so a local setup starts with an explicit Local choice', async () => {
    installHandlers();
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);

    await passLanguageStep();
    await waitFor(() => expect(screen.getByTestId('analyzer-family-harness').getAttribute('aria-pressed')).toBe('true'));
    expect(screen.queryByTestId('wizard-local-model-select')).toBeNull();

    fireEvent.click(screen.getByTestId('analyzer-family-local'));

    expect(screen.getByTestId('wizard-local-model-select')).toBeDefined();
  });

  it('clears a stale folder override for a key it just saved home-scoped', async () => {
    const recorders = installHandlers();
    server.use(
      http.get('/api/config', () => ok({
        config: { ...Object.fromEntries(Object.keys(configDefaults).map((key) => [key, null])), output_language: 'auto' },
        defaults: configDefaults,
        effective: configDefaults,
        sources: { ...Object.fromEntries(Object.keys(configDefaults).map((key) => [key, 'default'])), output_language: 'folder' },
      })),
    );
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);

    await enterLanguageStep();
    openSelect('wizard-output-language-select');
    fireEvent.click(await screen.findByRole('option', { name: 'Polish' }));
    clickNext();

    await screen.findByTestId('wizard-step-analyzer');
    expect(recorders.configWrites).toContainEqual({ key: 'output_language', value: 'pl' });
    expect(recorders.configUnsets).toEqual([{ folder: '/videos', key: 'output_language' }]);
  });

  it('re-running the wizard preselects the currently configured harness, model and effort', async () => {
    installHandlers();
    server.use(
      http.get('/api/config', () => ok({
        config: Object.fromEntries(Object.keys(configDefaults).map((key) => [key, null])),
        defaults: configDefaults,
        effective: {
          ...configDefaults,
          analyzer_provider: JSON.stringify({
            family: 'harness',
            providerId: 'claude-code',
            command: 'claude',
            argsTemplate: ['--add-dir', '{videoDir}', '-p', '{prompt}'],
            promptStyle: 'file-urls',
            model: 'claude-opus-4-8',
            reasoningEffort: 'high',
          }),
        },
        sources: Object.fromEntries(Object.keys(configDefaults).map((key) => [key, 'default'])),
      })),
    );
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    await passLanguageStep();

    await screen.findByTestId('harness-claude-code');
    expect(screen.queryByTestId('analyzer-local')).toBeNull();
    const modelSelect = within(screen.getByTestId('harness-model-select')).getByRole('combobox');
    await waitFor(() => expect(modelSelect.textContent).toBe('claude-opus-4-8'));
    const effortSelect = within(screen.getByTestId('harness-effort-select')).getByRole('combobox');
    expect(effortSelect.textContent).toBe('high');
  });

  it('shows a missing local model as a download and offers to install it', async () => {
    installHandlers();
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    await passLanguageStep();
    fireEvent.click(screen.getByTestId('analyzer-family-local'));
    await waitFor(() =>
      expect(screen.getByTestId('wizard-local-model-select').textContent).toContain('8 GB download'),
    );
    clickNext();
    await screen.findByTestId('wizard-step-transcription');
    fireEvent.click(screen.getByTestId('transcription-skip'));
    clickNext();
    await advanceFromFaces();
    expect(screen.getAllByTestId('download-task')).toHaveLength(1);
    expect(screen.getByTestId('wizard-next').textContent).toBe('Install & continue');
  });

  it('shows the mandatory cost notice and stores the key when API is chosen', async () => {
    const recorders = installHandlers();
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    await passLanguageStep();

    fireEvent.click(screen.getByTestId('analyzer-family-api'));
    expect(screen.getByTestId('api-cost-notice').textContent).toContain('charged by your API provider');
    expect(screen.queryByTestId('wizard-gemini-privacy')).toBeNull();

    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-secret' } });
    clickNext();

    await screen.findByTestId('wizard-step-transcription');
    expect(recorders.credentialWrites).toEqual([{ providerId: 'openai' }]);
    expect(recorders.providerTests.some((test) => test.family === 'api')).toBe(true);
    const providerWrite = recorders.configWrites.find((write) => write.key === 'analyzer_provider');
    expect(providerWrite?.value).toContain('"family":"api"');
    expect(providerWrite?.value).not.toContain('sk-secret');
  });

  it('warns about the Google upload and stores the key when Gemini native video is chosen', async () => {
    const recorders = installHandlers();
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    await passLanguageStep();

    expect(screen.queryByTestId('analyzer-gemini')).toBeNull();
    expect(screen.queryByTestId('wizard-gemini-privacy')).toBeNull();

    fireEvent.click(screen.getByTestId('analyzer-family-gemini'));

    const privacy = screen.getByTestId('wizard-gemini-privacy').textContent ?? '';
    expect(privacy).toContain('exception to local-first processing');
    expect(privacy).toContain('entire video file, including audio');
    expect(privacy).toContain('under about 20 MB');
    expect(privacy).toContain('Files API');
    expect(privacy).toContain('Google\'s side for about 48 hours');
    expect(privacy).toContain('model produces the transcript');
    expect(privacy).toContain('tokens per second, independent of resolution');
    expect(privacy).toContain('a few cents per minute');

    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'gemini-secret' } });
    clickNext();

    await screen.findByTestId('wizard-step-transcription');
    expect(recorders.credentialWrites).toEqual([{ providerId: 'gemini' }]);
    expect(recorders.providerTests.some((test) => test.family === 'gemini-native')).toBe(true);
    const providerWrite = recorders.configWrites.find((write) => write.key === 'analyzer_provider');
    expect(providerWrite?.value).toContain('"family":"gemini-native"');
    expect(providerWrite?.value).not.toContain('gemini-secret');
    const backendWrite = recorders.configWrites.find((write) => write.key === 'analyzer_backend');
    expect(backendWrite?.value).toBe('claude');
  });

  it('locks transcription to skip and plans no whisper download for Gemini native video', async () => {
    const recorders = installHandlers();
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    await passLanguageStep();

    fireEvent.click(screen.getByTestId('analyzer-family-gemini'));
    clickNext();

    await screen.findByTestId('wizard-step-transcription');
    expect(screen.getByTestId('transcription-native-notice').textContent).toContain('reads the audio itself');
    expect(within(screen.getByTestId('transcription-skip')).getByRole('radio', { checked: true })).toBeDefined();
    expect(within(screen.getByTestId('transcription-managed')).getByRole('radio').hasAttribute('disabled')).toBe(true);
    clickNext();
    await advanceFromFaces();
    await screen.findByTestId('downloads-none');
    expect(recorders.configWrites.filter((write) => write.key === 'whisper_mode')).toEqual([
      { folder: undefined, key: 'whisper_mode', value: 'skip' },
    ]);
    expect(recorders.configWrites.some((write) => write.key === 'whisper_model')).toBe(false);
  });

  it('lets the user pick a cheaper Gemini model before advancing', async () => {
    const recorders = installHandlers();
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    await passLanguageStep();

    fireEvent.click(screen.getByTestId('analyzer-family-gemini'));
    fireEvent.mouseDown(within(screen.getByTestId('wizard-gemini-model-select')).getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'gemini-flash-lite-latest' }));
    clickNext();

    await screen.findByTestId('wizard-step-transcription');
    const providerWrite = recorders.configWrites.find((write) => write.key === 'analyzer_provider');
    expect(providerWrite?.value).toContain('"model":"gemini-flash-lite-latest"');
    expect(recorders.credentialWrites).toEqual([]);
  });

  it('blocks advancing when a rejected Gemini key fails validation', async () => {
    installHandlers({ apiAuthenticated: false });
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    await passLanguageStep();
    fireEvent.click(screen.getByTestId('analyzer-family-gemini'));
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'bad' } });
    clickNext();

    await screen.findByTestId('analyzer-validation-error');
    expect(screen.getByTestId('wizard-step-analyzer')).toBeDefined();
  });

  it('blocks advancing when the API key fails validation', async () => {
    installHandlers({ apiAuthenticated: false });
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    await passLanguageStep();
    fireEvent.click(screen.getByTestId('analyzer-family-api'));
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'bad' } });
    clickNext();

    await screen.findByTestId('analyzer-validation-error');
    expect(screen.getByTestId('wizard-step-analyzer')).toBeDefined();
  });

  it('surfaces a failed analyzer config write without advancing', async () => {
    const recorders = installHandlers({ rejectConfigKey: 'local_model' });
    renderWithProviders(<SetupWizard open folder={null} onClose={vi.fn()} />);
    await passLanguageStep();
    fireEvent.click(screen.getByTestId('analyzer-family-local'));
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: /Gemma 3 4B/ }));

    clickNext();

    expect((await screen.findByTestId('analyzer-validation-error')).textContent).toContain('local_model');
    expect(screen.getByTestId('wizard-step-analyzer')).toBeDefined();
    expect(recorders.configWrites.map((write) => write.key)).toEqual([
      'output_language',
      'analyzer_provider',
      'analyzer_backend',
      'local_model',
    ]);
  });

  it('requests explicit home readiness when no folder is selected', async () => {
    const recorders = installHandlers({ ready: true });
    renderWithProviders(<SetupWizard open folder={null} onClose={vi.fn()} />);
    await passLanguageStep();
    fireEvent.click(screen.getByTestId('analyzer-family-harness'));
    await screen.findByTestId('harness-claude-code');
    clickNext();
    await screen.findByTestId('wizard-step-transcription');
    fireEvent.click(screen.getByTestId('transcription-skip'));
    clickNext();
    await advanceFromFaces();
    clickNext();

    await screen.findByTestId('readiness-ready');
    expect(recorders.readinessScopes).toContain('home');
  });

  it('stores an OpenAI credential when API transcription is chosen', async () => {
    const recorders = installHandlers();
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    await passLanguageStep();
    fireEvent.click(screen.getByTestId('analyzer-family-harness'));
    await screen.findByTestId('harness-claude-code');
    clickNext();
    await screen.findByTestId('wizard-step-transcription');
    fireEvent.click(screen.getByTestId('transcription-api'));
    const credential = screen.getByLabelText('OpenAI API key');
    expect(credential.getAttribute('type')).toBe('password');
    fireEvent.change(credential, { target: { value: 'whisper-secret' } });

    clickNext();
    await advanceFromFaces();

    expect(recorders.credentialWrites).toEqual([{ providerId: 'openai' }]);
    expect(recorders.configWrites).toContainEqual({ key: 'whisper_mode', value: 'api' });
  }, scaledTimeout(30_000));

  it('shows detected-installed badges for agent harnesses', async () => {
    installHandlers({ harnessAvailable: (providerId) => providerId === 'claude-code' });
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    await passLanguageStep();
    fireEvent.click(screen.getByTestId('analyzer-family-harness'));

    const claude = await screen.findByTestId('harness-claude-code');
    await waitFor(() => expect(claude.textContent).toContain(en.wizard.analyzer.installed));
    const codex = screen.getByTestId('harness-codex');
    await waitFor(() => expect(codex.textContent).toContain(en.wizard.analyzer.notDetected));
  });

  it('skips downloads when transcription is skipped and a harness is available', async () => {
    installHandlers();
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    await passLanguageStep();
    fireEvent.click(screen.getByTestId('analyzer-family-harness'));
    await screen.findByTestId('harness-claude-code');
    clickNext();

    await screen.findByTestId('wizard-step-transcription');
    fireEvent.click(screen.getByTestId('transcription-skip'));
    clickNext();
    await advanceFromFaces();
    expect(screen.getByTestId('downloads-none')).toBeDefined();
    expect(screen.getByTestId('wizard-next').textContent).toBe('Continue');
  });

  it('defaults face indexing from current config', async () => {
    installHandlers({ facesEnabled: true, faceArtifactsReady: true });
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    await passLanguageStep();
    fireEvent.click(screen.getByTestId('analyzer-family-harness'));
    await screen.findByTestId('harness-claude-code');
    clickNext();
    await screen.findByTestId('wizard-step-transcription');
    fireEvent.click(screen.getByTestId('transcription-skip'));
    clickNext();

    await screen.findByTestId('wizard-step-faces');
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Enable face detection and recognition' })).toHaveProperty('checked', true),
    );
  });

  it('persists face indexing and plans the YuNet and SFace download', async () => {
    const recorders = installHandlers({ faceArtifactsReady: false });
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    await passLanguageStep();
    fireEvent.click(screen.getByTestId('analyzer-family-harness'));
    await screen.findByTestId('harness-claude-code');
    clickNext();
    await screen.findByTestId('wizard-step-transcription');
    fireEvent.click(screen.getByTestId('transcription-skip'));
    clickNext();

    const facesStep = await screen.findByTestId('wizard-step-faces');
    expect(facesStep.textContent).toContain('fully locally');
    expect(facesStep.textContent).toContain('YuNet');
    expect(facesStep.textContent).toContain('SFace');
    expect(facesStep.textContent).toContain('People tab');
    expect(facesStep.textContent).toContain('1–2 seconds');
    fireEvent.click(screen.getByTestId('wizard-faces-enabled-switch'));
    clickNext();

    await screen.findByTestId('wizard-step-downloads');
    expect(recorders.configWrites).toContainEqual({ key: 'faces_enabled', value: 'true' });
    expect(screen.getAllByTestId('download-task')).toHaveLength(1);
    expect(screen.getByTestId('download-task').textContent).toContain('YuNet and SFace');

    clickNext();
    await screen.findByTestId('wizard-step-readiness');
    expect(recorders.faceInstallRequests).toBe(1);
  }, scaledTimeout(10_000));

  it('downloads the whisper model when using an own binary', async () => {
    installHandlers();
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    await passLanguageStep();
    fireEvent.click(screen.getByTestId('analyzer-family-harness'));
    await screen.findByTestId('harness-claude-code');
    clickNext();

    await screen.findByTestId('wizard-step-transcription');
    fireEvent.click(screen.getByTestId('transcription-own'));
    fireEvent.change(screen.getByLabelText('Whisper binary path'), { target: { value: '/opt/whisper' } });
    clickNext();
    await advanceFromFaces();
    expect(screen.getAllByTestId('download-task')).toHaveLength(1);
    expect(screen.getByTestId('download-task').textContent).toContain('whisper model base');
  });

  it('disables advancing and does not persist an empty own-binary path', async () => {
    const recorders = installHandlers();
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    await passLanguageStep();
    fireEvent.click(screen.getByTestId('analyzer-family-harness'));
    await screen.findByTestId('harness-claude-code');
    clickNext();
    await screen.findByTestId('wizard-step-transcription');
    fireEvent.click(screen.getByTestId('transcription-own'));

    expect(screen.getByTestId('wizard-next')).toHaveProperty('disabled', true);
    expect(screen.getByTestId('wizard-step-transcription')).toBeDefined();
    expect(recorders.configWrites.some((write) => write.key === 'whisper_binary_path')).toBe(false);
  });

  it('surfaces a non-executable own-binary path before persisting transcription mode', async () => {
    const recorders = installHandlers({ rejectWhisperPath: true });
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    await passLanguageStep();
    fireEvent.click(screen.getByTestId('analyzer-family-harness'));
    await screen.findByTestId('harness-claude-code');
    clickNext();
    await screen.findByTestId('wizard-step-transcription');
    fireEvent.click(screen.getByTestId('transcription-own'));
    fireEvent.change(screen.getByLabelText('Whisper binary path'), { target: { value: '/missing/whisper' } });

    clickNext();

    expect((await screen.findByTestId('transcription-validation-error')).textContent).toContain('whisper_binary_path');
    expect(recorders.configWrites.some((write) => write.key === 'whisper_mode')).toBe(false);
  });

  it('does not list a managed whisper model that is already downloaded', async () => {
    installHandlers({ runtimeAvailable: true, whisperDownloaded: true });
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    await passLanguageStep();
    fireEvent.click(screen.getByTestId('analyzer-family-harness'));
    await screen.findByTestId('harness-claude-code');
    clickNext();
    await screen.findByTestId('wizard-step-transcription');
    clickNext();
    await advanceFromFaces();
    expect(screen.getByTestId('downloads-none')).toBeDefined();
  });

  it('describes frames-only mode honestly when transcription was skipped', async () => {
    installHandlers({ ready: true });
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    await passLanguageStep();
    fireEvent.click(screen.getByTestId('analyzer-family-harness'));
    await screen.findByTestId('harness-claude-code');
    clickNext();
    await screen.findByTestId('wizard-step-transcription');
    fireEvent.click(screen.getByTestId('transcription-skip'));
    clickNext();
    await advanceFromFaces();
    clickNext();
    await screen.findByTestId('readiness-ready');
    clickNext();

    const done = await screen.findByTestId('wizard-step-done');
    expect(done.textContent).toContain('frames-only mode');
    expect(done.textContent).not.toContain('transcription are ready');
  });

  it('lets the user configure later without finishing', async () => {
    installHandlers();
    const onClose = vi.fn();
    renderWithProviders(<SetupWizard open folder="/videos" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('wizard-configure-later'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  const advanceToReadiness = async () => {
    await passLanguageStep();
    fireEvent.click(screen.getByTestId('analyzer-family-harness'));
    await screen.findByTestId('harness-claude-code');
    clickNext();
    await screen.findByTestId('wizard-step-transcription');
    fireEvent.click(screen.getByTestId('transcription-skip'));
    clickNext();
    await advanceFromFaces();
    clickNext();
    await screen.findByTestId('wizard-step-readiness');
  };

  it('renders a full readiness checklist with per-item status and no CLI command strings', async () => {
    installHandlers({ ready: true });
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    await advanceToReadiness();
    await screen.findByTestId('readiness-ready');

    const checklist = await screen.findByTestId('readiness-checklist');
    const rowIds = within(checklist)
      .getAllByTestId('readiness-row')
      .map((row) => row.getAttribute('data-row-id'));
    expect(rowIds).toEqual(
      expect.arrayContaining(['dep-ffmpeg', 'dep-ffprobe', 'dep-whisper', 'dep-local-ai', 'configured-analyzer']),
    );

    const step = screen.getByTestId('wizard-step-readiness');
    expect(step.textContent).not.toContain('ai-video-cataloger');
    expect(step.textContent).not.toContain('Run:');
  });

  it('offers to use the best installed model when the configured whisper model is absent', async () => {
    const activations: string[] = [];
    installHandlers({ ready: true });
    let missing = true;
    server.use(
      http.get('/api/models/whisper', () =>
        ok({
          models: [
            { name: 'base', size: '142 MB', downloaded: false, active: true },
            { name: 'large-v3-turbo', size: '1.6 GB', downloaded: true, active: false },
          ],
        }),
      ),
      http.get('/api/readiness', () =>
        ok({
          ready: !missing,
          analyzer: {
            kind: 'analyzer', family: 'harness', providerId: 'claude-code', name: 'claude-code',
            available: true, message: 'ok', suggestedAction: null,
          },
          transcriber: {
            kind: 'transcriber', mode: 'local', model: 'base', name: 'whisper-base',
            available: !missing, message: missing ? 'missing' : 'ok', suggestedAction: null,
          },
          missingPieces: missing
            ? [{ kind: 'transcriber', name: 'whisper-base', available: false, message: 'missing', suggestedAction: null }]
            : [],
          suggestedAction: null,
        }),
      ),
      http.post('/api/models/whisper/use', async ({ request }) => {
        const body = await request.json();
        activations.push(typeof body === 'object' && body !== null && 'modelName' in body ? String(body.modelName) : '');
        missing = false;
        return ok({ model: 'large-v3-turbo', downloaded: true });
      }),
    );
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    await advanceToReadiness();
    await screen.findByTestId('readiness-not-ready');

    const checklist = await screen.findByTestId('readiness-checklist');
    const whisperRow = within(checklist)
      .getAllByTestId('readiness-row')
      .find((row) => row.getAttribute('data-row-id') === 'configured-whisper-model');
    if (whisperRow === undefined) throw new Error('expected a configured-whisper-model row');
    const action = within(whisperRow).getByTestId('readiness-row-action');
    expect(action.textContent).toBe('Use large-v3-turbo');

    fireEvent.click(action);
    await waitFor(() => expect(activations).toEqual(['large-v3-turbo']));
    await screen.findByTestId('readiness-ready');
  }, scaledTimeout(10_000));

  it('defaults the managed whisper model picker to the best already-installed model', async () => {
    installHandlers({ runtimeAvailable: true });
    server.use(
      http.get('/api/models/whisper', () =>
        ok({
          models: [
            { name: 'base', size: '142 MB', downloaded: false, active: false },
            { name: 'small', size: '466 MB', downloaded: true, active: false },
          ],
        }),
      ),
    );
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    await passLanguageStep();
    fireEvent.click(screen.getByTestId('analyzer-family-harness'));
    await screen.findByTestId('harness-claude-code');
    clickNext();
    await screen.findByTestId('wizard-step-transcription');

    const picker = await screen.findByTestId('wizard-whisper-model-select');
    await waitFor(() => expect(picker.textContent).toContain('small'));
    expect(picker.textContent).not.toContain('base');
  });

  it('places the language step immediately after welcome', async () => {
    installHandlers();
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    await screen.findByTestId('wizard-step-welcome');
    await enterLanguageStep();
    expect(screen.getByTestId('wizard-step-language')).toBeDefined();
    clickNext();
    await screen.findByTestId('wizard-step-analyzer');
    fireEvent.click(screen.getByTestId('wizard-back'));
    await screen.findByTestId('wizard-step-language');
    fireEvent.click(screen.getByTestId('wizard-back'));
    await screen.findByTestId('wizard-step-welcome');
  });

  it('switches the wizard UI language live when the app language changes', async () => {
    const recorders = installHandlers();
    let uiLanguage = 'en';
    server.use(
      http.get('/api/config', () => ok(configView(uiLanguage, 'auto'))),
      http.post('/api/config', async ({ request }) => {
        const body = configBodySchema.parse(await request.json());
        recorders.configWrites.push(body);
        if (body.key === 'ui_language') uiLanguage = body.value;
        return ok({ key: body.key, value: body.value, previousValue: null, scope: 'home' as const, ignoredFolderValue: null });
      }),
    );
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    await enterLanguageStep();
    await waitFor(() =>
      expect(screen.getByTestId('wizard-step-language').textContent).toContain(en.language.stepTitle),
    );

    openSelect('wizard-ui-language-select');
    fireEvent.click(await screen.findByRole('option', { name: en.language.optionPolish }));

    await waitFor(() =>
      expect(screen.getByTestId('wizard-step-language').textContent).toContain(pl.language.stepTitle),
    );
    expect(recorders.configWrites).toContainEqual({ key: 'ui_language', value: 'pl' });
  });

  it('surfaces a failed UI-language write via the validation alert instead of silently reverting the selection', async () => {
    server.use(
      http.get('/api/config', () => ok(configView('en', 'auto'))),
      http.post('/api/config', () => HttpResponse.json(
        { ok: false, error: { code: 'internal', message: 'Could not write ui_language' } },
        { status: 500 },
      )),
    );
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    await enterLanguageStep();

    openSelect('wizard-ui-language-select');
    fireEvent.click(await screen.findByRole('option', { name: en.language.optionPolish }));

    const alert = await screen.findByTestId('language-validation-error');
    expect(alert.textContent).toContain('Could not write ui_language');
  });

  it('persists the chosen output language when advancing from the language step', async () => {
    const recorders = installHandlers();
    server.use(http.get('/api/config', () => ok(configView('en', 'auto'))));
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    await enterLanguageStep();

    openSelect('wizard-output-language-select');
    fireEvent.click(await screen.findByRole('option', { name: en.language.optionPolish }));

    clickNext();
    await screen.findByTestId('wizard-step-analyzer');
    expect(recorders.configWrites).toContainEqual({ key: 'output_language', value: 'pl' });
  });

  it('surfaces a failed language config write without advancing', async () => {
    installHandlers({ rejectConfigKey: 'output_language' });
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    await enterLanguageStep();

    clickNext();

    expect((await screen.findByTestId('language-validation-error')).textContent).toContain('output_language');
    expect(screen.getByTestId('wizard-step-language')).toBeDefined();
  });

  it('preselects the output language from the currently open folder\'s effective config, not the home default', async () => {
    installHandlers();
    server.use(
      http.get('/api/config', ({ request }) => {
        const url = new URL(request.url);
        const scoped = url.searchParams.get('folder') === '/videos';
        return ok(configView('en', scoped ? 'pl' : 'auto'));
      }),
    );
    renderWithProviders(<SetupWizard open folder="/videos" onClose={vi.fn()} />);
    await enterLanguageStep();

    const select = await screen.findByTestId('wizard-output-language-select');
    await waitFor(() => expect(within(select).getByRole('combobox').textContent).toBe(en.language.optionPolish));

    clickNext();
    await screen.findByTestId('wizard-step-analyzer');
  });
});
