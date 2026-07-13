import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { z } from 'zod';

import type {
  localAiRequirementsOutputSchema,
  localAiTierSchema,
  storedConfigSchema,
} from '@core/contract/index.js';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { SettingsModal } from './SettingsModal.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

type StoredConfig = z.output<typeof storedConfigSchema>;
type Requirements = z.output<typeof localAiRequirementsOutputSchema>;
type Tier = z.output<typeof localAiTierSchema>;

const FOLDER = '/videos';

const defaults = {
  whisper_model: 'base',
  whisper_mode: 'local',
  frames: '3',
  timeout: '120',
  skip_rename: 'false',
  analyzer_backend: 'claude',
  local_model: 'gemma3:12b',
};

const emptyConfig: StoredConfig = {
  whisper_model: null,
  whisper_mode: null,
  frames: null,
  timeout: null,
  skip_rename: null,
  analyzer_backend: null,
  local_model: null,
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

const stubEndpoints = (config: StoredConfig, tiers: Tier[] = []) => {
  server.use(
    http.get('/api/config', () => HttpResponse.json({ ok: true, data: { config, defaults } })),
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

  it('hides the whisper model control when transcription is skipped', async () => {
    stubEndpoints({ ...emptyConfig, whisper_mode: 'skip' });
    renderThemed(<SettingsModal open folder={FOLDER} onClose={vi.fn()} />);

    await screen.findByTestId('whisper-mode-select');
    expect(screen.queryByTestId('whisper-model-control')).toBeNull();
  });

  it('saves only the changed keys and closes on success', async () => {
    const configSetBody = z.object({ key: z.string(), value: z.string() });
    const bodies: { key: string; value: string }[] = [];
    stubEndpoints(emptyConfig);
    server.use(
      http.post('/api/config', async ({ request }) => {
        const body = configSetBody.parse(await request.json());
        bodies.push(body);
        return HttpResponse.json({
          ok: true,
          data: { key: body.key, value: body.value, previousValue: null },
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
    expect(bodies).toEqual([{ key: 'skip_rename', value: 'true' }]);
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
});
