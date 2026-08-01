import { useState, type ReactElement, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import type { photoListItemSchema } from '@core/contract/index.js';

import { bridge } from '../../api.js';
import { createTestQueryClient } from '../../test/render.js';
import { server } from '../../test/server.js';
import { usePhotosAnalysis } from './use-photos-analysis.js';

type PhotoListItem = z.output<typeof photoListItemSchema>;

const photoItem = (overrides: Partial<PhotoListItem> & { fingerprint: string; currentPath: string }): PhotoListItem => ({
  fileName: `${overrides.fingerprint}.jpg`,
  ext: 'jpg',
  capturedAt: null,
  capturedAtSource: null,
  width: null,
  height: null,
  proxyState: 'done',
  thumbState: 'done',
  missingAt: null,
  sightings: 1,
  thumbPath: null,
  gridThumbPath: null,
  proxyPath: null,
  analysed: false,
  exifReadAt: null,
  ...overrides,
});

const stubTree = (roots: { root: string; photos: number; missing: number; lastScanAt: string }[]) => {
  server.use(http.get('/api/photos/tree', () =>
    HttpResponse.json({ ok: true, data: { media: 'photo', roots } })));
};

const stubList = (items: PhotoListItem[]) => {
  server.use(http.get('/api/photos/list', ({ request }) => {
    const root = new URL(request.url).searchParams.get('root');
    const scoped = root === null ? items : items.filter((item) => item.currentPath.startsWith(`${root}/`));
    return HttpResponse.json({ ok: true, data: { media: 'photo', root, total: scoped.length, offset: 0, items: scoped } });
  }));
};

const Wrapper = ({ children }: { children: ReactNode }): ReactElement => {
  const [client] = useState(createTestQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

describe('usePhotosAnalysis', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('falls back to the first root when the persisted root has vanished', async () => {
    window.localStorage.setItem('avc.photosRoot', '/gone');
    stubTree([{ root: '/media', photos: 1, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' }]);
    stubList([photoItem({ fingerprint: 'a', currentPath: '/media/a.jpg' })]);

    const { result } = renderHook(() => usePhotosAnalysis({ active: true, addLine: vi.fn() }), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.selectedRoot).toBe('/media'));
  });

  it('keeps the persisted root when it is still present', async () => {
    window.localStorage.setItem('avc.photosRoot', '/media');
    stubTree([
      { root: '/other', photos: 1, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' },
      { root: '/media', photos: 1, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' },
    ]);
    stubList([photoItem({ fingerprint: 'a', currentPath: '/media/a.jpg' })]);

    const { result } = renderHook(() => usePhotosAnalysis({ active: true, addLine: vi.fn() }), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.roots.length).toBe(2));
    expect(result.current.selectedRoot).toBe('/media');
  });

  it('persists the scope choice across a fresh mount', async () => {
    stubTree([]);
    stubList([]);

    const first = renderHook(() => usePhotosAnalysis({ active: true, addLine: vi.fn() }), { wrapper: Wrapper });
    act(() => first.result.current.setScope('all'));
    expect(first.result.current.scope).toBe('all');

    const second = renderHook(() => usePhotosAnalysis({ active: true, addLine: vi.fn() }), { wrapper: Wrapper });
    expect(second.result.current.scope).toBe('all');
  });

  it('scanFolder opens the photos picker, runs the scan job, and selects the scanned root', async () => {
    stubList([]);
    const showPicker = vi.spyOn(bridge.folder, 'showPicker').mockResolvedValue('/new-root');
    server.use(
      http.get('/api/photos/tree', () => HttpResponse.json({
        ok: true,
        data: { media: 'photo', roots: [{ root: '/new-root', photos: 0, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' }] },
      })),
      http.post('/api/photos/scan', () => HttpResponse.json({ ok: true, data: { jobId: 'job-1' } })),
      http.get('/api/jobs/status', () => HttpResponse.json({
        ok: true,
        data: {
          jobId: 'job-1',
          kind: 'photo_scan',
          status: 'completed',
          progress: null,
          progressEvents: [],
          error: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          result: null,
        },
      })),
    );

    const { result } = renderHook(() => usePhotosAnalysis({ active: true, addLine: vi.fn() }), { wrapper: Wrapper });
    act(() => result.current.scanFolder());

    await waitFor(() => expect(showPicker).toHaveBeenCalledWith('photos'));
    await waitFor(() => expect(result.current.selectedRoot).toBe('/new-root'));
    showPicker.mockRestore();
  });
});
