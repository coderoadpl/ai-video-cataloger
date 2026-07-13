import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import type { z } from 'zod';

import type { doctorOutputSchema } from '@core/contract/index.js';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { PrerequisitesModal } from './PrerequisitesModal.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

type DoctorResult = z.output<typeof doctorOutputSchema>;

const machine = { platform: 'darwin', arch: 'arm64', totalMemGB: 16, appleSilicon: true };

const allGood: DoctorResult = {
  dependencies: [
    { name: 'ffmpeg', available: true, version: '6.0', source: 'bundled', path: '/opt/ffmpeg', installHint: '' },
    { name: 'whisper', available: true, version: null, source: 'system', path: null, installHint: '' },
  ],
  machine,
  recommendedLocalModel: 'gemma3:12b',
  allAvailable: true,
};

const withMissing: DoctorResult = {
  dependencies: [
    { name: 'ffmpeg', available: true, version: '6.0', source: 'bundled', path: '/opt/ffmpeg', installHint: '' },
    { name: 'claude', available: false, version: null, source: null, path: null, installHint: 'Install Claude CLI' },
  ],
  machine,
  recommendedLocalModel: null,
  allAvailable: false,
};

describe('prerequisites modal', () => {
  it('shows the loading state then the all-satisfied banner and dependency rows', async () => {
    server.use(http.get('/api/doctor', () => HttpResponse.json({ ok: true, data: allGood })));
    renderThemed(<PrerequisitesModal open onClose={vi.fn()} />);

    expect(screen.getByText('Checking prerequisites…')).toBeDefined();
    expect(await screen.findByText('All prerequisites are satisfied!')).toBeDefined();
    expect(screen.getAllByTestId('dependency-row')).toHaveLength(2);
    expect(screen.getByText('FFmpeg')).toBeDefined();
    expect(screen.getByText('bundled')).toBeDefined();
  });

  it('reports the missing count and shows the install hint', async () => {
    server.use(http.get('/api/doctor', () => HttpResponse.json({ ok: true, data: withMissing })));
    renderThemed(<PrerequisitesModal open onClose={vi.fn()} />);

    expect(await screen.findByText('1 prerequisite(s) missing')).toBeDefined();
    expect(screen.getByText('Install Claude CLI')).toBeDefined();
  });

  it('surfaces an error with retry, then recovers on retry', async () => {
    let calls = 0;
    server.use(
      http.get('/api/doctor', () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json(
            { ok: false, error: { code: 'internal', message: 'doctor blew up' } },
            { status: 500 },
          );
        }
        return HttpResponse.json({ ok: true, data: allGood });
      }),
    );
    renderThemed(<PrerequisitesModal open onClose={vi.fn()} />);

    fireEvent.click(await screen.findByTestId('prerequisites-retry'));

    await waitFor(() => expect(screen.getByText('All prerequisites are satisfied!')).toBeDefined());
  });
});
