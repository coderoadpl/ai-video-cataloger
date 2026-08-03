import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { configResponse } from '../test/config-response.js';
import { renderWithProviders } from '../test/render.js';
import { server } from '../test/server.js';
import { useDictionary } from './use-dictionary.js';

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
