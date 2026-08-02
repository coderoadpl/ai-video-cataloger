import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { z } from 'zod';

import type { scanVideoSchema } from '@core/contract/index.js';

import { useCatalogVideoRegistry } from './use-catalog-video-registry.js';

type ScanVideo = z.output<typeof scanVideoSchema>;

const makeVideo = (path: string, contentHash: string | null): ScanVideo => ({
  path,
  filename: path.split('/').pop() ?? '',
  size: 1024,
  sizeFormatted: '1.0 KB',
  duration: 60,
  durationFormatted: '1:00',
  status: 'pending',
  errorMessage: null,
  contentHash,
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
});

describe('useCatalogVideoRegistry', () => {
  it('drops a stale entry whose path disappeared once the same contentHash is registered at a new path', () => {
    const { result } = renderHook(() => useCatalogVideoRegistry());

    act(() => result.current.register([makeVideo('/videos/old.mp4', 'hash-1')]));
    expect(result.current.lookup('/videos/old.mp4')).not.toBeNull();

    act(() => result.current.register([makeVideo('/videos/renamed.mp4', 'hash-1')]));

    expect(result.current.lookup('/videos/old.mp4')).toBeNull();
    expect(result.current.lookup('/videos/renamed.mp4')).not.toBeNull();
  });

  it('keeps unrelated entries whose contentHash does not match the freshly registered video', () => {
    const { result } = renderHook(() => useCatalogVideoRegistry());

    act(() => result.current.register([makeVideo('/videos/a.mp4', 'hash-a')]));
    act(() => result.current.register([makeVideo('/videos/b.mp4', 'hash-b')]));

    expect(result.current.lookup('/videos/a.mp4')).not.toBeNull();
    expect(result.current.lookup('/videos/b.mp4')).not.toBeNull();
  });

  it('never drops entries when the registered video has no contentHash', () => {
    const { result } = renderHook(() => useCatalogVideoRegistry());

    act(() => result.current.register([makeVideo('/videos/a.mp4', null)]));
    act(() => result.current.register([makeVideo('/videos/b.mp4', null)]));

    expect(result.current.lookup('/videos/a.mp4')).not.toBeNull();
    expect(result.current.lookup('/videos/b.mp4')).not.toBeNull();
  });
});
