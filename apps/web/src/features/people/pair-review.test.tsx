import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { z } from 'zod';

import { facesPairsDecideInputSchema, type facesPairsOutputSchema } from '@core/contract/index.js';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { PeopleView } from './PeopleView.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

type PairsOutput = z.output<typeof facesPairsOutputSchema>;
type Candidate = PairsOutput['candidates'][number];
type PairPerson = Candidate['a'];

const FOLDER = '/videos';
const centroid = Array.from({ length: 128 }, () => 0);

const configPayload = (facesEnabled: boolean) => {
  const values = {
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
    faces_pair_scope: 'standard',
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
  };
  return {
    config: Object.fromEntries(Object.keys(values).map((key) => [key, null])),
    defaults: values,
    effective: values,
    sources: Object.fromEntries(Object.keys(values).map((key) => [key, 'default'])),
  };
};

const pairPerson = (overrides: Partial<PairPerson> & { personId: string }): PairPerson => ({
  personId: overrides.personId,
  displayName: overrides.displayName ?? null,
  fallbackIndex: overrides.fallbackIndex ?? 0,
  observationCount: overrides.observationCount ?? 4,
  fileCounts: overrides.fileCounts ?? { video: 0, photo: 0 },
  cropPaths: overrides.cropPaths ?? [],
});

const candidate = (a: PairPerson, b: PairPerson, survivorIfSame?: string): Candidate => ({
  a,
  b,
  similarity: 0.5,
  centroidSimilarity: 0.5,
  bestObservationSimilarity: 0.5,
  expectedValue: 0.5,
  aboveClusterCut: false,
  survivorIfSame: survivorIfSame ?? a.personId,
});

const crops = (person: string, count: number): string[] =>
  Array.from({ length: count }, (_value, index) => `/crops/${person}-${String(index)}.jpg`);

interface PairQueue {
  candidates: Candidate[];
  pending: number;
  truncated: boolean;
  decisions: Array<z.output<typeof facesPairsDecideInputSchema>>;
  undoCalls: number;
}

const runningJob = {
  jobId: 'faces-recluster-1',
  kind: 'faces_recluster',
  status: 'running',
  progress: null,
  progressEvents: [],
  error: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const stubReview = (input: {
  facesEnabled?: boolean;
  candidates?: Candidate[];
  pending?: number;
  truncated?: boolean;
}): PairQueue => {
  const queue: PairQueue = {
    candidates: input.candidates ?? [],
    pending: input.pending ?? (input.candidates ?? []).length,
    truncated: input.truncated ?? false,
    decisions: [],
    undoCalls: 0,
  };
  const answered: Candidate[] = [];
  server.use(
    http.get('/api/jobs', () => HttpResponse.json({ ok: true, data: { jobs: [] } })),
    http.get('/api/config', () => HttpResponse.json({ ok: true, data: configPayload(input.facesEnabled ?? true) })),
    http.get('/api/models/faces', () => HttpResponse.json({ ok: true, data: { artifacts: [], ready: true } })),
    http.get('/api/faces/status', () => HttpResponse.json({
      ok: true,
      data: {
        enabled: true,
        artifactsReady: true,
        people: 4,
        observations: 40,
        assignedObservations: 40,
        unassignedObservations: 0,
        filesIndexed: 4,
        videosIndexed: 4,
        photosWithFaces: 0,
        photosProcessed: 0,
        staleVersionFiles: 0,
        stalePhotoFiles: 0,
      },
    })),
    http.get('/api/faces/people', () => HttpResponse.json({
      ok: true,
      data: {
        people: [{
          personId: 'grid-person',
          displayName: 'Grid person',
          kind: 'face',
          createdAt: '2026-01-01T00:00:00.000Z',
          centroid,
          exemplarCount: 1,
          fallbackIndex: 0,
          observationCount: 12,
          videoCount: 12,
          photoCount: 0,
          fileCounts: { video: 3, photo: 0 },
          exemplarCropPath: null,
          exemplarCropPaths: [],
        }],
      },
    })),
    http.get('/api/faces/pairs', () => HttpResponse.json({
      ok: true,
      data: {
        scope: 'standard',
        askLow: 0.44,
        clusterCut: 0.5,
        pending: queue.pending,
        truncated: queue.truncated,
        candidates: queue.candidates,
      },
    })),
    http.post('/api/faces/pairs/decide', async ({ request }) => {
      const decision = facesPairsDecideInputSchema.parse(await request.json());
      queue.decisions.push(decision);
      const index = queue.candidates.findIndex((entry) =>
        entry.a.personId === decision.personAId && entry.b.personId === decision.personBId);
      if (index >= 0) {
        const [removed] = queue.candidates.splice(index, 1);
        if (removed !== undefined) answered.push(removed);
        queue.pending -= 1;
      }
      return HttpResponse.json({
        ok: true,
        data: {
          decision: decision.decision,
          personAId: decision.personAId,
          personBId: decision.personBId,
          merge: null,
          survivingPersonId: decision.decision === 'same' ? decision.survivorPersonId ?? decision.personAId : null,
          pending: queue.pending,
        },
      });
    }),
    http.post('/api/faces/pairs/undo', () => {
      queue.undoCalls += 1;
      const last = answered[answered.length - 1];
      const lastDecision = queue.decisions[queue.decisions.length - 1];
      if (last === undefined || lastDecision === undefined) {
        return HttpResponse.json({
          ok: true,
          data: { undone: false, reason: 'none_to_undo', personAId: null, personBId: null, pending: queue.pending },
        });
      }
      if (lastDecision.decision === 'same') {
        return HttpResponse.json({
          ok: true,
          data: { undone: false, reason: 'merge_not_undoable', personAId: null, personBId: null, pending: queue.pending },
        });
      }
      answered.pop();
      queue.decisions.pop();
      queue.candidates.unshift(last);
      queue.pending += 1;
      return HttpResponse.json({
        ok: true,
        data: {
          undone: true,
          reason: null,
          personAId: last.a.personId,
          personBId: last.b.personId,
          pending: queue.pending,
        },
      });
    }),
  );
  return queue;
};

const renderPeople = (lockReason?: string) => {
  renderThemed(
    <PeopleView
      active
      folder={FOLDER}
      addLine={vi.fn()}
      onOpenSettings={vi.fn()}
      onOpenInCollection={vi.fn()}
      intervalMs={0}
      {...(lockReason === undefined ? {} : { lockReason })}
    />,
  );
};

const openReview = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByTestId('people-pair-review-open'));
  await screen.findByTestId('people-pair-review');
};

describe('Osoby pair review entry point', () => {
  beforeEach(() => window.localStorage.clear());

  it('exposes pending until the pair response explicitly supplies zero', async () => {
    stubReview({ candidates: [], pending: 0 });
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.get('/api/faces/pairs', async () => {
      await pending;
      return HttpResponse.json({ ok: true, data: { scope: 'standard', askLow: 0.44, clusterCut: 0.5, candidates: [], pending: 0, truncated: false } });
    }));
    renderPeople();
    const state = await screen.findByTestId('people-pairs-query');
    await waitFor(() => expect(state.getAttribute('data-fetch-status')).toBe('fetching'));
    expect(state.getAttribute('data-query-status')).toBe('pending');
    expect(state.hasAttribute('data-pending')).toBe(false);
    release();
    await waitFor(() => expect(state.getAttribute('data-query-status')).toBe('success'));
    expect(state.getAttribute('data-pending')).toBe('0');
  });

  it('exposes a pair endpoint failure without presenting an empty queue', async () => {
    stubReview({ candidates: [], pending: 0 });
    server.use(http.get('/api/faces/pairs', () => HttpResponse.json({ ok: false, error: { code: 'internal', message: 'pair query failed' } }, { status: 500 })));
    renderPeople();
    const state = await screen.findByTestId('people-pairs-query');
    await waitFor(() => expect(state.getAttribute('data-query-status')).toBe('error'));
    expect(state.hasAttribute('data-pending')).toBe(false);
  });

  it('stays out of the DOM when nothing is pending', async () => {
    stubReview({ candidates: [], pending: 0 });
    renderPeople();

    await screen.findByTestId('people-grid');
    expect(screen.queryByTestId('people-pair-review-open')).toBeNull();
  });

  it('stays out of the DOM when face grouping is off', async () => {
    stubReview({ facesEnabled: false, pending: 37 });
    renderPeople();

    await screen.findByTestId('people-disabled-state');
    expect(screen.queryByTestId('people-pair-review-open')).toBeNull();
  });

  it('shows the uncapped pending count even when the queue slice is truncated', async () => {
    stubReview({
      candidates: [candidate(pairPerson({ personId: 'a' }), pairPerson({ personId: 'b', fallbackIndex: 1 }))],
      pending: 437,
      truncated: true,
    });
    renderPeople();

    expect((await screen.findByTestId('people-pair-review-open')).textContent).toBe('To review: 437');
  });

  it('is rendered but disabled with the catalog lock reason as its title', async () => {
    stubReview({
      candidates: [candidate(pairPerson({ personId: 'a' }), pairPerson({ personId: 'b', fallbackIndex: 1 }))],
      pending: 37,
    });
    renderPeople('Catalog is read-only');

    const badge = await screen.findByTestId('people-pair-review-open');
    expect(badge.getAttribute('disabled')).not.toBeNull();
    expect(badge.getAttribute('title')).toBe('Catalog is read-only');
  });

  it('is enabled with no person ticked — it does not inherit the merge selection gate', async () => {
    stubReview({
      candidates: [candidate(pairPerson({ personId: 'a' }), pairPerson({ personId: 'b', fallbackIndex: 1 }))],
      pending: 37,
    });
    renderPeople();

    const badge = await screen.findByTestId('people-pair-review-open');
    expect(badge.getAttribute('disabled')).toBeNull();
    expect(screen.getByTestId('people-merge-selected').getAttribute('disabled')).not.toBeNull();
  });

  it('goes disabled with no tooltip while a faces job runs', async () => {
    const user = userEvent.setup();
    stubReview({
      candidates: [candidate(pairPerson({ personId: 'a' }), pairPerson({ personId: 'b', fallbackIndex: 1 }))],
      pending: 37,
    });
    server.use(
      http.post('/api/faces/recluster', () => HttpResponse.json({ ok: true, data: { jobId: 'faces-recluster-1' } })),
      http.get('/api/jobs/status', () => HttpResponse.json({ ok: true, data: runningJob })),
    );
    renderPeople();

    await user.click(await screen.findByTestId('people-recluster'));
    await user.click(await screen.findByTestId('people-recluster-dry-run'));

    await screen.findByTestId('people-active-job');
    const badge = screen.getByTestId('people-pair-review-open');
    expect(badge.getAttribute('disabled')).not.toBeNull();
    expect(badge.getAttribute('title')).toBeNull();
  });
});

describe('Osoby pair review card', () => {
  beforeEach(() => window.localStorage.clear());

  it('renders both people with names, counts and contact sheets, and advances on an answer', async () => {
    const user = userEvent.setup();
    stubReview({
      candidates: [
        candidate(
          pairPerson({ personId: 'a', displayName: 'Ada', observationCount: 9, fileCounts: { video: 2, photo: 1 }, cropPaths: crops('a', 6) }),
          pairPerson({ personId: 'b', fallbackIndex: 3, observationCount: 3, cropPaths: crops('b', 3) }),
        ),
        candidate(
          pairPerson({ personId: 'c', fallbackIndex: 4, cropPaths: crops('c', 2) }),
          pairPerson({ personId: 'd', fallbackIndex: 5, cropPaths: crops('d', 2) }),
        ),
      ],
    });
    renderPeople();
    await openReview(user);

    expect(screen.getByTestId('people-pair-review-question').textContent).toContain('Is this the same person?');
    const first = screen.getByTestId('people-pair-review-person-a');
    const second = screen.getByTestId('people-pair-review-person-b');
    expect(first.getAttribute('data-person-id')).toBe('a');
    expect(second.getAttribute('data-person-id')).toBe('b');
    expect(within(first).getByText('Ada')).toBeDefined();
    expect(within(first).getByText('2 videos · 1 photo')).toBeDefined();
    expect(within(second).getByText('Person 4')).toBeDefined();
    expect(within(first).getAllByTestId('people-pair-review-crop')).toHaveLength(6);
    expect(within(second).getAllByTestId('people-pair-review-crop')).toHaveLength(3);

    await user.click(screen.getByTestId('people-pair-review-different'));

    await waitFor(() =>
      expect(screen.getByTestId('people-pair-review-person-a').getAttribute('data-person-id')).toBe('c'));
  });

  it('counts answers up while the denominator holds still, then shows the empty state', async () => {
    const user = userEvent.setup();
    stubReview({
      candidates: [
        candidate(pairPerson({ personId: 'a' }), pairPerson({ personId: 'b', fallbackIndex: 1 })),
        candidate(pairPerson({ personId: 'c', fallbackIndex: 2 }), pairPerson({ personId: 'd', fallbackIndex: 3 })),
        candidate(pairPerson({ personId: 'e', fallbackIndex: 4 }), pairPerson({ personId: 'f', fallbackIndex: 5 })),
      ],
    });
    renderPeople();
    await openReview(user);

    expect(screen.getByTestId('people-pair-review-position').textContent).toBe('1 of 3');

    await user.click(screen.getByTestId('people-pair-review-different'));
    await waitFor(() => expect(screen.getByTestId('people-pair-review-position').textContent).toBe('2 of 3'));

    await user.click(screen.getByTestId('people-pair-review-different'));
    await waitFor(() => expect(screen.getByTestId('people-pair-review-position').textContent).toBe('3 of 3'));

    await user.click(screen.getByTestId('people-pair-review-different'));
    await screen.findByTestId('people-pair-review-empty');
    expect(screen.queryByTestId('people-pair-review-position')).toBeNull();
  });

  it('resets the session counter when the surface is reopened', async () => {
    const user = userEvent.setup();
    stubReview({
      candidates: [
        candidate(pairPerson({ personId: 'a' }), pairPerson({ personId: 'b', fallbackIndex: 1 })),
        candidate(pairPerson({ personId: 'c', fallbackIndex: 2 }), pairPerson({ personId: 'd', fallbackIndex: 3 })),
      ],
    });
    renderPeople();
    await openReview(user);

    await user.click(screen.getByTestId('people-pair-review-different'));
    await waitFor(() => expect(screen.getByTestId('people-pair-review-position').textContent).toBe('2 of 2'));

    await user.click(screen.getByTestId('people-back-main'));
    await screen.findByTestId('people-grid');
    await openReview(user);

    expect(screen.getByTestId('people-pair-review-position').textContent).toBe('1 of 1');
  });
});

describe('Osoby pair review keyboard, confirmation and undo', () => {
  beforeEach(() => window.localStorage.clear());

  it('answers with the 1, 2 and 3 keys', async () => {
    const user = userEvent.setup();
    const queue = stubReview({
      candidates: [
        candidate(pairPerson({ personId: 'a' }), pairPerson({ personId: 'b', fallbackIndex: 1 })),
        candidate(pairPerson({ personId: 'c', fallbackIndex: 2 }), pairPerson({ personId: 'd', fallbackIndex: 3 })),
        candidate(pairPerson({ personId: 'e', fallbackIndex: 4 }), pairPerson({ personId: 'f', fallbackIndex: 5 })),
      ],
    });
    renderPeople();
    await openReview(user);

    await user.keyboard('1');
    await user.click(await screen.findByTestId('people-pair-review-confirm-accept'));
    await waitFor(() => expect(queue.decisions).toHaveLength(1));
    await user.keyboard('2');
    await waitFor(() => expect(queue.decisions).toHaveLength(2));
    await user.keyboard('3');
    await waitFor(() => expect(queue.decisions).toHaveLength(3));

    expect(queue.decisions.map((entry) => entry.decision)).toEqual(['same', 'different', 'skip']);
  });

  it('confirms a named/unnamed "yes" and asks which name wins on a named/named pair', async () => {
    const user = userEvent.setup();
    const queue = stubReview({
      candidates: [
        candidate(
          pairPerson({ personId: 'a', displayName: 'Ada' }),
          pairPerson({ personId: 'b', fallbackIndex: 1 }),
        ),
        candidate(
          pairPerson({ personId: 'c', displayName: 'Cyryl' }),
          pairPerson({ personId: 'd', displayName: 'Dorota' }),
          'd',
        ),
      ],
    });
    renderPeople();
    await openReview(user);

    await user.keyboard('1');
    await user.click(await screen.findByTestId('people-pair-review-confirm-accept'));
    await waitFor(() => expect(queue.decisions).toHaveLength(1));
    expect(queue.decisions[0]?.survivorPersonId).toBe('a');
    await waitFor(() => expect(screen.queryByTestId('people-pair-review-confirm')).toBeNull());

    await waitFor(() =>
      expect(screen.getByTestId('people-pair-review-person-a').getAttribute('data-person-id')).toBe('c'));

    await user.keyboard('1');
    await screen.findByTestId('people-pair-review-confirm');
    expect(queue.decisions).toHaveLength(1);

    await user.keyboard('1');
    expect(queue.decisions).toHaveLength(1);

    expect(within(screen.getByTestId('people-pair-review-confirm')).getByRole('radio', { name: 'Dorota', checked: true })).toBeDefined();

    await user.click(screen.getByTestId('people-pair-review-confirm-accept'));
    await waitFor(() => expect(queue.decisions).toHaveLength(2));
    expect(queue.decisions[1]?.survivorPersonId).toBe('d');
  });

  it('sends the name the user picked instead of the preselected survivor', async () => {
    const user = userEvent.setup();
    const queue = stubReview({
      candidates: [
        candidate(
          pairPerson({ personId: 'c', displayName: 'Cyryl' }),
          pairPerson({ personId: 'd', displayName: 'Dorota' }),
          'd',
        ),
      ],
    });
    renderPeople();
    await openReview(user);

    await user.click(screen.getByTestId('people-pair-review-same'));
    const dialog = await screen.findByTestId('people-pair-review-confirm');
    await user.click(within(dialog).getByRole('radio', { name: 'Cyryl' }));
    await user.click(screen.getByTestId('people-pair-review-confirm-accept'));

    await waitFor(() => expect(queue.decisions).toHaveLength(1));
    expect(queue.decisions[0]?.survivorPersonId).toBe('c');
  });

  it('refuses to undo on a freshly opened surface', async () => {
    const user = userEvent.setup();
    const queue = stubReview({
      candidates: [candidate(pairPerson({ personId: 'a' }), pairPerson({ personId: 'b', fallbackIndex: 1 }))],
    });
    renderPeople();
    await openReview(user);

    expect(screen.getByTestId('people-pair-review-undo').getAttribute('disabled')).not.toBeNull();
    await user.keyboard('{Backspace}');
    expect(queue.undoCalls).toBe(0);
    expect(screen.getByTestId('people-pair-review-position').textContent).toBe('1 of 1');
  });

  it('brings the answered pair back on Backspace and rewinds the counter', async () => {
    const user = userEvent.setup();
    const queue = stubReview({
      candidates: [
        candidate(pairPerson({ personId: 'a' }), pairPerson({ personId: 'b', fallbackIndex: 1 })),
        candidate(pairPerson({ personId: 'c', fallbackIndex: 2 }), pairPerson({ personId: 'd', fallbackIndex: 3 })),
        candidate(pairPerson({ personId: 'e', fallbackIndex: 4 }), pairPerson({ personId: 'f', fallbackIndex: 5 })),
      ],
    });
    renderPeople();
    await openReview(user);

    await user.keyboard('2');
    await waitFor(() => expect(screen.getByTestId('people-pair-review-position').textContent).toBe('2 of 3'));

    await user.keyboard('{Backspace}');
    await waitFor(() => expect(screen.getByTestId('people-pair-review-position').textContent).toBe('1 of 3'));
    expect(screen.getByTestId('people-pair-review-person-a').getAttribute('data-person-id')).toBe('a');
    expect(queue.undoCalls).toBe(1);
    expect(screen.getByTestId('people-pair-review-open').textContent).toBe('To review: 3');
  });

  it('disables undo after a merge until the next reversible answer', async () => {
    const user = userEvent.setup();
    stubReview({
      candidates: [
        candidate(pairPerson({ personId: 'a' }), pairPerson({ personId: 'b', fallbackIndex: 1 })),
        candidate(pairPerson({ personId: 'c', fallbackIndex: 2 }), pairPerson({ personId: 'd', fallbackIndex: 3 })),
        candidate(pairPerson({ personId: 'e', fallbackIndex: 4 }), pairPerson({ personId: 'f', fallbackIndex: 5 })),
      ],
    });
    renderPeople();
    await openReview(user);

    await user.keyboard('1');
    await user.click(await screen.findByTestId('people-pair-review-confirm-accept'));
    await waitFor(() => expect(screen.getByTestId('people-pair-review-position').textContent).toBe('2 of 3'));

    await user.keyboard('{Backspace}');
    expect(screen.queryByTestId('people-pair-review-not-undoable')).toBeNull();
    expect(screen.getByTestId('people-pair-review-position').textContent).toBe('2 of 3');
    expect(screen.getByTestId('people-pair-review-undo').getAttribute('disabled')).not.toBeNull();

    await user.keyboard('3');
    await waitFor(() => expect(screen.getByTestId('people-pair-review-position').textContent).toBe('3 of 3'));
    expect(screen.getByTestId('people-pair-review-undo').getAttribute('disabled')).toBeNull();
  });
});
