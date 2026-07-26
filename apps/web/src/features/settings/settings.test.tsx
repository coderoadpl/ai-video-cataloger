import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { z } from 'zod';

import type {
  localAiRequirementsOutputSchema,
  localAiTierSchema,
  storedConfigSchema,
} from '@core/contract/index.js';

import { en } from '../../i18n/dictionary.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { credentialDeletionMessage } from './settings-model.js';
import { SettingsModal } from './SettingsModal.js';
import { SLOW_SAVE_HINT_MS } from './use-settings.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

type StoredConfig = z.output<typeof storedConfigSchema>;
type Requirements = z.output<typeof localAiRequirementsOutputSchema>;
type Tier = z.output<typeof localAiTierSchema>;

const FOLDER = '/videos';

const defaults = {
  whisper_binary_path: '',
  whisper_model: 'base',
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
  output_language: 'auto',
  ui_language: 'en',
};

const emptyConfig: StoredConfig = {
  whisper_binary_path: null,
  whisper_model: null,
  whisper_mode: null,
  whisper_api_base_url: null,
  whisper_api_model: null,
  frames: null,
  timeout: null,
  skip_rename: null,
  analyzer_backend: null,
  local_model: null,
  analyzer_provider: null,
  faces_enabled: null,
  output_language: null,
  ui_language: null,
};

const apiProviderConfig: StoredConfig = {
  ...emptyConfig,
  analyzer_provider: JSON.stringify({
    family: 'api',
    providerId: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyRef: 'openai',
    model: 'vision-model',
    maxImageDetail: 'auto',
  }),
};

const makeTier = (overrides: Partial<Tier> & { tag: Tier['tag'] }): Tier => ({
  label: 'A tier',
  downloadGB: 8.1,
  minTotalMemGB: 16,
  supportLevel: 'ok',
  installed: false,
  recommended: false,
  ...overrides,
});

const requirements = (tiers: Tier[]): Requirements => ({
  machine: { platform: 'darwin', arch: 'arm64', totalMemGB: 16, appleSilicon: true },
  runtimeUp: false,
  runtimeVersion: '',
  tiers,
});

const stubEndpoints = (
  config: StoredConfig,
  tiers: Tier[] = [],
  inherited?: { effective: typeof defaults; sources: Record<keyof StoredConfig, 'folder' | 'home' | 'default'> } | undefined,
) => {
  const effective = inherited?.effective ?? {
    whisper_binary_path: config.whisper_binary_path ?? defaults.whisper_binary_path,
    whisper_model: config.whisper_model ?? defaults.whisper_model,
    whisper_mode: config.whisper_mode ?? defaults.whisper_mode,
    whisper_api_base_url: config.whisper_api_base_url ?? defaults.whisper_api_base_url,
    whisper_api_model: config.whisper_api_model ?? defaults.whisper_api_model,
    frames: config.frames ?? defaults.frames,
    timeout: config.timeout ?? defaults.timeout,
    skip_rename: config.skip_rename ?? defaults.skip_rename,
    analyzer_backend: config.analyzer_backend ?? defaults.analyzer_backend,
    local_model: config.local_model ?? defaults.local_model,
    analyzer_provider: config.analyzer_provider ?? defaults.analyzer_provider,
    faces_enabled: config.faces_enabled ?? defaults.faces_enabled,
    output_language: config.output_language ?? defaults.output_language,
    ui_language: config.ui_language ?? defaults.ui_language,
  };
  const sources = inherited?.sources ?? {
    whisper_binary_path: config.whisper_binary_path === null ? 'default' : 'folder',
    whisper_model: config.whisper_model === null ? 'default' : 'folder',
    whisper_mode: config.whisper_mode === null ? 'default' : 'folder',
    whisper_api_base_url: config.whisper_api_base_url === null ? 'default' : 'folder',
    whisper_api_model: config.whisper_api_model === null ? 'default' : 'folder',
    frames: config.frames === null ? 'default' : 'folder',
    timeout: config.timeout === null ? 'default' : 'folder',
    skip_rename: config.skip_rename === null ? 'default' : 'folder',
    analyzer_backend: config.analyzer_backend === null ? 'default' : 'folder',
    local_model: config.local_model === null ? 'default' : 'folder',
    analyzer_provider: config.analyzer_provider === null ? 'default' : 'folder',
    faces_enabled: config.faces_enabled === null ? 'default' : 'folder',
    output_language: config.output_language === null ? 'default' : 'folder',
    ui_language: config.ui_language === null ? 'default' : 'folder',
  } as const;
  server.use(
    http.get('/api/config', ({ request }) => {
      const requestedFolder = new URL(request.url).searchParams.get('folder');
      if (requestedFolder !== null) expect(requestedFolder).toBe(FOLDER);
      return HttpResponse.json({ ok: true, data: { config, defaults, effective, sources } });
    }),
    http.get('/api/models/local-ai/requirements', () =>
      HttpResponse.json({ ok: true, data: requirements(tiers) }),
    ),
  );
};

describe('settings modal', () => {
  it('asks for a folder when none is selected', () => {
    renderThemed(<SettingsModal open folder={null} onClose={vi.fn()} />);
    expect(screen.getByTestId('settings-no-folder')).toBeDefined();
  });

  it('loads config and shows the whisper model control only in local mode', async () => {
    stubEndpoints(emptyConfig);
    renderThemed(<SettingsModal open folder={FOLDER} onClose={vi.fn()} />);

    await screen.findByTestId('whisper-mode-select');
    expect(screen.getByTestId('whisper-model-control')).toBeDefined();
    expect(screen.getByText('3 frames')).toBeDefined();
  });

  it('opens the setup wizard from a re-entry affordance without closing on save', async () => {
    stubEndpoints(emptyConfig);
    const onRunWizard = vi.fn();
    renderThemed(<SettingsModal open folder={FOLDER} onClose={vi.fn()} onRunWizard={onRunWizard} />);

    const button = await screen.findByTestId('settings-run-wizard');
    fireEvent.click(button);
    expect(onRunWizard).toHaveBeenCalledTimes(1);
  });

  it('hides the wizard affordance when no re-entry handler is provided', async () => {
    stubEndpoints(emptyConfig);
    renderThemed(<SettingsModal open folder={FOLDER} onClose={vi.fn()} />);

    await screen.findByTestId('whisper-mode-select');
    expect(screen.queryByTestId('settings-run-wizard')).toBeNull();
  });

  it('shows effective inherited values without creating folder overrides', async () => {
    const effective = { ...defaults, frames: '7', whisper_model: 'small' };
    const sources = {
      whisper_binary_path: 'default',
      whisper_model: 'home',
      whisper_mode: 'default',
      whisper_api_base_url: 'default',
      whisper_api_model: 'default',
      frames: 'home',
      timeout: 'default',
      skip_rename: 'default',
      analyzer_backend: 'default',
      local_model: 'default',
      analyzer_provider: 'default',
      faces_enabled: 'default',
      output_language: 'default',
      ui_language: 'default',
    } as const;
    stubEndpoints(emptyConfig, [], { effective, sources });
    renderThemed(<SettingsModal open folder={FOLDER} onClose={vi.fn()} />);

    expect(await screen.findByText('7 frames')).toBeDefined();
    const hint = screen.getByTestId('settings-inherited-hint');
    expect(hint.textContent).toContain('frames: 7 (home)');
    expect(hint.textContent).toContain('whisper_model: small (home)');
    expect(screen.getByTestId('settings-save').getAttribute('disabled')).not.toBeNull();
  });

  it('hides the whisper model control when transcription is skipped', async () => {
    stubEndpoints({ ...emptyConfig, whisper_mode: 'skip' });
    renderThemed(<SettingsModal open folder={FOLDER} onClose={vi.fn()} />);

    await screen.findByTestId('whisper-mode-select');
    expect(screen.queryByTestId('whisper-model-control')).toBeNull();
  });

  it('forces transcription to skip and locks the control when Gemini native video is selected', async () => {
    stubEndpoints(emptyConfig);
    renderThemed(<SettingsModal open folder={FOLDER} onClose={vi.fn()} />);

    const backendSelect = await screen.findByTestId('analyzer-backend-select');
    fireEvent.mouseDown(within(backendSelect).getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'Gemini (native video)' }));

    await waitFor(() => {
      expect(screen.getByTestId('whisper-mode-native-notice')).toBeDefined();
    });
    expect(screen.queryByTestId('whisper-model-control')).toBeNull();
    expect(within(screen.getByTestId('whisper-mode-select')).getByRole('combobox').getAttribute('aria-disabled')).toBe('true');
  });

  it('saves only the changed keys and closes on success', async () => {
    const configSetBody = z.object({ folder: z.literal(FOLDER), key: z.string(), value: z.string() });
    const bodies: { folder: typeof FOLDER; key: string; value: string }[] = [];
    stubEndpoints(emptyConfig);
    server.use(
      http.post('/api/config', async ({ request }) => {
        const body = configSetBody.parse(await request.json());
        bodies.push(body);
        return HttpResponse.json({
          ok: true,
          data: { key: body.key, value: body.value, previousValue: null, scope: 'home' as const, ignoredFolderValue: null },
        });
      }),
    );
    const onClose = vi.fn();
    renderThemed(<SettingsModal open folder={FOLDER} onClose={onClose} />);

    const toggle = await screen.findByTestId('skip-rename-switch');
    const save = screen.getByTestId('settings-save');
    expect(save.getAttribute('disabled')).not.toBeNull();

    fireEvent.click(toggle);
    await waitFor(() => expect(save.getAttribute('disabled')).toBeNull());

    fireEvent.click(save);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(bodies).toEqual([{ folder: FOLDER, key: 'skip_rename', value: 'true' }]);
  });

  it('shows local face grouping copy and saves the opt-in globally', async () => {
    const configSetBody = z.object({ folder: z.string().optional(), key: z.string(), value: z.string() });
    const bodies: { folder?: string | undefined; key: string; value: string }[] = [];
    stubEndpoints(emptyConfig);
    server.use(
      http.post('/api/config', async ({ request }) => {
        const body = configSetBody.parse(await request.json());
        bodies.push(body);
        return HttpResponse.json({
          ok: true,
          data: { key: body.key, value: body.value, previousValue: null, scope: 'home' as const, ignoredFolderValue: null },
        });
      }),
    );
    const onClose = vi.fn();
    renderThemed(<SettingsModal open folder={FOLDER} onClose={onClose} />);

    expect(await screen.findByText('Local face grouping (experimental)')).toBeDefined();
    expect(screen.getByText(/face grouping is opt-in/u).textContent).toContain('grouping');
    expect(screen.queryByText(/recognition/iu)).toBeNull();

    fireEvent.click(screen.getByTestId('faces-enabled-switch'));
    fireEvent.click(screen.getByTestId('settings-save'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(bodies).toEqual([{ key: 'faces_enabled', value: 'true' }]);
  });

  it('saves the UI language globally so the switch applies and persists', async () => {
    const configSetBody = z.object({ folder: z.string().optional(), key: z.string(), value: z.string() });
    const bodies: { folder?: string | undefined; key: string; value: string }[] = [];
    stubEndpoints(emptyConfig);
    server.use(
      http.post('/api/config', async ({ request }) => {
        const body = configSetBody.parse(await request.json());
        bodies.push(body);
        return HttpResponse.json({
          ok: true,
          data: { key: body.key, value: body.value, previousValue: null, scope: 'home' as const, ignoredFolderValue: null },
        });
      }),
    );
    const onClose = vi.fn();
    renderThemed(<SettingsModal open folder={FOLDER} onClose={onClose} />);

    const uiSelect = await screen.findByTestId('ui-language-select');
    fireEvent.mouseDown(within(uiSelect).getByRole('combobox'));
    const listbox = await screen.findByRole('listbox');
    fireEvent.click(within(listbox).getByText('Polish'));

    fireEvent.click(screen.getByTestId('settings-save'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(bodies).toEqual([{ key: 'ui_language', value: 'pl' }]);
  });

  it('warns when the selected local model is unsupported', async () => {
    stubEndpoints({ ...emptyConfig, analyzer_backend: 'local', local_model: 'gemma3:27b' }, [
      makeTier({ tag: 'gemma3:27b', supportLevel: 'insufficient-ram', installed: false }),
    ]);
    renderThemed(<SettingsModal open folder={FOLDER} onClose={vi.fn()} />);

    expect(await screen.findByTestId('local-model-unsupported-hint')).toBeDefined();
  });

  it('hints when a supported local model is not yet installed', async () => {
    stubEndpoints({ ...emptyConfig, analyzer_backend: 'local', local_model: 'gemma3:12b' }, [
      makeTier({ tag: 'gemma3:12b', supportLevel: 'ok', installed: false }),
    ]);
    renderThemed(<SettingsModal open folder={FOLDER} onClose={vi.fn()} />);

    expect(await screen.findByTestId('local-model-missing-hint')).toBeDefined();
  });

  it('shows the mandatory API charge notice and stores password input separately', async () => {
    const credentialBodies: unknown[] = [];
    stubEndpoints({
      ...emptyConfig,
      analyzer_provider: JSON.stringify({
        family: 'api',
        providerId: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKeyRef: 'openrouter',
        model: 'vision-model',
        maxImageDetail: 'auto',
      }),
    });
    server.use(
      http.post('/api/credentials', async ({ request }) => {
        const body = await request.json();
        credentialBodies.push(body);
        return HttpResponse.json({ ok: true, data: { providerId: 'openrouter', stored: true, backend: { backend: 'keychain', reason: 'ok' } } });
      }),
    );
    const onClose = vi.fn();
    renderThemed(<SettingsModal open folder={FOLDER} onClose={onClose} />);

    expect(await screen.findByText('usage will be charged by your API provider')).toBeDefined();
    const credential = screen.getByLabelText('API credential');
    expect(credential.getAttribute('type')).toBe('password');
    fireEvent.change(credential, { target: { value: 'secret-from-ui' } });
    fireEvent.click(screen.getByTestId('settings-save'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(credentialBodies).toEqual([{ providerId: 'openrouter', credential: 'secret-from-ui' }]);
  });

  it('derives the API credential slot when the endpoint changes', async () => {
    const credentialBodies: unknown[] = [];
    stubEndpoints({
      ...emptyConfig,
      analyzer_provider: JSON.stringify({
        family: 'api',
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKeyRef: 'openai',
        model: 'vision-model',
        maxImageDetail: 'auto',
      }),
    });
    server.use(
      http.post('/api/config', async ({ request }) => {
        const body = z.object({ key: z.string(), value: z.string() }).parse(await request.json());
        return HttpResponse.json({ ok: true, data: { ...body, previousValue: null, scope: 'home', ignoredFolderValue: null } });
      }),
      http.post('/api/credentials', async ({ request }) => {
        const body = await request.json();
        credentialBodies.push(body);
        return HttpResponse.json({ ok: true, data: { providerId: 'openrouter.ai', stored: true, backend: { backend: 'keychain', reason: 'ok' } } });
      }),
    );
    renderThemed(<SettingsModal open folder={FOLDER} onClose={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText('Base URL'), {
      target: { value: 'https://openrouter.ai/api/v1' },
    });
    fireEvent.change(screen.getByLabelText('API credential'), { target: { value: 'router-secret' } });
    fireEvent.click(screen.getByTestId('settings-save'));

    await waitFor(() => expect(credentialBodies).toEqual([
      { providerId: 'openrouter.ai', credential: 'router-secret' },
    ]));
  });

  it('forgets the analyzer credential and reports the backends that were cleared', async () => {
    const deleteBodies: unknown[] = [];
    stubEndpoints(apiProviderConfig);
    server.use(
      http.delete('/api/credentials', async ({ request }) => {
        deleteBodies.push(await request.json());
        return HttpResponse.json({
          ok: true,
          data: { providerId: 'openai', cleared: ['file'], retained: ['keychain'] },
        });
      }),
    );
    renderThemed(<SettingsModal open folder={FOLDER} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByTestId('forget-credential-button'));

    await waitFor(() => expect(deleteBodies).toEqual([{ providerId: 'openai' }]));
    expect((await screen.findByTestId('forget-credential-result')).textContent).toBe(
      `${en.credentials.clearedFile} ${en.credentials.keychainRetained}`,
    );
  });

  it('keeps the modal open on a partial forget so the retained keychain is readable', async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    stubEndpoints(apiProviderConfig);
    server.use(
      http.delete('/api/credentials', () =>
        HttpResponse.json({ ok: true, data: { providerId: 'openai', cleared: [], retained: ['keychain'] } })),
    );
    renderThemed(<SettingsModal open folder={FOLDER} onClose={onClose} onSaved={onSaved} />);

    fireEvent.click(await screen.findByTestId('forget-credential-button'));

    const result = await screen.findByTestId('forget-credential-result');
    expect(result.textContent).toBe(en.credentials.keychainRetained);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(result.getAttribute('data-severity')).toBe('warning');
  });

  it('confirms a complete forget in place instead of closing the modal', async () => {
    const onClose = vi.fn();
    stubEndpoints(apiProviderConfig);
    server.use(
      http.delete('/api/credentials', () =>
        HttpResponse.json({
          ok: true,
          data: { providerId: 'openai', cleared: ['keychain', 'file'], retained: [] },
        })),
    );
    renderThemed(<SettingsModal open folder={FOLDER} onClose={onClose} />);

    fireEvent.click(await screen.findByTestId('forget-credential-button'));

    const result = await screen.findByTestId('forget-credential-result');
    expect(result.textContent).toBe(en.credentials.clearedBoth);
    expect(onClose).not.toHaveBeenCalled();
    expect(result.getAttribute('data-severity')).toBe('success');
  });

  it('says what a stalled save is waiting for instead of freezing on Saving…', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubEndpoints(apiProviderConfig);
    server.use(http.post('/api/credentials', () => new Promise(() => undefined)));
    renderThemed(<SettingsModal open folder={FOLDER} onClose={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText('API credential'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByTestId('settings-save'));

    await waitFor(() => expect(screen.getByTestId('settings-save').textContent).toBe(en.settingsModal.saving));
    expect(screen.queryByTestId('settings-saving-hint')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SLOW_SAVE_HINT_MS);
    });
    expect(screen.getByTestId('settings-saving-hint').textContent).toBe(en.settingsModal.savingKeychainHint);
    vi.useRealTimers();
  });

  it('stores an OpenAI credential for API transcription', async () => {
    const credentialBodies: unknown[] = [];
    stubEndpoints({ ...emptyConfig, whisper_mode: 'api' });
    server.use(
      http.post('/api/credentials', async ({ request }) => {
        const body = await request.json();
        credentialBodies.push(body);
        return HttpResponse.json({ ok: true, data: { providerId: 'openai', stored: true, backend: { backend: 'keychain', reason: 'ok' } } });
      }),
    );
    renderThemed(<SettingsModal open folder={FOLDER} onClose={vi.fn()} />);

    const credential = await screen.findByLabelText('OpenAI Whisper API key');
    expect(credential.getAttribute('type')).toBe('password');
    fireEvent.change(credential, { target: { value: 'whisper-secret' } });
    fireEvent.click(screen.getByTestId('settings-save'));

    await waitFor(() => expect(credentialBodies).toEqual([
      { providerId: 'openai', credential: 'whisper-secret' },
    ]));
  });
});

describe('credentialDeletionMessage', () => {
  it('says only that the keychain kept the key when nothing was cleared', () => {
    expect(credentialDeletionMessage(en, { cleared: [], retained: ['keychain'] })).toBe(
      en.credentials.keychainRetained,
    );
  });

  it('says nothing was stored when both lists are empty', () => {
    expect(credentialDeletionMessage(en, { cleared: [], retained: [] })).toBe(en.credentials.notStored);
  });

  it('names both backends when both were cleared', () => {
    expect(credentialDeletionMessage(en, { cleared: ['keychain', 'file'], retained: [] })).toBe(
      en.credentials.clearedBoth,
    );
  });

  it('names the keychain alone when only it was cleared', () => {
    expect(credentialDeletionMessage(en, { cleared: ['keychain'], retained: [] })).toBe(
      en.credentials.clearedKeychain,
    );
  });
});
