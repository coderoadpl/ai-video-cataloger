import { type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createTestQueryClient } from '../../test/render.js';
import { server } from '../../test/server.js';
import { useProcessing } from './use-processing.js';

type Videos = Parameters<typeof useProcessing>[0]['videos'];

const videos: Videos = [
  { path: '/v/bad.mp4', filename: 'bad.mp4', status: 'pending' },
  { path: '/v/good1.mp4', filename: 'good1.mp4', status: 'pending' },
  { path: '/v/good2.mp4', filename: 'good2.mp4', status: 'not_tracked' },
];

const processBodySchema = z.object({ videoPath: z.string() });

const jobSnapshot = (jobId: string) => {
  const failed = jobId.includes('bad');
  return {
    jobId,
    kind: 'process',
    status: failed ? 'failed' : 'completed',
    progress: null,
    progressEvents: [],
    error: failed ? { code: 'processing_error', message: 'ffmpeg exploded' } : null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
};

describe('useProcessing batch', () => {
  it('refuses a run when the immediate readiness refresh is unready', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const checked = vi.fn().mockResolvedValue(false);
    const processed = vi.fn();
    server.use(http.post('/api/process', processed));
    const { result } = renderHook(() => useProcessing({
      videos,
      addLine: vi.fn(),
      intervalMs: 0,
      checkReadiness: checked,
    }), { wrapper });
    const video = videos[0];
    if (video === undefined) throw new Error('Expected video fixture');

    act(() => {
      result.current.analyze(video);
    });
    await waitFor(() => expect(checked).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.isBusy).toBe(false));
    expect(processed).not.toHaveBeenCalled();
  });

  it('continues past a failure and reports every result', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const processed: string[] = [];
    server.use(
      http.post('/api/process', async ({ request }) => {
        const { videoPath } = processBodySchema.parse(await request.json());
        processed.push(videoPath);
        return HttpResponse.json({ ok: true, data: { jobId: `job:${videoPath}` } });
      }),
      http.get('/api/jobs/status', ({ request }) => {
        const jobId = new URL(request.url).searchParams.get('jobId') ?? '';
        return HttpResponse.json({ ok: true, data: jobSnapshot(jobId) });
      }),
    );

    const { result } = renderHook(() => useProcessing({ videos, addLine: vi.fn(), intervalMs: 0 }), {
      wrapper,
    });

    act(() => {
      result.current.batchAnalyze();
    });

    await waitFor(() => expect(result.current.batchSummary.open).toBe(true));

    expect(processed).toEqual(['/v/bad.mp4', '/v/good1.mp4', '/v/good2.mp4']);

    const summary = result.current.batchSummary.results;
    expect(summary.map((r) => r.filename)).toEqual(['bad.mp4', 'good1.mp4', 'good2.mp4']);
    expect(summary.map((r) => r.success)).toEqual([false, true, true]);
    expect(summary.at(0)?.error).toBe('ffmpeg exploded');
    expect(result.current.batchProgress).toBeNull();
  });

  it('keeps the busy guard until a cancelled job actually settles', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const processed: string[] = [];
    let terminal = false;
    server.use(
      http.post('/api/process', async ({ request }) => {
        const { videoPath } = processBodySchema.parse(await request.json());
        processed.push(videoPath);
        return HttpResponse.json({ ok: true, data: { jobId: `job:${videoPath}` } });
      }),
      http.post('/api/jobs/cancel', () => HttpResponse.json({
        ok: true,
        data: { jobId: 'job:/v/good1.mp4', cancelled: true },
      })),
      http.get('/api/jobs/status', ({ request }) => {
        const jobId = new URL(request.url).searchParams.get('jobId') ?? '';
        return HttpResponse.json({
          ok: true,
          data: {
            ...jobSnapshot(jobId),
            status: terminal ? 'cancelled' : 'running',
            error: null,
          },
        });
      }),
    );
    const { result } = renderHook(() => useProcessing({ videos, addLine: vi.fn(), intervalMs: 1 }), { wrapper });
    const first = videos[1];
    const second = videos[2];
    if (first === undefined || second === undefined) throw new Error('Expected processing fixtures');

    act(() => {
      result.current.analyze(first);
    });
    await waitFor(() => expect(processed).toEqual(['/v/good1.mp4']));
    act(() => {
      result.current.requestCancel();
      result.current.confirmCancel();
      result.current.analyze(second);
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    expect(processed).toEqual(['/v/good1.mp4']);
    expect(result.current.isBusy).toBe(true);

    terminal = true;
    await waitFor(() => expect(result.current.isBusy).toBe(false));
    act(() => {
      result.current.analyze(second);
    });
    await waitFor(() => expect(processed).toEqual(['/v/good1.mp4', '/v/good2.mp4']));
  }, 30_000);

  it('reports the renamed path after a completed analysis so selection can follow', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const onVideoRenamed = vi.fn();
    server.use(
      http.post('/api/process', () => HttpResponse.json({ ok: true, data: { jobId: 'job:rename' } })),
      http.get('/api/jobs/status', () => HttpResponse.json({
        ok: true,
        data: {
          ...jobSnapshot('job:rename'),
          result: {
            video: '2026-01-01_renamed.mp4',
            path: '/v/2026-01-01_renamed.mp4',
            status: 'completed',
            configId: 'cfg_0123456789ab',
            selectedConfigId: 'cfg_0123456789ab',
          },
        },
      })),
    );
    const { result } = renderHook(() => useProcessing({
      videos,
      addLine: vi.fn(),
      intervalMs: 0,
      onVideoRenamed,
    }), { wrapper });
    const video = videos[1];
    if (video === undefined) throw new Error('Expected video fixture');

    act(() => {
      result.current.analyze(video, { force: true });
    });

    await waitFor(() => expect(result.current.isBusy).toBe(false));
    await waitFor(() => expect(onVideoRenamed).toHaveBeenCalledWith('/v/good1.mp4', '/v/2026-01-01_renamed.mp4'));
  });

  it('does not report a rename when the completed path is unchanged', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const onVideoRenamed = vi.fn();
    server.use(
      http.post('/api/process', () => HttpResponse.json({ ok: true, data: { jobId: 'job:same' } })),
      http.get('/api/jobs/status', () => HttpResponse.json({
        ok: true,
        data: {
          ...jobSnapshot('job:same'),
          result: {
            video: 'good1.mp4',
            path: '/v/good1.mp4',
            status: 'completed',
            configId: 'cfg_0123456789ab',
            selectedConfigId: 'cfg_0123456789ab',
          },
        },
      })),
    );
    const { result } = renderHook(() => useProcessing({
      videos,
      addLine: vi.fn(),
      intervalMs: 0,
      onVideoRenamed,
    }), { wrapper });
    const video = videos[1];
    if (video === undefined) throw new Error('Expected video fixture');

    act(() => {
      result.current.analyze(video);
    });

    await waitFor(() => expect(result.current.isBusy).toBe(false));
    expect(onVideoRenamed).not.toHaveBeenCalled();
  });

  it('releases the busy guard after a job poll rejects', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const processed: string[] = [];
    let polls = 0;
    server.use(
      http.post('/api/process', async ({ request }) => {
        const { videoPath } = processBodySchema.parse(await request.json());
        processed.push(videoPath);
        return HttpResponse.json({ ok: true, data: { jobId: `job:${videoPath}` } });
      }),
      http.get('/api/jobs/status', ({ request }) => {
        polls += 1;
        if (polls === 1) return HttpResponse.json({ ok: false, error: { code: 'internal', message: 'poll unavailable' } });
        const jobId = new URL(request.url).searchParams.get('jobId') ?? '';
        return HttpResponse.json({ ok: true, data: jobSnapshot(jobId) });
      }),
    );
    const { result } = renderHook(() => useProcessing({ videos, addLine: vi.fn(), intervalMs: 0 }), { wrapper });
    const first = videos[1];
    const second = videos[2];
    if (first === undefined || second === undefined) throw new Error('Expected processing fixtures');

    act(() => {
      result.current.analyze(first);
    });
    await waitFor(() => expect(result.current.isBusy).toBe(false));
    act(() => {
      result.current.analyze(second);
    });

    await waitFor(() => expect(processed).toEqual(['/v/good1.mp4', '/v/good2.mp4']));
    await waitFor(() => expect(result.current.isBusy).toBe(false));
  });
});
