import { ThemeProvider } from '@mui/material/styles';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import type { scanVideoSchema } from '@core/contract/index.js';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { pl } from '../../i18n/dictionary.js';
import { StatusActions } from './StatusActions.js';

type DetailsVideo = z.output<typeof scanVideoSchema>;

const theme = createAppTheme('light');
const renderThemed = (ui: Parameters<typeof renderWithProviders>[0]) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

const makeVideo = (overrides: Partial<DetailsVideo> = {}): DetailsVideo => ({
  path: '/videos/clip.mp4',
  filename: 'clip.mp4',
  size: 2048,
  sizeFormatted: '2.0 KB',
  duration: 90,
  durationFormatted: '1:30',
  status: 'error',
  errorMessage: null,
  contentHash: 'hash-a',
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
  ...overrides,
});

const CONFIG_KEYS = [
  'whisper_binary_path', 'whisper_model', 'whisper_language', 'whisper_mode', 'whisper_api_base_url',
  'whisper_api_model', 'frames', 'timeout', 'skip_rename', 'analyzer_backend', 'local_model',
  'analyzer_provider', 'faces_enabled', 'gemini_batch_mode', 'gemini_monthly_budget_usd',
  'output_language', 'tag_language', 'ui_language',
] as const;

const record = <T,>(build: (key: string) => T): Record<string, T> =>
  Object.fromEntries(CONFIG_KEYS.map((key) => [key, build(key)]));

const configResponse = (uiLanguage: string) => ({
  ok: true,
  data: {
    config: record(() => null),
    defaults: record((key) => (key === 'ui_language' ? 'en' : 'x')),
    effective: record((key) => (key === 'ui_language' ? uiLanguage : 'x')),
    sources: record(() => 'default'),
  },
});

const usePolishLocale = () => {
  server.use(http.get('/api/config', () => HttpResponse.json(configResponse('pl'))));
};

const LEAKED_LEGACY_ERROR =
  'Command failed: /var/folders/s4/xw5m39vj0bvd7z1v0pcs5ssr0000gn/T/cmux-cli-shims/8DC7FBD3-E6C8-42C3-B012-BECEA9CC11AD/claude';

describe('StatusActions error rendering', () => {
  it('never renders a raw filesystem path from a stored legacy error string', () => {
    renderThemed(
      <StatusActions video={makeVideo({ errorMessage: LEAKED_LEGACY_ERROR })} analyzing={false} onAnalyze={vi.fn()} />,
    );

    expect(screen.queryByText(/\/var\/folders/)).toBeNull();
    expect(screen.queryByText(/cmux-cli-shims/)).toBeNull();
    expect(document.body.innerHTML).not.toContain('/var/folders');
    expect(document.body.innerHTML).not.toContain('cmux-cli-shims');
  });

  it('never lets an English "Command failed" sentence reach the DOM when the UI language is Polish', async () => {
    usePolishLocale();
    renderThemed(
      <StatusActions video={makeVideo({ errorMessage: LEAKED_LEGACY_ERROR })} analyzing={false} onAnalyze={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(pl.errors.analyzerFailed)).toBeDefined());
    expect(document.body.textContent).not.toContain('Command failed');
  });

  it('exposes an analysis-error-card testid so an automated walkthrough can tell an error state from a timeout', () => {
    renderThemed(
      <StatusActions video={makeVideo({ status: 'error' })} analyzing={false} onAnalyze={vi.fn()} />,
    );

    expect(screen.getByTestId('analysis-error-card')).toBeDefined();
  });

  it('never renders an analysis-error-card for a completed video', () => {
    renderThemed(
      <StatusActions video={makeVideo({ status: 'completed' })} analyzing={false} onAnalyze={vi.fn()} />,
    );

    expect(screen.queryByTestId('analysis-error-card')).toBeNull();
  });
});

describe('StatusActions disabled-reason attribute', () => {
  it('exposes the disabled reason as data-disabled-reason on the analyze button', () => {
    renderThemed(
      <StatusActions
        video={makeVideo({ status: 'pending' })}
        analyzing={false}
        onAnalyze={vi.fn()}
        disabledReason="No analyzer configured"
      />,
    );

    expect(screen.getByTestId('analyze-button').getAttribute('data-disabled-reason')).toBe('No analyzer configured');
  });

  it('leaves data-disabled-reason empty when the action is enabled', () => {
    renderThemed(
      <StatusActions video={makeVideo({ status: 'pending' })} analyzing={false} onAnalyze={vi.fn()} />,
    );

    expect(screen.getByTestId('analyze-button').getAttribute('data-disabled-reason')).toBe('');
  });
});
