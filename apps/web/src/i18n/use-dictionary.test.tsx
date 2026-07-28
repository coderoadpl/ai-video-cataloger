import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../test/render.js';
import { server } from '../test/server.js';
import { useDictionary } from './use-dictionary.js';

const CONFIG_KEYS = [
  'whisper_binary_path',
  'whisper_model',
  'whisper_language',
  'whisper_mode',
  'whisper_api_base_url',
  'whisper_api_model',
  'frames',
  'timeout',
  'skip_rename',
  'analyzer_backend',
  'local_model',
  'analyzer_provider',
  'faces_enabled',
  'gemini_batch_mode',
  'gemini_monthly_budget_usd',
  'output_language',
  'ui_language',
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

const Probe = () => {
  const dictionary = useDictionary();
  return <span data-testid="probe">{dictionary.common.save}</span>;
};

describe('useDictionary', () => {
  it('defaults to English before config resolves', () => {
    server.use(http.get('/api/config', () => HttpResponse.json(configResponse('pl'))));
    renderWithProviders(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('Save');
  });

  it('switches language live when the config query is invalidated without remounting', async () => {
    let language = 'en';
    server.use(http.get('/api/config', () => HttpResponse.json(configResponse(language))));
    const { queryClient } = renderWithProviders(<Probe />);

    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('Save'));

    language = 'pl';
    await queryClient.invalidateQueries();

    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('Zapisz'));
  });
});
