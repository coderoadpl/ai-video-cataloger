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

const configured: DoctorResult['configured'] = {
  ready: true,
  analyzer: {
    kind: 'analyzer',
    family: 'harness',
    providerId: 'claude-code',
    name: 'claude-code',
    available: true,
    message: 'claude-code is available',
    suggestedAction: null,
    warning: null,
  },
  transcriber: {
    kind: 'transcriber',
    mode: 'local',
    model: 'base',
    name: 'whisper-base',
    available: true,
    message: 'whisper-base is available',
    suggestedAction: null,
    warning: null,
    engine: null,
    binaryPath: null,
  },
  missingPieces: [],
  suggestedAction: null,
};

const machine = { platform: 'darwin', arch: 'arm64', totalMemGB: 16, appleSilicon: true };

const allGood: DoctorResult = {
  configured,
  dependencies: [
    { name: 'ffmpeg', available: true, version: '6.0', source: 'bundled', path: '/opt/ffmpeg', installHint: '' },
    { name: 'whisper', available: true, version: null, source: 'system', path: null, installHint: '' },
  ],
  harnesses: [],
  machine,
  recommendedLocalModel: 'gemma3:12b',
  allAvailable: true,
  warnings: [],
};

const withMissing: DoctorResult = {
  configured,
  dependencies: [
    { name: 'ffmpeg', available: true, version: '6.0', source: 'bundled', path: '/opt/ffmpeg', installHint: '' },
    { name: 'claude', available: false, version: null, source: null, path: null, installHint: 'Install Claude CLI' },
  ],
  harnesses: [],
  machine,
  recommendedLocalModel: null,
  allAvailable: false,
  warnings: [],
};

const withStaleCli: DoctorResult = {
  ...allGood,
  warnings: [{
    code: 'stale_cli',
    message: 'The "ai-video-cataloger" on your PATH is version 0.4.1, but this app is version 0.6.0. Shadowing it: /opt/homebrew/bin/ai-video-cataloger (version 0.4.1, remove it manually or adjust your PATH).',
  }],
};

describe('prerequisites modal', () => {
  it('lists doctor warnings with the shadowing paths under a translated heading', async () => {
    server.use(http.get('/api/doctor', () => HttpResponse.json({ ok: true, data: withStaleCli })));
    server.use(http.get('/api/readiness', () => HttpResponse.json({ ok: true, data: configured })));
    renderThemed(<PrerequisitesModal open folder="/videos/selected" onClose={vi.fn()} />);

    const warning = await screen.findByTestId('doctor-warning');
    expect(warning.getAttribute('data-warning-code')).toBe('stale_cli');
    expect(warning.textContent).toContain('/opt/homebrew/bin/ai-video-cataloger');
    expect(screen.getByText('Warnings')).toBeDefined();
  });

  it('shows the loading state then the all-satisfied banner and dependency rows', async () => {
    server.use(http.get('/api/doctor', () => HttpResponse.json({ ok: true, data: allGood })));
    server.use(http.get('/api/readiness', () => HttpResponse.json({ ok: true, data: configured })));
    renderThemed(<PrerequisitesModal open folder="/videos/selected" onClose={vi.fn()} />);

    expect(screen.getByText('Checking prerequisites…')).toBeDefined();
    expect(await screen.findByText('All prerequisites are satisfied!')).toBeDefined();
    expect(screen.getByText('The selected folder is ready for analysis.')).toBeDefined();
    expect(screen.getAllByTestId('dependency-row')).toHaveLength(2);
    expect(screen.getByText('FFmpeg')).toBeDefined();
    expect(screen.getByText('bundled')).toBeDefined();
  });

  it('reports the missing count and shows the install hint', async () => {
    server.use(http.get('/api/doctor', () => HttpResponse.json({ ok: true, data: withMissing })));
    server.use(http.get('/api/readiness', () => HttpResponse.json({ ok: true, data: configured })));
    renderThemed(<PrerequisitesModal open folder="/videos/selected" onClose={vi.fn()} />);

    expect(await screen.findByText('1 prerequisite(s) missing')).toBeDefined();
    expect(screen.getByText('Install Claude CLI')).toBeDefined();
  });

  it('uses readiness for the selected folder instead of the doctor embedded view', async () => {
    const selectedReadiness: DoctorResult['configured'] = {
      ...configured,
      ready: false,
      analyzer: {
        ...configured.analyzer,
        available: false,
        message: 'openrouter is unavailable',
        suggestedAction: 'Add the selected folder API key',
      },
      missingPieces: [{
        kind: 'analyzer',
        name: 'openrouter',
        available: false,
        message: 'openrouter is unavailable',
        suggestedAction: 'Add the selected folder API key',
        warning: null,
      }],
      suggestedAction: 'Add the selected folder API key',
    };
    const readinessFolders: Array<string | null> = [];
    server.use(http.get('/api/doctor', () => HttpResponse.json({ ok: true, data: allGood })));
    server.use(http.get('/api/readiness', ({ request }) => {
      readinessFolders.push(new URL(request.url).searchParams.get('folder'));
      return HttpResponse.json({ ok: true, data: selectedReadiness });
    }));

    renderThemed(<PrerequisitesModal open folder="/videos/selected" onClose={vi.fn()} />);

    expect(await screen.findByText('Add the selected folder API key')).toBeDefined();
    expect(screen.queryByText('The selected folder is ready for analysis.')).toBeNull();
    expect(readinessFolders).toEqual(['/videos/selected']);
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
      http.get('/api/readiness', () => HttpResponse.json({ ok: true, data: configured })),
    );
    renderThemed(<PrerequisitesModal open folder="/videos/selected" onClose={vi.fn()} />);

    fireEvent.click(await screen.findByTestId('prerequisites-retry'));

    await waitFor(() => expect(screen.getByText('All prerequisites are satisfied!')).toBeDefined());
  });
});
