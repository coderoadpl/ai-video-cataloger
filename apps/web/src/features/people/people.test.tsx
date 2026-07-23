import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import type { z } from 'zod';

import type { facesPeopleOutputSchema } from '@core/contract/index.js';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { PeopleView } from './PeopleView.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

type FacePerson = z.output<typeof facesPeopleOutputSchema>['people'][number];

const FOLDER = '/videos';
const centroid = Array.from({ length: 128 }, () => 0);

const terminalJob = (jobId: string, kind: string) => ({
  jobId,
  kind,
  status: 'completed',
  progress: null,
  progressEvents: [],
  error: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const person = (overrides: Partial<FacePerson> & { personId: string }): FacePerson => ({
  personId: overrides.personId,
  displayName: overrides.displayName ?? null,
  kind: 'face',
  createdAt: '2026-01-01T00:00:00.000Z',
  centroid,
  exemplarCount: overrides.exemplarCount ?? 1,
  observationCount: overrides.observationCount ?? 1,
  exemplarCropPath: overrides.exemplarCropPath ?? null,
});

const configData = (facesEnabled: boolean) => ({
  config: {
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
    faces_enabled: facesEnabled ? 'true' : 'false',
    output_language: null,
    ui_language: null,
  },
  defaults: defaults(facesEnabled),
  effective: defaults(facesEnabled),
  sources: {
    whisper_binary_path: 'default',
    whisper_model: 'default',
    whisper_mode: 'default',
    whisper_api_base_url: 'default',
    whisper_api_model: 'default',
    frames: 'default',
    timeout: 'default',
    skip_rename: 'default',
    analyzer_backend: 'default',
    local_model: 'default',
    analyzer_provider: 'default',
    faces_enabled: 'home',
    output_language: 'default',
    ui_language: 'default',
  },
});

const defaults = (facesEnabled: boolean) => ({
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
  faces_enabled: facesEnabled ? 'true' : 'false',
  output_language: 'auto',
  ui_language: 'en',
});

const stubPeople = (input: {
  facesEnabled: boolean;
  artifactsReady?: boolean;
  observations?: number;
  people?: FacePerson[];
}) => {
  server.use(
    http.get('/api/config', () => HttpResponse.json({ ok: true, data: configData(input.facesEnabled) })),
    http.get('/api/models/faces', () => HttpResponse.json({
      ok: true,
      data: { artifacts: [], ready: input.artifactsReady ?? true },
    })),
    http.get('/api/faces/status', () => HttpResponse.json({
      ok: true,
      data: {
        enabled: true,
        artifactsReady: input.artifactsReady ?? true,
        people: input.people?.length ?? 0,
        observations: input.observations ?? 0,
        assignedObservations: input.observations ?? 0,
        unassignedObservations: 0,
        filesIndexed: input.observations === undefined || input.observations === 0 ? 0 : 1,
      },
    })),
    http.get('/api/faces/people', () => HttpResponse.json({
      ok: true,
      data: { people: input.people ?? [] },
    })),
    http.get('/api/jobs/status', ({ request }) => {
      const jobId = new URL(request.url).searchParams.get('jobId') ?? '';
      return HttpResponse.json({ ok: true, data: terminalJob(jobId, 'faces_index') });
    }),
  );
};

describe('PeopleView', () => {
  it('shows the opt-in state when face grouping is off', async () => {
    const onOpenSettings = vi.fn();
    stubPeople({ facesEnabled: false });

    renderThemed(
      <PeopleView active folder={FOLDER} addLine={vi.fn()} onOpenSettings={onOpenSettings} intervalMs={0} />,
    );

    expect(await screen.findByTestId('people-disabled-state')).toBeDefined();
    fireEvent.click(screen.getByText('Open Settings'));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('installs face grouping models when enabled but missing', async () => {
    let installBody: unknown = null;
    const addLine = vi.fn();
    stubPeople({ facesEnabled: true, artifactsReady: false });
    server.use(
      http.post('/api/models/faces/install', async ({ request }) => {
        installBody = await request.json();
        return HttpResponse.json({ ok: true, data: { jobId: 'faces-install-1' } });
      }),
    );

    renderThemed(
      <PeopleView active folder={FOLDER} addLine={addLine} onOpenSettings={vi.fn()} intervalMs={0} />,
    );

    fireEvent.click(await screen.findByTestId('people-install-models'));

    await waitFor(() => expect(addLine).toHaveBeenCalledWith('Face grouping models are installed', 'success'));
    expect(installBody).toEqual({ force: false });
  });

  it('shows the empty state and indexes the current folder', async () => {
    let indexBody: unknown = null;
    const addLine = vi.fn();
    stubPeople({ facesEnabled: true, artifactsReady: true, observations: 0, people: [] });
    server.use(
      http.post('/api/faces/index', async ({ request }) => {
        indexBody = await request.json();
        return HttpResponse.json({ ok: true, data: { jobId: 'faces-index-1' } });
      }),
    );

    renderThemed(
      <PeopleView active folder={FOLDER} addLine={addLine} onOpenSettings={vi.fn()} intervalMs={0} />,
    );

    expect(await screen.findByTestId('people-empty-state')).toBeDefined();
    fireEvent.click(screen.getAllByText('Index faces')[0] ?? screen.getByTestId('people-index'));

    await waitFor(() => expect(addLine).toHaveBeenCalledWith('Face grouping index is updated', 'success'));
    expect(indexBody).toEqual({ root: FOLDER });
  });

  it('renders populated people with exemplar crops and observation counts', async () => {
    stubPeople({
      facesEnabled: true,
      artifactsReady: true,
      observations: 4,
      people: [
        person({
          personId: 'p1',
          displayName: 'Alex',
          observationCount: 3,
          exemplarCropPath: '/home/.ai-video-cataloger/faces/p1/exemplar-001.jpg',
        }),
        person({ personId: 'p2', observationCount: 1 }),
      ],
    });

    renderThemed(
      <PeopleView active folder={FOLDER} addLine={vi.fn()} onOpenSettings={vi.fn()} intervalMs={0} />,
    );

    expect(await screen.findByTestId('people-grid')).toBeDefined();
    expect(screen.getByText('Alex')).toBeDefined();
    expect(screen.getByText('Person 2')).toBeDefined();
    expect(screen.getByText('3 observation(s)')).toBeDefined();
    const crop = screen.getByAltText('Alex');
    expect(crop.getAttribute('src')).toContain('media://local/');
  });

  it('wires rename, merge, forget, and purge actions', async () => {
    const bodies: unknown[] = [];
    stubPeople({
      facesEnabled: true,
      artifactsReady: true,
      observations: 3,
      people: [
        person({ personId: 'p1', displayName: 'Alex', observationCount: 2 }),
        person({ personId: 'p2', observationCount: 1 }),
      ],
    });
    server.use(
      http.post('/api/faces/name', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({
          ok: true,
          data: { personId: 'p1', displayName: 'Taylor', affectedFingerprints: [] },
        });
      }),
      http.post('/api/faces/merge', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({
          ok: true,
          data: { fromPersonId: 'p2', toPersonId: 'p1', movedObservations: 1, affectedFingerprints: [] },
        });
      }),
      http.post('/api/faces/forget', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({
          ok: true,
          data: { personId: 'p1', deleted: true, cropPathsDeleted: 1, affectedFingerprints: [] },
        });
      }),
      http.post('/api/faces/purge', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({
          ok: true,
          data: { peopleDeleted: 2, observationsDeleted: 3, cropPathsDeleted: 1 },
        });
      }),
    );

    renderThemed(
      <PeopleView active folder={FOLDER} addLine={vi.fn()} onOpenSettings={vi.fn()} intervalMs={0} />,
    );
    const user = userEvent.setup();

    await screen.findByTestId('people-grid');
    fireEvent.click(screen.getAllByTestId('people-rename')[0] ?? screen.getByText('Rename'));
    fireEvent.change(await screen.findByTestId('people-rename-input'), { target: { value: 'Taylor' } });
    fireEvent.click(screen.getByTestId('people-rename-save'));

    await waitFor(() => expect(bodies).toContainEqual({ personId: 'p1', displayName: 'Taylor' }));
    await user.click(screen.getByLabelText('Select Alex'));
    await user.click(screen.getByLabelText('Select Person 2'));
    await waitFor(() => expect(screen.getByTestId('people-merge-selected').getAttribute('disabled')).toBeNull());
    fireEvent.click(screen.getByTestId('people-merge-selected'));
    fireEvent.click(await screen.findByTestId('people-merge-confirm'));
    await waitFor(() => expect(bodies).toContainEqual({ fromPersonId: 'p2', toPersonId: 'p1' }));

    fireEvent.click(screen.getAllByTestId('people-forget')[0] ?? screen.getByText('Delete'));
    fireEvent.click(await screen.findByTestId('people-forget-confirm'));
    await waitFor(() => expect(bodies).toContainEqual({ personId: 'p1', force: true }));

    fireEvent.click(screen.getByTestId('people-purge'));
    fireEvent.click(await screen.findByTestId('people-purge-confirm'));

    await waitFor(() => expect(bodies).toHaveLength(4));
    expect(bodies).toContainEqual({ personId: 'p1', displayName: 'Taylor' });
    expect(bodies).toContainEqual({ fromPersonId: 'p2', toPersonId: 'p1' });
    expect(bodies).toContainEqual({ personId: 'p1', force: true });
    expect(bodies).toContainEqual({ force: true });
  });
});
