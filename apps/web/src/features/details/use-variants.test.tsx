import { type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import type { scanVideoSchema } from '@core/contract/index.js';

import { createTestQueryClient } from '../../test/render.js';
import { server } from '../../test/server.js';
import { useVariants } from './use-variants.js';

type DetailsVideo = z.output<typeof scanVideoSchema>;

const video: DetailsVideo = {
  path: '/videos/clip.mp4',
  filename: 'clip.mp4',
  size: 2048,
  sizeFormatted: '2.0 KB',
  duration: 90,
  durationFormatted: '1:30',
  status: 'completed',
  errorMessage: null,
  contentHash: 'hash-a',
  artifacts: {
    framePaths: null,
    transcriptContent: null,
    transcriptPath: null,
    summary: null,
    summaryPath: null,
    thumbnailPath: null,
    thumbnailMtime: null,
    newFilename: null,
  },
};

const configId = 'cfg_111111111111';
const descriptor = {
  family: 'local',
  providerId: 'local',
  modelTag: 'gemma3:12b',
  whisper_mode: 'local',
  whisper_model: 'base',
  whisper_language: 'auto',
  frames: 2,
  output_language: 'en',
  promptVersion: 1,
} as const;

const variantsResponse = (folderDefaultConfigId: string | null) => ({
  ok: true,
  data: {
    fingerprint: 'hash-a',
    videoPath: '/videos/clip.mp4',
    folderPath: '/videos',
    folderDefaultConfigId,
    currentConfig: { configId, descriptor },
    variants: [
      {
        configId,
        descriptor,
        label: 'gemma3:12b',
        createdAt: '2026-08-01T00:00:00.000Z',
        analyzer: 'local',
        model: 'gemma3:12b',
        usage: null,
        estimatedCostUsd: null,
        artifacts: { framesDirectory: null, transcriptPath: null, summaryPath: `/catalog/variants/hash-a/${configId}/summary.txt` },
        selected: true,
        finalName: 'clip.mp4',
        description: 'Summary',
        transcript: 'Transcript',
        language: 'en',
        tags: [],
      },
    ],
  },
});

describe('useVariants folder-default mechanism', () => {
  it('still exposes a working setFolderDefaultVariant mutation for a future UI, even with no caller today', async () => {
    const writes: unknown[] = [];
    server.use(
      http.get('/api/variants', () => HttpResponse.json(variantsResponse(null))),
      http.post('/api/variants/folder-default', async ({ request }) => {
        writes.push(await request.json());
        return HttpResponse.json({
          ok: true,
          data: { folderId: '11111111-1111-4111-8111-111111111111', defaultConfigId: configId, resolvedConfigId: configId },
        });
      }),
    );
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useVariants(video), { wrapper });

    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.settingFolderDefault).toBe(false);

    result.current.useCurrentAsFolderDefault();

    await waitFor(() => expect(writes).toEqual([{ folderPath: '/videos', configId }]));
  });

  it('is a no-op when the selected configuration is already the folder default', async () => {
    server.use(
      http.get('/api/variants', () => HttpResponse.json(variantsResponse(configId))),
      http.post('/api/variants/folder-default', () => {
        throw new Error('should not be called');
      }),
    );
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useVariants(video), { wrapper });

    await waitFor(() => expect(result.current.data).not.toBeNull());
    result.current.useCurrentAsFolderDefault();
    expect(result.current.settingFolderDefault).toBe(false);
  });
});
