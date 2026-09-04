import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { z } from 'zod';

import type { facesPeopleOutputSchema } from '@core/contract/index.js';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { scaledTimeout } from '../../../../../test/helpers/gate-timeout.js';
import { createAppTheme } from '../../theme.js';
import { PeopleView, type PeopleViewProps } from './PeopleView.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

type FacePerson = z.output<typeof facesPeopleOutputSchema>['people'][number];

const FOLDER = '/videos';
const centroid = Array.from({ length: 128 }, () => 0);

const terminalJob = (jobId: string, kind: string, result?: unknown) => ({
  jobId,
  kind,
  status: 'completed',
  progress: null,
  progressEvents: [],
  ...(result === undefined ? {} : { result }),
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
  videoCount: overrides.videoCount ?? overrides.observationCount ?? 1,
  photoCount: overrides.photoCount ?? 0,
  fileCounts: overrides.fileCounts ?? {
    video: overrides.videoCount ?? overrides.observationCount ?? 1,
    photo: overrides.photoCount ?? 0,
  },
  exemplarCropPath: overrides.exemplarCropPath ?? null,
  exemplarCropPaths: overrides.exemplarCropPaths ?? [],
});

const configData = (facesEnabled: boolean) => ({
  config: {
    whisper_binary_path: null,
    whisper_model: null,
    whisper_language: null,
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
    gemini_batch_mode: null,
    gemini_monthly_budget_usd: null,
    output_language: null,
    tag_language: null,
    ui_language: null,
    backup_enabled: null,
    backup_provider: null,
    backup_include_optional: null,
    backup_keep_last: null,
    backup_keep_weekly: null,
    backup_folder_id: null,
    backup_shared_drive_id: null,
    backup_service_account_fingerprint: null,
    backup_account_email: null,
  },
  defaults: defaults(facesEnabled),
  effective: defaults(facesEnabled),
  sources: {
    whisper_binary_path: 'default',
    whisper_model: 'default',
    whisper_language: 'default',
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
    gemini_batch_mode: 'default',
    gemini_monthly_budget_usd: 'default',
    output_language: 'default',
    tag_language: 'default',
    ui_language: 'default',
    backup_enabled: 'default',
    backup_provider: 'default',
    backup_include_optional: 'default',
    backup_keep_last: 'default',
    backup_keep_weekly: 'default',
    backup_folder_id: 'default',
    backup_shared_drive_id: 'default',
    backup_service_account_fingerprint: 'default',
    backup_account_email: 'default',
  },
});

const defaults = (facesEnabled: boolean) => ({
  whisper_binary_path: '',
  whisper_model: 'base',
  whisper_language: 'auto',
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
  gemini_batch_mode: 'false',
  gemini_monthly_budget_usd: 'null',
  output_language: 'auto',
  tag_language: 'auto',
  ui_language: 'en',
  backup_enabled: 'false',
  backup_provider: 'google_oauth',
  backup_include_optional: 'false',
  backup_keep_last: '7',
  backup_keep_weekly: '8',
  backup_folder_id: '',
  backup_shared_drive_id: '',
  backup_service_account_fingerprint: '',
  backup_account_email: '',
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
        videosIndexed: input.observations === undefined || input.observations === 0 ? 0 : 1,
        photosWithFaces: 0,
        photosProcessed: 0,
        staleVersionFiles: 0,
        stalePhotoFiles: 0,
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

const personLibraryRequests: unknown[] = [];

const stubPersonLibraryActions = () => {
  personLibraryRequests.length = 0;
  server.use(
    http.post('/api/library/selection/preview', async ({ request }) => {
      personLibraryRequests.push(await request.json());
      return HttpResponse.json({
        ok: true,
        data: {
          total: 2,
          videoCount: 1,
          photoCount: 1,
          hiddenCount: 0,
          visibleCount: 2,
          sharedWithOtherPeople: 1,
          roots: [{
            folderId: '11111111-1111-4111-8111-111111111111',
            displayName: 'Sample root',
            currentPath: '/fixtures/root',
            fileCount: 2,
            writable: true,
            online: true,
          }],
        },
      });
    }),
    http.post('/api/library/hide', async ({ request }) => {
      personLibraryRequests.push(await request.json());
      return HttpResponse.json({ ok: true, data: { requested: 2, changed: 2, unchanged: 0, videos: 1, photos: 1 } });
    }),
    http.post('/api/library/trash', async ({ request }) => {
      personLibraryRequests.push(await request.json());
      return HttpResponse.json({ ok: true, data: { kind: 'job', jobId: 'job-trash-person' } });
    }),
    http.get('/api/jobs/status', () => HttpResponse.json({
      ok: true,
      data: terminalJob('job-trash-person', 'library_trash', {
        kind: 'library_trash',
        filesTrashed: 2,
        videosTrashed: 1,
        photosTrashed: 1,
        filesFailed: 0,
        filesNotAttempted: 0,
        failedFingerprint: null,
        cancelled: false,
        analysesDeleted: 2,
        observationsDeleted: 2,
        peopleDeleted: 0,
        artifactPathsDeleted: 2,
        snapshotsRewritten: 1,
        roots: ['/fixtures/root'],
      }),
    })),
  );
};

describe('PeopleView', () => {
  beforeEach(() => window.localStorage.clear());

  it('shows the opt-in state when face grouping is off', async () => {
    const onOpenSettings = vi.fn();
    stubPeople({ facesEnabled: false });

    renderThemed(
      <PeopleView
        active
        folder={FOLDER}
        addLine={vi.fn()}
        onOpenSettings={onOpenSettings}
        onSearchInLibrary={vi.fn()}
        intervalMs={0}
      />,
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
      <PeopleView active folder={FOLDER} addLine={addLine} onOpenSettings={vi.fn()} onSearchInLibrary={vi.fn()} intervalMs={0} />,
    );

    fireEvent.click(await screen.findByTestId('people-install-models'));

    await waitFor(() => expect(addLine).toHaveBeenCalledWith('Face grouping models are installed', 'success'));
    expect(installBody).toEqual({ force: false });
  });

  it('surfaces an install-models failure via the mutation error alert, not only the terminal', async () => {
    const addLine = vi.fn();
    stubPeople({ facesEnabled: true, artifactsReady: false });
    server.use(
      http.post('/api/models/faces/install', () => HttpResponse.json(
        { ok: false, error: { code: 'internal', message: 'Model download failed' } },
        { status: 500 },
      )),
    );

    renderThemed(
      <PeopleView active folder={FOLDER} addLine={addLine} onOpenSettings={vi.fn()} onSearchInLibrary={vi.fn()} intervalMs={0} />,
    );

    fireEvent.click(await screen.findByTestId('people-install-models'));

    const alert = await screen.findByTestId('people-mutation-error');
    expect(alert.textContent).toContain('Model download failed');
  });

  it('shows the empty state pointing at Analysis, with no index button in the browse view', async () => {
    stubPeople({ facesEnabled: true, artifactsReady: true, observations: 0, people: [] });

    renderThemed(
      <PeopleView active folder={FOLDER} addLine={vi.fn()} onOpenSettings={vi.fn()} onSearchInLibrary={vi.fn()} intervalMs={0} />,
    );

    expect(await screen.findByTestId('people-empty-state')).toBeDefined();
    expect(screen.getByText('Open a folder in Analysis > Videos to index faces.')).toBeDefined();
    expect(screen.queryByTestId('people-index')).toBeNull();
  });

  it('renders populated people with exemplar crops and file counts', async () => {
    stubPeople({
      facesEnabled: true,
      artifactsReady: true,
      observations: 4,
      people: [
        person({
          personId: 'p1',
          displayName: 'Alex',
          observationCount: 3,
          videoCount: 3,
          fileCounts: { video: 2, photo: 0 },
          exemplarCropPath: '/home/.ai-video-cataloger/faces/p1/exemplar-001.jpg',
        }),
        person({ personId: 'p2', observationCount: 10 }),
      ],
    });

    renderThemed(
      <PeopleView active folder={FOLDER} addLine={vi.fn()} onOpenSettings={vi.fn()} onSearchInLibrary={vi.fn()} intervalMs={0} />,
    );

    expect(await screen.findByTestId('people-grid')).toBeDefined();
    expect(screen.getByText('Alex')).toBeDefined();
    expect(screen.getByText('Person 2')).toBeDefined();
    expect(screen.getByText('2 videos')).toBeDefined();
    const crop = screen.getByAltText('Alex');
    expect(crop.getAttribute('src')).toContain('media://local/');
  });

  it('shows a fallback avatar instead of a bare gray box when a person has no exemplar crop', async () => {
    stubPeople({
      facesEnabled: true,
      artifactsReady: true,
      observations: 2,
      people: [
        person({ personId: 'p1', displayName: 'Alex', observationCount: 12, exemplarCropPath: null }),
        person({ personId: 'p2', observationCount: 10, exemplarCropPath: null }),
      ],
    });

    renderThemed(
      <PeopleView active folder={FOLDER} addLine={vi.fn()} onOpenSettings={vi.fn()} onSearchInLibrary={vi.fn()} intervalMs={0} />,
    );

    await screen.findByTestId('people-grid');
    const fallbacks = screen.getAllByTestId('people-card-fallback');
    expect(fallbacks).toHaveLength(2);
    expect(fallbacks[0]?.textContent).toBe('A');
    expect(fallbacks[1]?.textContent).toBe('2');
    expect(getComputedStyle(screen.getByText('A')).color).toBe('rgb(255, 255, 255)');
    expect(screen.queryByAltText('Alex')).toBeNull();
  });

  it('opens the person in the Library from the card menu', async () => {
    stubPeople({
      facesEnabled: true,
      artifactsReady: true,
      observations: 1,
      people: [person({ personId: 'p1', displayName: 'Alex', observationCount: 1 })],
    });
    const onSearchInLibrary = vi.fn();

    renderThemed(
      <PeopleView
        active
        folder={FOLDER}
        addLine={vi.fn()}
        onOpenSettings={vi.fn()}
        onSearchInLibrary={onSearchInLibrary}
        intervalMs={0}
      />,
    );

    await screen.findByTestId('people-grid');
    fireEvent.click(screen.getByLabelText('More actions for Alex'));
    const menuItem = await screen.findByTestId('people-search-library');
    fireEvent.click(menuItem);
    expect(onSearchInLibrary).toHaveBeenCalledWith('p1', 'Alex');
  });

  it('adds person-card hide and trash shortcuts below the library search action', async () => {
    stubPeople({
      facesEnabled: true,
      artifactsReady: true,
      observations: 1,
      people: [person({ personId: 'p1', displayName: 'Alex', observationCount: 1 })],
    });

    renderThemed(
      <PeopleView active folder={FOLDER} addLine={vi.fn()} onOpenSettings={vi.fn()} onSearchInLibrary={vi.fn()} intervalMs={0} />,
    );

    await screen.findByTestId('people-grid');
    fireEvent.click(screen.getByLabelText('More actions for Alex'));

    expect(await screen.findByTestId('people-search-library')).toBeDefined();
    expect(screen.getByTestId('people-hide-files').textContent).toBe('Hide this person’s files');
    expect(screen.getByTestId('people-trash-files').textContent).toBe('Move this person’s files to Trash');
  });

  it('opens the hide dialog with shared-file copy and skip off by default', async () => {
    stubPeople({
      facesEnabled: true,
      artifactsReady: true,
      observations: 2,
      people: [person({ personId: 'p1', displayName: 'Alex', observationCount: 2 })],
    });
    stubPersonLibraryActions();

    renderThemed(
      <PeopleView active folder={FOLDER} addLine={vi.fn()} onOpenSettings={vi.fn()} onSearchInLibrary={vi.fn()} intervalMs={0} />,
    );

    await screen.findByTestId('people-grid');
    fireEvent.click(screen.getByLabelText('More actions for Alex'));
    fireEvent.click(await screen.findByTestId('people-hide-files'));

    expect((await screen.findByTestId('people-library-action-summary')).textContent).toContain('2 files, including 1 that also contains other recognized people');
    expect(screen.getByTestId('people-library-skip-shared').querySelector('input')?.checked).toBe(false);
    expect(personLibraryRequests[0]).toEqual({
      scope: { kind: 'person', personId: 'p1', skipSharedWithOtherPeople: false },
    });
  });

  it('opens the trash dialog with skip on by default and re-previews when toggled', async () => {
    stubPeople({
      facesEnabled: true,
      artifactsReady: true,
      observations: 2,
      people: [person({ personId: 'p1', displayName: 'Alex', observationCount: 2 })],
    });
    stubPersonLibraryActions();

    renderThemed(
      <PeopleView active folder={FOLDER} addLine={vi.fn()} onOpenSettings={vi.fn()} onSearchInLibrary={vi.fn()} intervalMs={0} />,
    );

    await screen.findByTestId('people-grid');
    fireEvent.click(screen.getByLabelText('More actions for Alex'));
    fireEvent.click(await screen.findByTestId('people-trash-files'));

    expect((await screen.findByTestId('library-trash-person-summary')).textContent).toContain('2 files, including 1 that also contains other recognized people');
    expect(screen.getByTestId('people-library-skip-shared').querySelector('input')?.checked).toBe(true);
    fireEvent.click(screen.getByTestId('people-library-skip-shared'));

    await waitFor(() => expect(personLibraryRequests).toContainEqual({
      scope: { kind: 'person', personId: 'p1', skipSharedWithOtherPeople: false },
    }));
  });

  it('keeps the destructive delete action off the card face, behind an overflow menu', async () => {
    stubPeople({
      facesEnabled: true,
      artifactsReady: true,
      observations: 1,
      people: [person({ personId: 'p1', displayName: 'Alex', observationCount: 1 })],
    });

    renderThemed(
      <PeopleView active folder={FOLDER} addLine={vi.fn()} onOpenSettings={vi.fn()} onSearchInLibrary={vi.fn()} intervalMs={0} />,
    );

    await screen.findByTestId('people-grid');
    expect(screen.queryByTestId('people-forget')).toBeNull();
    fireEvent.click(screen.getByLabelText('More actions for Alex'));
    expect(await screen.findByTestId('people-forget')).toBeDefined();
    expect(screen.getByTestId('people-rename')).toBeDefined();
  });

  it('disables face mutations and shows a read-only notice when the catalog is locked', async () => {
    stubPeople({
      facesEnabled: true,
      artifactsReady: true,
      observations: 3,
      people: [
        person({ personId: 'p1', displayName: 'Alex', observationCount: 2 }),
        person({ personId: 'p2', observationCount: 10 }),
      ],
    });

    renderThemed(
      <PeopleView
        active
        folder={FOLDER}
        addLine={vi.fn()}
        onOpenSettings={vi.fn()}
        onSearchInLibrary={vi.fn()}
        lockReason="Catalog locked by gui PID 4321"
        intervalMs={0}
      />,
    );

    expect(await screen.findByTestId('people-read-only')).toBeDefined();
    await waitFor(() => expect(screen.getByTestId('people-purge').getAttribute('disabled')).not.toBeNull());
    fireEvent.click(screen.getByLabelText('More actions for Alex'));
    expect((await screen.findByTestId('people-rename')).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByTestId('people-forget').getAttribute('aria-disabled')).toBe('true');
  });

  it('wires rename, merge, forget, and purge actions', async () => {
    const bodies: unknown[] = [];
    stubPeople({
      facesEnabled: true,
      artifactsReady: true,
      observations: 3,
      people: [
        person({ personId: 'p1', displayName: 'Alex', observationCount: 2 }),
        person({ personId: 'p2', observationCount: 10 }),
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
      <PeopleView active folder={FOLDER} addLine={vi.fn()} onOpenSettings={vi.fn()} onSearchInLibrary={vi.fn()} intervalMs={0} />,
    );
    const user = userEvent.setup();

    await screen.findByTestId('people-grid');
    fireEvent.click(screen.getByLabelText('More actions for Alex'));
    fireEvent.click(await screen.findByTestId('people-rename'));
    fireEvent.change(await screen.findByTestId('people-rename-input'), { target: { value: 'Taylor' } });
    fireEvent.click(screen.getByTestId('people-rename-save'));

    await waitFor(() => expect(bodies).toContainEqual({ personId: 'p1', displayName: 'Taylor' }));
    await user.click(screen.getByLabelText('Select Alex'));
    await user.click(screen.getByLabelText('Select Person 2'));
    await waitFor(() => expect(screen.getByTestId('people-merge-selected').getAttribute('disabled')).toBeNull());
    fireEvent.click(screen.getByTestId('people-merge-selected'));
    fireEvent.click(await screen.findByTestId('people-merge-confirm'));
    await waitFor(() => expect(bodies).toContainEqual({ fromPersonId: 'p2', toPersonId: 'p1' }));

    fireEvent.click(screen.getByLabelText('More actions for Alex'));
    fireEvent.click(await screen.findByTestId('people-forget'));
    fireEvent.click(await screen.findByTestId('people-forget-confirm'));
    await waitFor(() => expect(bodies).toContainEqual({ personId: 'p1', force: true }));

    fireEvent.click(screen.getByTestId('people-purge'));
    fireEvent.click(await screen.findByTestId('people-purge-confirm'));

    await waitFor(() => expect(bodies).toHaveLength(4));
    expect(bodies).toContainEqual({ personId: 'p1', displayName: 'Taylor' });
    expect(bodies).toContainEqual({ fromPersonId: 'p2', toPersonId: 'p1' });
    expect(bodies).toContainEqual({ personId: 'p1', force: true });
    expect(bodies).toContainEqual({ force: true });
  }, scaledTimeout(30_000));

  it('requires a recluster dry-run report before enabling the destructive run', async () => {
    const bodies: unknown[] = [];
    stubPeople({
      facesEnabled: true,
      artifactsReady: true,
      observations: 4,
      people: [person({ personId: 'p1', displayName: 'Sample Name', observationCount: 4 })],
    });
    server.use(
      http.post('/api/faces/recluster', async ({ request }) => {
        const body = await request.json();
        bodies.push(body);
        return HttpResponse.json({
          ok: true,
          data: { jobId: body !== null && typeof body === 'object' && 'dryRun' in body && body.dryRun === true ? 'dry-recluster' : 'real-recluster' },
        });
      }),
      http.get('/api/jobs/status', ({ request }) => {
        const jobId = new URL(request.url).searchParams.get('jobId') ?? '';
        const result = {
          dryRun: jobId === 'dry-recluster',
          observations: 4,
          personsBefore: 1,
          personsAfter: 2,
          observationsReassigned: 4,
          observationsAssigned: 4,
          observationsUnassigned: 0,
          namesCarried: 0,
          namesDropped: ['Sample Name'],
          personsWithoutExemplar: 1,
          largestClusters: [{ personId: 'person-a', observations: 3 }],
          elapsedMs: 5,
        };
        return HttpResponse.json({ ok: true, data: terminalJob(jobId, 'faces_recluster', result) });
      }),
    );

    renderThemed(
      <PeopleView active folder={FOLDER} addLine={vi.fn()} onOpenSettings={vi.fn()} onSearchInLibrary={vi.fn()} intervalMs={0} />,
    );

    await screen.findByTestId('people-grid');
    fireEvent.click(screen.getByTestId('people-recluster'));
    expect(await screen.findByText('Check without changes')).toBeDefined();
    expect((await screen.findByTestId('people-recluster-confirm')).getAttribute('disabled')).not.toBeNull();

    fireEvent.click(screen.getByTestId('people-recluster-dry-run'));

    expect(await screen.findByTestId('people-recluster-report')).toBeDefined();
    await waitFor(() => expect(screen.getByTestId('people-recluster-confirm').getAttribute('disabled')).toBeNull());
    expect(screen.getByTestId('people-recluster-confirm').textContent).toBe('Rebuild and drop 1 name');
    expect(screen.getByTestId('people-recluster-largest').textContent).toContain('person-a: 3');
    fireEvent.click(screen.getByTestId('people-recluster-confirm'));

    await waitFor(() => expect(bodies).toContainEqual({ dryRun: false }));
    expect(bodies).toContainEqual({ dryRun: true });
  }, scaledTimeout(30_000));

  it('uses the short rebuild confirmation label when the dry run drops no names', async () => {
    stubPeople({
      facesEnabled: true,
      artifactsReady: true,
      observations: 4,
      people: [person({ personId: 'p1', observationCount: 4 })],
    });
    server.use(
      http.post('/api/faces/recluster', () => HttpResponse.json({ ok: true, data: { jobId: 'dry-recluster' } })),
      http.get('/api/jobs/status', () => HttpResponse.json({
        ok: true,
        data: terminalJob('dry-recluster', 'faces_recluster', {
          dryRun: true,
          observations: 4,
          personsBefore: 1,
          personsAfter: 1,
          observationsReassigned: 0,
          observationsAssigned: 4,
          observationsUnassigned: 0,
          namesCarried: 0,
          namesDropped: [],
          personsWithoutExemplar: 0,
          largestClusters: [],
          elapsedMs: 5,
        }),
      })),
    );

    renderThemed(
      <PeopleView active folder={FOLDER} addLine={vi.fn()} onOpenSettings={vi.fn()} onSearchInLibrary={vi.fn()} intervalMs={0} />,
    );

    await screen.findByTestId('people-grid');
    fireEvent.click(screen.getByTestId('people-recluster'));
    fireEvent.click(screen.getByTestId('people-recluster-dry-run'));

    expect(await screen.findByTestId('people-recluster-report')).toBeDefined();
    await waitFor(() => expect(screen.getByTestId('people-recluster-confirm').textContent).toBe('Rebuild'));
  }, scaledTimeout(30_000));

  it('surfaces a purge mutation failure via a visible alert instead of only the terminal', async () => {
    stubPeople({
      facesEnabled: true,
      artifactsReady: true,
      observations: 1,
      people: [person({ personId: 'p1', displayName: 'Alex', observationCount: 1 })],
    });
    server.use(
      http.post('/api/faces/purge', () => HttpResponse.json(
        { ok: false, error: { code: 'conflict', message: 'Faces write lock held by a drive run' } },
        { status: 409 },
      )),
    );

    renderThemed(
      <PeopleView active folder={FOLDER} addLine={vi.fn()} onOpenSettings={vi.fn()} onSearchInLibrary={vi.fn()} intervalMs={0} />,
    );

    await screen.findByTestId('people-grid');
    fireEvent.click(screen.getByTestId('people-purge'));
    fireEvent.click(await screen.findByTestId('people-purge-confirm'));

    const alert = await screen.findByTestId('people-mutation-error');
    expect(alert.textContent).toContain('Faces write lock held by a drive run');
    expect(screen.getByTestId('people-grid')).toBeDefined();
  });
});

describe('PeopleView media chips', () => {
  beforeEach(() => window.localStorage.clear());

  const mixedPeople = [
    person({ personId: 'p-both', displayName: 'Both', observationCount: 5, videoCount: 2, photoCount: 3, fileCounts: { video: 1, photo: 2 } }),
    person({ personId: 'p-video', displayName: 'VideoOnly', observationCount: 4, videoCount: 4, photoCount: 0, fileCounts: { video: 2, photo: 0 } }),
    person({ personId: 'p-photo', displayName: 'PhotoOnly', observationCount: 6, videoCount: 0, photoCount: 6, fileCounts: { video: 0, photo: 3 } }),
  ];

  const renderPeople = (renderPersonMedia?: PeopleViewProps['renderPersonMedia']) => {
    stubPeople({ facesEnabled: true, artifactsReady: true, observations: 15, people: mixedPeople });
    renderThemed(
      <PeopleView
        active
        folder={FOLDER}
        addLine={vi.fn()}
        onOpenSettings={vi.fn()}
        onSearchInLibrary={vi.fn()}
        intervalMs={0}
        {...(renderPersonMedia === undefined ? {} : { renderPersonMedia })}
      />,
    );
  };

  it('counts the people each chip shows, not their observations', async () => {
    renderPeople();

    expect((await screen.findByTestId('people-media-all')).textContent).toBe('All (3)');
    expect(screen.getByTestId('people-media-video').textContent).toBe('Videos (2)');
    expect(screen.getByTestId('people-media-photo').textContent).toBe('Photos (2)');
  });

  it('narrows the person list to the chosen medium and counts that medium alone', async () => {
    renderPeople();

    await screen.findByTestId('people-grid');
    expect(screen.getAllByTestId('people-card')).toHaveLength(3);

    fireEvent.click(screen.getByTestId('people-media-photo'));

    await waitFor(() => expect(screen.getAllByTestId('people-card')).toHaveLength(2));
    const shown = screen.getAllByTestId('people-card').map((card) => card.getAttribute('data-person-id'));
    expect(shown).toEqual(['p-photo', 'p-both']);
    expect(screen.getByTestId('people-grid').textContent).toContain('2 photos');

    fireEvent.click(screen.getByTestId('people-media-video'));

    await waitFor(() => expect(screen.getAllByTestId('people-card')).toHaveLength(2));
    expect(screen.getAllByTestId('people-card').map((card) => card.getAttribute('data-person-id')))
      .toEqual(['p-video', 'p-both']);
    expect(screen.getByTestId('people-grid').textContent).toContain('2 videos');
  });

  it('opens the person media surface for the card, carrying the selected medium', async () => {
    const renderPersonMedia = vi.fn((input: { personId: string; label: string; media: string }) => (
      <div data-testid="people-person-media" data-person-id={input.personId} data-media={input.media}>{input.label}</div>
    ));
    renderPeople(renderPersonMedia);

    await screen.findByTestId('people-grid');
    fireEvent.click(screen.getByTestId('people-media-photo'));
    await waitFor(() => expect(screen.getAllByTestId('people-card')).toHaveLength(2));

    const photoOnlyCard = screen.getAllByTestId('people-card-body')[0];
    if (photoOnlyCard === undefined) throw new Error('expected a person card');
    fireEvent.click(photoOnlyCard);

    const panel = await screen.findByTestId('people-person-media');
    expect(panel.getAttribute('data-person-id')).toBe('p-photo');
    expect(panel.getAttribute('data-media')).toBe('photo');
    expect(panel.textContent).toBe('PhotoOnly');
  });

  it('sorts people by file frequency by default while keeping the original person number', async () => {
    stubPeople({
      facesEnabled: true,
      artifactsReady: true,
      observations: 12,
      people: [
        person({ personId: 'p-first', observationCount: 10, videoCount: 10, photoCount: 0, fileCounts: { video: 1, photo: 0 } }),
        person({ personId: 'p-second', observationCount: 30, videoCount: 30, photoCount: 0, fileCounts: { video: 3, photo: 0 } }),
        person({ personId: 'p-third', observationCount: 60, videoCount: 60, photoCount: 0, fileCounts: { video: 3, photo: 0 } }),
      ],
    });

    renderThemed(
      <PeopleView active folder={FOLDER} addLine={vi.fn()} onOpenSettings={vi.fn()} onSearchInLibrary={vi.fn()} intervalMs={0} />,
    );

    await screen.findByTestId('people-grid');
    expect(screen.getAllByTestId('people-card').map((card) => card.getAttribute('data-person-id')))
      .toEqual(['p-third', 'p-second', 'p-first']);
    expect(screen.getByTestId('people-grid').textContent).toContain('Person 3');
    expect(screen.getByTestId('people-sort-frequency').getAttribute('aria-pressed')).toBe('true');
  });

  it('can show the original order and persist that people sort preference', async () => {
    renderPeople();

    await screen.findByTestId('people-grid');
    fireEvent.click(screen.getByTestId('people-sort-order'));

    await waitFor(() => expect(screen.getAllByTestId('people-card').map((card) => card.getAttribute('data-person-id')))
      .toEqual(['p-both', 'p-video', 'p-photo']));
    expect(window.localStorage.getItem('avc.people.sort')).toBe('order');
  });

  it('folds rare unnamed people below the default threshold into one tile', async () => {
    stubPeople({
      facesEnabled: true,
      artifactsReady: true,
      observations: 19,
      people: [
        person({ personId: 'p-main', observationCount: 10, videoCount: 10, photoCount: 0, fileCounts: { video: 2, photo: 0 } }),
        person({ personId: 'p-rare-one', observationCount: 1 }),
        person({ personId: 'p-rare-two', observationCount: 8 }),
      ],
    });

    renderThemed(
      <PeopleView active folder={FOLDER} addLine={vi.fn()} onOpenSettings={vi.fn()} onSearchInLibrary={vi.fn()} intervalMs={0} />,
    );

    await screen.findByTestId('people-grid');
    expect(screen.getByTestId('people-threshold-control').textContent).toContain('Show people with at least 10 observations');
    expect(screen.getAllByTestId('people-card').map((card) => card.getAttribute('data-person-id'))).toEqual(['p-main']);
    expect(screen.getByTestId('people-other-tile').textContent).toContain('Other — 2 people · 9 observations');
    expect(screen.queryByText('Person 2')).toBeNull();
    expect(screen.queryByText('Person 3')).toBeNull();
  });

  it('persists the rare-people threshold value', async () => {
    stubPeople({
      facesEnabled: true,
      artifactsReady: true,
      observations: 8,
      people: [
        person({ personId: 'p-one', observationCount: 1 }),
        person({ personId: 'p-two', observationCount: 2 }),
        person({ personId: 'p-three', observationCount: 5 }),
      ],
    });

    renderThemed(
      <PeopleView active folder={FOLDER} addLine={vi.fn()} onOpenSettings={vi.fn()} onSearchInLibrary={vi.fn()} intervalMs={0} />,
    );

    await screen.findByTestId('people-grid');
    fireEvent.change(screen.getByTestId('people-threshold-slider').querySelector('input') ?? screen.getByTestId('people-threshold-slider'), {
      target: { value: 1 },
    });

    await waitFor(() => expect(window.localStorage.getItem('avc.people.minObservations')).toBe('2'));
    expect(screen.getAllByTestId('people-card').map((card) => card.getAttribute('data-person-id'))).toEqual(['p-three', 'p-two']);
    expect(screen.getByTestId('people-other-tile').textContent).toContain('Other — 1 person · 1 observation');
  });

  it('keeps named people visible even when they are below the threshold', async () => {
    stubPeople({
      facesEnabled: true,
      artifactsReady: true,
      observations: 11,
      people: [
        person({ personId: 'p-named', displayName: 'Alex', observationCount: 1 }),
        person({ personId: 'p-rare', observationCount: 2 }),
        person({ personId: 'p-main', observationCount: 10 }),
      ],
    });

    renderThemed(
      <PeopleView active folder={FOLDER} addLine={vi.fn()} onOpenSettings={vi.fn()} onSearchInLibrary={vi.fn()} intervalMs={0} />,
    );

    await screen.findByTestId('people-grid');
    expect(screen.getByText('Alex')).toBeDefined();
    expect(screen.getAllByTestId('people-card').map((card) => card.getAttribute('data-person-id'))).toEqual(['p-main', 'p-named']);
    expect(screen.getByTestId('people-other-tile').textContent).toContain('Other — 1 person · 2 observations');
  });

  it('expands folded people in the same grid and returns to the main people scope', async () => {
    stubPeople({
      facesEnabled: true,
      artifactsReady: true,
      observations: 14,
      people: [
        person({ personId: 'p-main', observationCount: 10 }),
        person({ personId: 'p-rare-one', observationCount: 1 }),
        person({ personId: 'p-rare-two', observationCount: 3 }),
      ],
    });

    renderThemed(
      <PeopleView active folder={FOLDER} addLine={vi.fn()} onOpenSettings={vi.fn()} onSearchInLibrary={vi.fn()} intervalMs={0} />,
    );

    await screen.findByTestId('people-grid');
    fireEvent.click(screen.getByTestId('people-other-tile'));

    await waitFor(() => expect(screen.getByTestId('people-scope').textContent).toContain('Other people'));
    expect(screen.getAllByTestId('people-card').map((card) => card.getAttribute('data-person-id'))).toEqual(['p-rare-two', 'p-rare-one']);
    expect(screen.getByText('Person 2')).toBeDefined();
    expect(screen.getByText('Person 3')).toBeDefined();
    expect(screen.queryByTestId('people-other-tile')).toBeNull();

    fireEvent.click(screen.getByTestId('people-back-main'));

    await waitFor(() => expect(screen.queryByTestId('people-back-main')).toBeNull());
    expect(screen.getAllByTestId('people-card').map((card) => card.getAttribute('data-person-id'))).toEqual(['p-main']);
    expect(screen.getByTestId('people-other-tile')).toBeDefined();
  });

  it('keeps sorting interactions while the folded tile stays at the end', async () => {
    stubPeople({
      facesEnabled: true,
      artifactsReady: true,
      observations: 31,
      people: [
        person({ personId: 'p-first', observationCount: 12, videoCount: 12, photoCount: 0, fileCounts: { video: 1, photo: 0 } }),
        person({ personId: 'p-second', observationCount: 11, videoCount: 11, photoCount: 0, fileCounts: { video: 3, photo: 0 } }),
        person({ personId: 'p-rare', observationCount: 8, videoCount: 8, photoCount: 0, fileCounts: { video: 2, photo: 0 } }),
      ],
    });

    renderThemed(
      <PeopleView active folder={FOLDER} addLine={vi.fn()} onOpenSettings={vi.fn()} onSearchInLibrary={vi.fn()} intervalMs={0} />,
    );

    await screen.findByTestId('people-grid');
    expect(screen.getAllByTestId('people-card').map((card) => card.getAttribute('data-person-id'))).toEqual(['p-second', 'p-first']);
    expect(screen.getByTestId('people-grid').lastElementChild?.getAttribute('data-testid')).toBe('people-other-tile');

    fireEvent.click(screen.getByTestId('people-sort-order'));

    await waitFor(() => expect(screen.getAllByTestId('people-card').map((card) => card.getAttribute('data-person-id'))).toEqual(['p-first', 'p-second']));
    expect(screen.getByTestId('people-grid').lastElementChild?.getAttribute('data-testid')).toBe('people-other-tile');
  });
});
