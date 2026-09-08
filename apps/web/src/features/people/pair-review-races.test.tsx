import { useEffect } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { facesPairsDecideInputSchema } from '@core/contract/index.js';
import { actions } from '../../api.js';
import { en, pl } from '../../i18n/dictionary.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { PairReview } from './PairReview.js';
import { usePeoplePairs, type FacesPairCandidate, type PeoplePairsState } from './use-people-pairs.js';

const pair = (a: string, b: string, named = true): FacesPairCandidate => ({
  a: { personId: a, displayName: named ? a : null, fallbackIndex: 0, observationCount: 2, fileCounts: { video: 2, photo: 0 }, cropPaths: [] },
  b: { personId: b, displayName: named ? b : null, fallbackIndex: 1, observationCount: 2, fileCounts: { video: 2, photo: 0 }, cropPaths: [] },
  similarity: 0.5, centroidSimilarity: 0.5, bestObservationSimilarity: 0.5, expectedValue: 1, aboveClusterCut: false, survivorIfSame: b,
});
const payload = (candidates: FacesPairCandidate[]) => ({ scope: 'standard', askLow: 0.44, clusterCut: 0.56, pending: candidates.length, truncated: false, candidates });
const deferred = () => {
  let release = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
};
const setup = (initial: FacesPairCandidate[]) => {
  let candidates = initial;
  const decisions: Array<ReturnType<typeof facesPairsDecideInputSchema.parse>> = [];
  let state: PeoplePairsState | undefined;
  server.use(
    http.get('/api/config', () => HttpResponse.json({ ok: false, error: { code: 'internal', message: 'Config unavailable' } }, { status: 500 })),
    http.get('/api/faces/pairs', () => HttpResponse.json({ ok: true, data: payload(candidates) })),
    http.post('/api/faces/pairs/decide', async ({ request }) => {
      const input = facesPairsDecideInputSchema.parse(await request.json());
      decisions.push(input);
      candidates = candidates.filter((entry) => entry.a.personId !== input.personAId || entry.b.personId !== input.personBId);
      return HttpResponse.json({ ok: true, data: { ...input, merge: null, survivingPersonId: input.decision === 'same' ? input.survivorPersonId : null, pending: candidates.length } });
    }),
  );
  const Host = () => {
    const pairs = usePeoplePairs({ enabled: true });
    useEffect(() => { state = pairs; }, [pairs]);
    return <ThemeProvider theme={createAppTheme('light')}><PairReview state={pairs} disabled={false} lockReason={undefined} /></ThemeProvider>;
  };
  const rendered = renderWithProviders(<Host />);
  return { ...rendered, decisions, getState: () => {
    if (state === undefined) throw new Error('Review not rendered');
    return state;
  }, replace: (next: FacesPairCandidate[]) => { candidates = next; } };
};

describe('pair review audit regressions', () => {
  it('FPR-001 invalidates confirmation when its pair leaves the queue', async () => {
    const test = setup([pair('a', 'b')]);
    fireEvent.click(await screen.findByTestId('people-pair-review-same'));
    await screen.findByTestId('people-pair-review-confirm');
    test.replace([pair('b', 'c')]);
    await act(() => test.queryClient.invalidateQueries(actions.facesPairs()));
    await waitFor(() => expect(screen.queryByTestId('people-pair-review-confirm')).toBeNull());
    expect(test.decisions).toEqual([]);
  });

  it('FPR-001 submits the confirmed IDs even when the queue head changes', async () => {
    const ab = pair('a', 'b');
    const test = setup([ab, pair('b', 'c')]);
    fireEvent.click(await screen.findByTestId('people-pair-review-same'));
    await screen.findByTestId('people-pair-review-confirm');
    test.replace([pair('b', 'c'), ab]);
    await act(() => test.queryClient.invalidateQueries(actions.facesPairs()));
    await waitFor(() => expect(test.getState().current?.a.personId).toBe('b'));
    fireEvent.click(screen.getByTestId('people-pair-review-confirm-accept'));
    await waitFor(() => expect(test.decisions[0]).toMatchObject({ personAId: 'a', personBId: 'b' }));
  });

  it.each([false, true])('askSame confirms auto-named people before merging (keyboard %s)', async (keyboard) => {
    const test = setup([pair('a', 'b', false), pair('c', 'd')]);
    const button = await screen.findByTestId('people-pair-review-same');
    if (keyboard) fireEvent.keyDown(window, { key: '1' });
    else fireEvent.click(button);
    expect(test.decisions).toHaveLength(0);
    const dialog = await screen.findByTestId('people-pair-review-confirm');
    expect(dialog.textContent).toContain('This cannot be undone.');
    expect(screen.queryByRole('radiogroup')).toBeNull();
    fireEvent.click(screen.getByTestId('people-pair-review-confirm-accept'));
    await waitFor(() => expect(test.getState().answeredThisSession).toBe(1));
    expect(test.getState().canUndo).toBe(false);
    expect(en.people.pairReviewConfirmBody('a', 'b')).toContain('This cannot be undone.');
    expect(pl.people.pairReviewConfirmBody('a', 'b')).toContain('Tego nie można cofnąć.');
  });

  it('FPR-002 removes the answered pair and blocks answers until delayed refresh completes', async () => {
    const test = setup([pair('a', 'b'), pair('c', 'd')]);
    await screen.findByTestId('people-pair-review-same');
    const gate = deferred();
    server.use(http.get('/api/faces/pairs', async () => { await gate.promise; return HttpResponse.json({ ok: true, data: payload([pair('c', 'd')]) }); }));
    try {
      act(() => test.getState().decide('different'));
      await waitFor(() => expect(test.getState().answeredThisSession).toBe(1));
      expect(test.getState().isBusy).toBe(true);
      expect(test.getState().current?.a.personId).toBe('c');
      act(() => test.getState().decide('skip'));
      expect(test.decisions).toHaveLength(1);
    } finally { gate.release(); }
    await waitFor(() => expect(test.getState().isBusy).toBe(false));
  });

  it('FPR-008 restores the undone pair first and FPR-002 guards undo through refresh', async () => {
    const ab = pair('a', 'b');
    const cd = pair('c', 'd');
    const test = setup([ab, cd]);
    await screen.findByTestId('people-pair-review-same');
    act(() => test.getState().decide('different'));
    await waitFor(() => expect(test.getState().canUndo).toBe(true));
    const gate = deferred();
    let undoCalls = 0;
    server.use(
      http.post('/api/faces/pairs/undo', () => { undoCalls += 1; return HttpResponse.json({ ok: true, data: { undone: true, reason: null, personAId: 'a', personBId: 'b', pending: 2 } }); }),
      http.get('/api/faces/pairs', async () => { await gate.promise; return HttpResponse.json({ ok: true, data: payload([cd, ab]) }); }),
    );
    try {
      act(() => test.getState().undo());
      await waitFor(() => expect(test.getState().answeredThisSession).toBe(0));
      expect(test.getState().isBusy).toBe(true);
      act(() => test.getState().undo());
      expect(undoCalls).toBe(1);
    } finally { gate.release(); }
    await waitFor(() => expect(test.getState().isBusy).toBe(false));
    expect(test.getState().current).toEqual(ab);
    expect(test.getState().queueLength).toBe(2);
  });

  it('isLoading renders a skeleton and exposes query success and error separately', async () => {
    const gate = deferred();
    const test = setup([]);
    server.use(http.get('/api/faces/pairs', async () => { await gate.promise; return HttpResponse.json({ ok: true, data: payload([]) }); }));
    try {
      expect(test.getState().isLoading).toBe(true);
      expect(screen.queryByTestId('people-pair-review-empty')).toBeNull();
      expect(screen.getByTestId('people-pair-review-loading')).toBeDefined();
    } finally { gate.release(); }
    await waitFor(() => expect(test.getState().isSuccess).toBe(true));
    server.use(http.get('/api/faces/pairs', () => HttpResponse.json({ ok: false, error: { code: 'internal', message: 'Queue unavailable' } }, { status: 500 })));
    await act(() => test.queryClient.invalidateQueries(actions.facesPairs()));
    await waitFor(() => expect(test.getState().isError).toBe(true));
    expect(test.getState().queryError).toBe('Queue unavailable');
    expect(screen.queryByTestId('people-pair-review-empty')).toBeNull();
    expect(screen.getByTestId('people-pair-review-error').textContent).toContain('Queue unavailable');
  });
});
