import { type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createTestQueryClient } from '../../test/render.js';
import { server } from '../../test/server.js';
import { useProcessing } from './use-processing.js';

const driveBodySchema = z.object({ root: z.string(), skipDuplicates: z.literal(true) });

const driveJob = (jobId: string) => ({
  jobId,
  kind: 'process_drive',
  status: 'completed',
  progress: null,
  progressEvents: [
    { sequence: 1, progress: { step: 'run-started', data: { runId: 'r1', root: '/videos', foldersTotal: 2, filesTotal: 3 } } },
    { sequence: 2, progress: { step: 'folder-started', data: { path: '/videos/a', filesTotal: 2 } } },
    { sequence: 3, progress: { step: 'folder-done', data: { path: '/videos/a', filesDone: 1, filesSkipped: 1, filesFailed: 0 } } },
    { sequence: 4, progress: { step: 'folder-started', data: { path: '/videos/b', filesTotal: 1 } } },
    { sequence: 5, progress: { step: 'folder-done', data: { path: '/videos/b', filesDone: 1, filesSkipped: 0, filesFailed: 0 } } },
    {
      sequence: 6,
      progress: {
        step: 'run-summary',
        data: {
          runId: 'r1',
          root: '/videos',
          foldersTotal: 2,
          foldersDone: 2,
          filesTotal: 3,
          filesDone: 2,
          filesSkipped: 1,
          filesFailed: 0,
          elapsedMs: 1000,
          failures: [],
        },
      },
    },
  ],
  error: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('useProcessing drive', () => {
  it('runs the drive route on the folder root and renders folder + summary lines', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const roots: string[] = [];
    server.use(
      http.post('/api/process-drive', async ({ request }) => {
        const { root } = driveBodySchema.parse(await request.json());
        roots.push(root);
        return HttpResponse.json({ ok: true, data: { jobId: 'job:drive' } });
      }),
      http.get('/api/jobs/status', ({ request }) => {
        const jobId = new URL(request.url).searchParams.get('jobId') ?? '';
        return HttpResponse.json({ ok: true, data: driveJob(jobId) });
      }),
    );
    const lines: string[] = [];
    const addLine = vi.fn((content: string) => {
      lines.push(content);
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useProcessing({ videos: [], addLine, intervalMs: 0 }), { wrapper });

    act(() => {
      result.current.driveAnalyze('/videos');
    });

    await waitFor(() => expect(result.current.isBusy).toBe(false));

    expect(roots).toEqual(['/videos']);
    expect(lines.some((line) => line.includes('/videos/a'))).toBe(true);
    expect(lines.some((line) => line.includes('/videos/b'))).toBe(true);
    expect(lines.some((line) => line.includes('2 done, 1 skipped (0 duplicates), 0 failed'))).toBe(true);
    expect(lines.some((line) => line.startsWith('=== Drive run complete:'))).toBe(true);
    expect(invalidate).toHaveBeenCalled();
    expect(result.current.driveSummary).toEqual({
      open: true,
      counts: {
        foldersDone: 2,
        filesDone: 2,
        filesSkipped: 1,
        filesDuplicateSkipped: 0,
        filesFailed: 0,
        estimatedCostUsd: null,
        costedFiles: 0,
      },
    });
  });

  const perFileJob = (jobId: string) => ({
    jobId,
    kind: 'process_drive',
    status: 'completed',
    progress: null,
    progressEvents: [
      { sequence: 1, progress: { step: 'run-started', data: { runId: 'r1', root: '/videos', foldersTotal: 1, filesTotal: 2 } } },
      { sequence: 2, progress: { step: 'folder-started', data: { path: '/videos/a', filesTotal: 2 } } },
      {
        sequence: 3,
        progress: { step: 'extracting_frames', percentage: 20, current: 1, total: 2, stepNumber: 1, totalSteps: 5, data: { video: '/videos/a/one.mp4' } },
      },
      {
        sequence: 4,
        progress: { step: 'skipping_rename', percentage: 100, current: 1, total: 2, stepNumber: 5, totalSteps: 5, data: { video: '/videos/a/one.mp4' } },
      },
      { sequence: 5, progress: { step: 'file-skipped', data: { video: '/videos/a/two.mp4' } } },
      { sequence: 6, progress: { step: 'folder-done', data: { path: '/videos/a', filesDone: 1, filesSkipped: 1, filesFailed: 0 } } },
      {
        sequence: 7,
        progress: {
          step: 'run-summary',
          data: { runId: 'r1', root: '/videos', foldersTotal: 1, foldersDone: 1, filesTotal: 2, filesDone: 1, filesSkipped: 1, filesFailed: 0, elapsedMs: 1000, failures: [] },
        },
      },
    ],
    error: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  it('renders per-file progress lines, tracks skipped files, and invalidates on folder completion', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    server.use(
      http.post('/api/process-drive', () => HttpResponse.json({ ok: true, data: { jobId: 'job:drive' } })),
      http.get('/api/jobs/status', ({ request }) => {
        const jobId = new URL(request.url).searchParams.get('jobId') ?? '';
        return HttpResponse.json({ ok: true, data: perFileJob(jobId) });
      }),
    );
    const lines: string[] = [];
    const addLine = vi.fn((content: string) => {
      lines.push(content);
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useProcessing({ videos: [], addLine, intervalMs: 0 }), { wrapper });

    act(() => {
      result.current.driveAnalyze('/videos');
    });

    await waitFor(() => expect(result.current.isBusy).toBe(false));

    expect(lines.some((line) => line.includes('[1/2] Extracting frames: one.mp4'))).toBe(true);
    expect(lines.some((line) => line.includes('Skipped (already analyzed): two.mp4'))).toBe(true);
    expect(invalidate.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('invalidates on per-file progress before any folder-done event arrives', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    let cancelled = false;
    server.use(
      http.post('/api/process-drive', () => HttpResponse.json({ ok: true, data: { jobId: 'job:drive' } })),
      http.post('/api/jobs/cancel', () => {
        cancelled = true;
        return HttpResponse.json({ ok: true, data: { jobId: 'job:drive', cancelled: true } });
      }),
      http.get('/api/jobs/status', ({ request }) => {
        const jobId = new URL(request.url).searchParams.get('jobId') ?? '';
        return HttpResponse.json({
          ok: true,
          data: {
            jobId,
            kind: 'process_drive',
            status: cancelled ? 'cancelled' : 'running',
            progress: null,
            progressEvents: [
              { sequence: 1, progress: { step: 'run-started', data: { runId: 'r1', root: '/videos', foldersTotal: 1, filesTotal: 2 } } },
              { sequence: 2, progress: { step: 'folder-started', data: { path: '/videos/a', filesTotal: 2 } } },
              {
                sequence: 3,
                progress: { step: 'extracting_frames', percentage: 20, current: 1, total: 2, data: { video: '/videos/a/one.mp4' } },
              },
              {
                sequence: 4,
                progress: { step: 'extracting_frames', percentage: 20, current: 2, total: 2, data: { video: '/videos/a/two.mp4' } },
              },
            ],
            error: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        });
      }),
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useProcessing({ videos: [], addLine: vi.fn(), intervalMs: 0 }), { wrapper });

    act(() => {
      result.current.driveAnalyze('/videos');
    });

    await waitFor(() => expect(invalidate.mock.calls.length).toBeGreaterThanOrEqual(2));

    act(() => {
      result.current.driveCancel();
    });
    await waitFor(() => expect(result.current.isBusy).toBe(false));
  });

  it('exposes analyzingPath for the file currently in progress during a drive run, not just single-video batches (W41 item 4)', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    let cancelled = false;
    server.use(
      http.post('/api/process-drive', () => HttpResponse.json({ ok: true, data: { jobId: 'job:drive' } })),
      http.post('/api/jobs/cancel', () => {
        cancelled = true;
        return HttpResponse.json({ ok: true, data: { jobId: 'job:drive', cancelled: true } });
      }),
      http.get('/api/jobs/status', ({ request }) => {
        const jobId = new URL(request.url).searchParams.get('jobId') ?? '';
        return HttpResponse.json({
          ok: true,
          data: {
            jobId,
            kind: 'process_drive',
            status: cancelled ? 'cancelled' : 'running',
            progress: null,
            progressEvents: [
              { sequence: 1, progress: { step: 'run-started', data: { runId: 'r1', root: '/videos', foldersTotal: 1, filesTotal: 1 } } },
              { sequence: 2, progress: { step: 'folder-started', data: { path: '/videos/a', filesTotal: 1 } } },
              {
                sequence: 3,
                progress: { step: 'extracting_frames', percentage: 20, current: 1, total: 1, data: { video: '/videos/a/gotowanie.mp4' } },
              },
            ],
            error: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        });
      }),
    );

    const { result } = renderHook(() => useProcessing({ videos: [], addLine: vi.fn(), intervalMs: 0 }), { wrapper });

    act(() => {
      result.current.driveAnalyze('/videos');
    });

    await waitFor(() => expect(result.current.analyzingPath).toBe('/videos/a/gotowanie.mp4'));

    act(() => {
      result.current.driveCancel();
    });
    await waitFor(() => expect(result.current.isBusy).toBe(false));
    expect(result.current.analyzingPath).toBe(null);
  });

  const batchJob = (jobId: string) => ({
    jobId,
    kind: 'process_drive',
    status: 'completed',
    progress: null,
    progressEvents: [
      { sequence: 1, progress: { step: 'run-started', data: { runId: 'r1', root: '/videos', foldersTotal: 1, filesTotal: 2 } } },
      { sequence: 2, progress: { step: 'folder-started', data: { path: '/videos/a', filesTotal: 2 } } },
      {
        sequence: 3,
        progress: { step: 'batch_submitted', data: { jobName: 'batches/42', requestCount: 2, model: 'gemini-3.6-flash', reattached: false } },
      },
      { sequence: 4, progress: { step: 'batch_poll', data: { jobName: 'batches/42', state: 'running', attempt: 1, requestCount: 2 } } },
      { sequence: 5, progress: { step: 'batch_completed', data: { jobName: 'batches/42', state: 'succeeded', succeeded: 2, failed: 0 } } },
      { sequence: 6, progress: { step: 'folder-done', data: { path: '/videos/a', filesDone: 2, filesSkipped: 0, filesFailed: 0 } } },
      {
        sequence: 7,
        progress: {
          step: 'run-summary',
          data: { runId: 'r1', root: '/videos', foldersTotal: 1, foldersDone: 1, filesTotal: 2, filesDone: 2, filesSkipped: 0, filesFailed: 0, elapsedMs: 1000, failures: [] },
        },
      },
    ],
    error: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  it('renders the batch lifecycle instead of a per-file bar and clears the wait when results land', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    server.use(
      http.post('/api/process-drive', () => HttpResponse.json({ ok: true, data: { jobId: 'job:drive' } })),
      http.get('/api/jobs/status', ({ request }) => {
        const jobId = new URL(request.url).searchParams.get('jobId') ?? '';
        return HttpResponse.json({ ok: true, data: batchJob(jobId) });
      }),
    );
    const lines: string[] = [];
    const addLine = vi.fn((content: string) => {
      lines.push(content);
    });

    const { result } = renderHook(() => useProcessing({ videos: [], addLine, intervalMs: 0 }), { wrapper });

    act(() => {
      result.current.driveAnalyze('/videos');
    });
    await waitFor(() => expect(result.current.isBusy).toBe(false));

    expect(lines.some((line) => line.includes('Batch submitted: 2 file(s) at half price'))).toBe(true);
    expect(lines.some((line) => line.includes('Batch running (2 file(s))'))).toBe(true);
    expect(lines.some((line) => line.includes('Batch results in: 2 answered, 0 failed'))).toBe(true);
    expect(result.current.driveBatchWait).toBe(null);
    expect(result.current.driveFileProgress).toBe(null);
  });

  it('stops an active drive run without a confirmation dialog', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    let cancelled = false;
    let polls = 0;
    server.use(
      http.post('/api/process-drive', () => HttpResponse.json({ ok: true, data: { jobId: 'job:drive' } })),
      http.post('/api/jobs/cancel', () => {
        cancelled = true;
        return HttpResponse.json({ ok: true, data: { jobId: 'job:drive', cancelled: true } });
      }),
      http.get('/api/jobs/status', ({ request }) => {
        polls += 1;
        const jobId = new URL(request.url).searchParams.get('jobId') ?? '';
        return HttpResponse.json({
          ok: true,
          data: {
            jobId,
            kind: 'process_drive',
            status: cancelled ? 'cancelled' : 'running',
            progress: null,
            progressEvents: [],
            error: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        });
      }),
    );

    const { result } = renderHook(() => useProcessing({ videos: [], addLine: vi.fn(), intervalMs: 0 }), { wrapper });

    act(() => {
      result.current.driveAnalyze('/videos');
    });

    await waitFor(() => expect(polls).toBeGreaterThan(0));
    act(() => {
      result.current.driveCancel();
    });

    await waitFor(() => expect(cancelled).toBe(true));
    await waitFor(() => expect(result.current.isBusy).toBe(false));
  });

  it('refuses a drive run when the immediate readiness refresh is unready', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const checked = vi.fn().mockResolvedValue(false);
    const started = vi.fn();
    server.use(http.post('/api/process-drive', started));

    const { result } = renderHook(
      () => useProcessing({ videos: [], addLine: vi.fn(), intervalMs: 0, checkReadiness: checked }),
      { wrapper },
    );

    act(() => {
      result.current.driveAnalyze('/videos');
    });

    await waitFor(() => expect(checked).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.isBusy).toBe(false));
    expect(started).not.toHaveBeenCalled();
  });

  it('honours a Stop click that lands before the run has an assigned job id, instead of letting the run start anyway', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    let releaseAccept!: () => void;
    const accepted = new Promise<void>((resolve) => {
      releaseAccept = resolve;
    });
    let cancelledJobId: string | null = null;
    server.use(
      http.post('/api/process-drive', async () => {
        await accepted;
        return HttpResponse.json({ ok: true, data: { jobId: 'job:drive-race' } });
      }),
      http.post('/api/jobs/cancel', async ({ request }) => {
        const body = z.object({ jobId: z.string() }).parse(await request.json());
        cancelledJobId = body.jobId;
        return HttpResponse.json({ ok: true, data: { jobId: body.jobId, cancelled: true } });
      }),
      http.get('/api/jobs/status', ({ request }) => {
        const jobId = new URL(request.url).searchParams.get('jobId') ?? '';
        return HttpResponse.json({
          ok: true,
          data: { ...driveJob(jobId), status: cancelledJobId === jobId ? 'cancelled' : 'running' },
        });
      }),
    );
    const addLine = vi.fn();

    const { result } = renderHook(
      () => useProcessing({ videos: [], addLine, intervalMs: 0 }),
      { wrapper },
    );

    act(() => {
      result.current.driveAnalyze('/videos');
    });
    await waitFor(() => expect(result.current.isBusy).toBe(true));

    act(() => {
      result.current.driveCancel();
    });
    expect(addLine).toHaveBeenCalledWith('Stop requested — will cancel as soon as the run starts.', 'info');

    releaseAccept();

    await waitFor(() => expect(cancelledJobId).toBe('job:drive-race'));
    await waitFor(() => expect(result.current.isBusy).toBe(false));
  });
});
