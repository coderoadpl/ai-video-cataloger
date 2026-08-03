import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, it } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { useCatalogLock } from './use-catalog-lock.js';

const theme = createAppTheme('light');

const lockedResponse = () => HttpResponse.json({
  ok: true,
  data: {
    writable: false,
    owner: null,
    blockedBy: { pid: 4321, processName: 'gui', startedAt: '2026-01-01T00:00:00.000Z', hostname: 'host-a' },
    warnings: [],
  },
});

const LockBannerHost = () => {
  const catalogLock = useCatalogLock();
  return <ThemeProvider theme={theme}>{catalogLock.lockBanner}</ThemeProvider>;
};

describe('useCatalogLock retry', () => {
  it('surfaces a failed retry mutation instead of discarding it and re-showing the same banner', async () => {
    server.use(
      http.get('/api/catalog-lock', lockedResponse),
      http.post('/api/catalog-lock/retry', () => HttpResponse.json(
        { ok: false, error: { code: 'conflict', message: 'Still locked by another process' } },
        { status: 409 },
      )),
    );

    renderWithProviders(<LockBannerHost />);

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    await screen.findByText(/Still locked by another process/);
  });
});
