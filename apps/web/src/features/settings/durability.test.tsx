import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { en } from '../../i18n/dictionary.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { DURABILITY_REFETCH_INTERVAL_MS, DurabilityIndicator } from './DurabilityIndicator.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

const durability = (overrides: { degraded: boolean; lastErrorCode: string | null }) => ({
  degraded: overrides.degraded,
  pendingWrites: overrides.degraded,
  lastErrorCode: overrides.lastErrorCode,
});

const stubPhotosStatus = (photos: { degraded: boolean; lastErrorCode: string | null }) => {
  server.use(
    http.get('/api/photos/status', () => HttpResponse.json({
      ok: true,
      data: {
        media: 'photo',
        root: null,
        durability: durability(photos),
        counts: {
          photos: 0, paths: 0, exifRead: 0, exifFailed: 0, missing: 0,
          duplicates: 0, proxied: 0, proxyFailed: 0, analysed: 0, facesIndexed: 0,
        },
      },
    })),
  );
};

const stubStatuses = (
  index: { degraded: boolean; lastErrorCode: string | null },
  photos: { degraded: boolean; lastErrorCode: string | null },
) => {
  stubPhotosStatus(photos);
  server.use(
    http.get('/api/index/status', () => HttpResponse.json({
      ok: true,
      data: {
        databasePath: '/catalog.db',
        counts: { folders: 0, files: 0, analyses: 0 },
        folders: [],
        latestRun: null,
        currentMonthSpend: { kind: 'estimate', provider: 'gemini', month: '2026-09', entries: 0, estimatedCostUsd: 0 },
        durability: durability(index),
      },
    })),
  );
};

afterEach(() => {
  vi.useRealTimers();
});

describe('bottom-bar durability indicator', () => {
  it('stays hidden while both stores persist normally', async () => {
    stubStatuses({ degraded: false, lastErrorCode: null }, { degraded: false, lastErrorCode: null });
    renderThemed(<DurabilityIndicator />);

    await waitFor(() => expect(screen.queryByTestId('durability-indicator')).toBeNull());
  });

  it('warns with the error code when the catalog store cannot persist', async () => {
    stubStatuses({ degraded: true, lastErrorCode: 'internal' }, { degraded: false, lastErrorCode: null });
    renderThemed(<DurabilityIndicator />);

    const indicator = await screen.findByTestId('durability-indicator');
    expect(indicator.getAttribute('data-error-code')).toBe('internal');
    expect(indicator.textContent).toContain(en.durability.indicatorLabel);
  });

  it('warns when only the photos store cannot persist', async () => {
    stubStatuses({ degraded: false, lastErrorCode: null }, { degraded: true, lastErrorCode: 'unavailable' });
    renderThemed(<DurabilityIndicator />);

    const indicator = await screen.findByTestId('durability-indicator');
    expect(indicator.getAttribute('data-error-code')).toBe('unavailable');
  });

  it('picks up a store that turned degraded without any user interaction', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let indexDurability: { degraded: boolean; lastErrorCode: string | null } = { degraded: false, lastErrorCode: null };
    server.use(
      http.get('/api/index/status', () => HttpResponse.json({
        ok: true,
        data: {
          databasePath: '/catalog.db',
          counts: { folders: 0, files: 0, analyses: 0 },
          folders: [],
          latestRun: null,
          currentMonthSpend: { kind: 'estimate', provider: 'gemini', month: '2026-09', entries: 0, estimatedCostUsd: 0 },
          durability: durability(indexDurability),
        },
      })),
    );
    stubPhotosStatus({ degraded: false, lastErrorCode: null });
    renderThemed(<DurabilityIndicator />);
    await waitFor(() => expect(screen.queryByTestId('durability-indicator')).toBeNull());

    indexDurability = { degraded: true, lastErrorCode: 'internal' };
    await vi.advanceTimersByTimeAsync(DURABILITY_REFETCH_INTERVAL_MS + 1_000);

    const indicator = await screen.findByTestId('durability-indicator');
    expect(indicator.getAttribute('data-error-code')).toBe('internal');
  });
});
