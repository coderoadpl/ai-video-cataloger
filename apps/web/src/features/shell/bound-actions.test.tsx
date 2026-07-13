import { useQuery } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { actions } from '../../api.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';

const HealthProbe = () => {
  const query = useQuery(actions.health);
  return <span>{query.data === undefined ? 'loading' : query.data.version}</span>;
};

describe('bound actions over the MSW harness', () => {
  it('resolves a bound query through the envelope into typed data', async () => {
    server.use(
      http.get('/api/health', () =>
        HttpResponse.json({ ok: true, data: { status: 'ok', version: '9.9.9' } }),
      ),
    );

    renderWithProviders(<HealthProbe />);

    await waitFor(() => expect(screen.getByText('9.9.9')).toBeDefined());
  });
});
