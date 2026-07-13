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
    error: failed ? { code: 'processing_error', message: 'ffmpeg exploded' } : null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
};

describe('useProcessing batch', () => {
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
});
