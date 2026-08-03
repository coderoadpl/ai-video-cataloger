import { useState, type ReactElement, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

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

const stubPagedList = (allItems: PhotoListItem[], analysedFlag: { current: boolean }) => {
  server.use(http.get('/api/photos/list', ({ request }) => {
    const url = new URL(request.url);
    const root = url.searchParams.get('root');
    const offset = Number(url.searchParams.get('offset') ?? '0');
    const limit = Number(url.searchParams.get('limit') ?? '200');
    const scoped = root === null ? allItems : allItems.filter((item) => item.currentPath.startsWith(`${root}/`));
    const page = scoped.slice(offset, offset + limit).map((item) => ({ ...item, analysed: analysedFlag.current }));
    return HttpResponse.json({ ok: true, data: { media: 'photo', root, total: scoped.length, offset, items: page } });
  }));
};

const stubStatus = () => {
  server.use(http.get('/api/photos/status', ({ request }) => {
    const root = new URL(request.url).searchParams.get('root');
    return HttpResponse.json({
      ok: true,
      data: {
        media: 'photo',
        root,
        counts: {
          photos: 0,
          paths: 0,
          exifRead: 0,
          exifFailed: 0,
          missing: 0,
          duplicates: 0,
          proxied: 0,
          proxyFailed: 0,
          analysed: 0,
          facesIndexed: 0,
        },
      },
    });
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

  it('derives the selected root from the current folder when it matches a known root', async () => {
    stubTree([{ root: '/media', photos: 1, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' }]);
    stubList([photoItem({ fingerprint: 'a', currentPath: '/media/a.jpg' })]);
    stubStatus();

    const { result } = renderHook(
      () => usePhotosAnalysis({ active: true, addLine: vi.fn(), folder: '/media' }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.selectedRoot).toBe('/media'));
    expect(result.current.folderState).toBe('scanned');
  });

  it('never flashes "unscanned" for an already-scanned folder while the media switch activates the queries', async () => {
    stubTree([{ root: '/media', photos: 1, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' }]);
    stubList([photoItem({ fingerprint: 'a', currentPath: '/media/a.jpg' })]);
    stubStatus();

    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => usePhotosAnalysis({ active, addLine: vi.fn(), folder: '/media' }),
      { wrapper: Wrapper, initialProps: { active: false } },
    );

    rerender({ active: true });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.folderState).toBe('scanned'));
  });

  it('never falls back to another known root when the current folder is not one of them', async () => {
    stubTree([{ root: '/old/pictures', photos: 1, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' }]);
    stubList([photoItem({ fingerprint: 'a', currentPath: '/old/pictures/a.jpg' })]);
    stubStatus();

    const { result } = renderHook(
      () => usePhotosAnalysis({ active: true, addLine: vi.fn(), folder: '/a/b' }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.roots.length).toBe(1));
    expect(result.current.selectedRoot).toBe(null);
    expect(result.current.folderState).toBe('unscanned');
  });

  it('reports no-folder state and a null selected root when there is no current folder', async () => {
    stubTree([{ root: '/media', photos: 1, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' }]);
    stubList([photoItem({ fingerprint: 'a', currentPath: '/media/a.jpg' })]);
    stubStatus();

    const { result } = renderHook(
      () => usePhotosAnalysis({ active: true, addLine: vi.fn(), folder: null }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.roots.length).toBe(1));
    expect(result.current.selectedRoot).toBe(null);
    expect(result.current.folderState).toBe('no-folder');
  });

  it('a stale persisted photos root in localStorage has no effect on the derived selection', async () => {
    window.localStorage.setItem('avc.photosRoot', '/old/pictures');
    stubTree([{ root: '/media', photos: 1, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' }]);
    stubList([photoItem({ fingerprint: 'a', currentPath: '/media/a.jpg' })]);
    stubStatus();

    const { result } = renderHook(
      () => usePhotosAnalysis({ active: true, addLine: vi.fn(), folder: '/media' }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.selectedRoot).toBe('/media'));
  });

  it('persists the scope choice across a fresh mount', async () => {
    stubTree([]);
    stubList([]);

    const first = renderHook(
      () => usePhotosAnalysis({ active: true, addLine: vi.fn(), folder: null }),
      { wrapper: Wrapper },
    );
    act(() => first.result.current.setScope('all'));
    expect(first.result.current.scope).toBe('all');

    const second = renderHook(
      () => usePhotosAnalysis({ active: true, addLine: vi.fn(), folder: null }),
      { wrapper: Wrapper },
    );
    expect(second.result.current.scope).toBe('all');
  });

  it('scanFolder never opens a folder picker and scans the current folder directly', async () => {
    stubList([]);
    stubStatus();
    const showPicker = vi.spyOn(bridge.folder, 'showPicker');
    let scannedRoot: string | null = null;
    server.use(
      http.get('/api/photos/tree', () => HttpResponse.json({
        ok: true,
        data: { media: 'photo', roots: [{ root: '/new-root', photos: 0, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' }] },
      })),
      http.post('/api/photos/scan', async ({ request }) => {
        const body = z.object({ root: z.string() }).parse(await request.json());
        scannedRoot = body.root;
        return HttpResponse.json({ ok: true, data: { jobId: 'job-1' } });
      }),
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

    const { result } = renderHook(
      () => usePhotosAnalysis({ active: true, addLine: vi.fn(), folder: '/new-root' }),
      { wrapper: Wrapper },
    );
    act(() => result.current.scanFolder());

    await waitFor(() => expect(scannedRoot).toBe('/new-root'));
    expect(showPicker).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.selectedRoot).toBe('/new-root'));
    showPicker.mockRestore();
  });

  it('scanFolder does nothing when there is no current folder', async () => {
    stubTree([]);
    stubList([]);
    stubStatus();
    const scanSpy = vi.fn();
    server.use(http.post('/api/photos/scan', () => {
      scanSpy();
      return HttpResponse.json({ ok: true, data: { jobId: 'job-1' } });
    }));

    const { result } = renderHook(
      () => usePhotosAnalysis({ active: true, addLine: vi.fn(), folder: null }),
      { wrapper: Wrapper },
    );
    act(() => result.current.scanFolder());

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scanSpy).not.toHaveBeenCalled();
  });

  it('does not start generate-proxies while a scan is still in flight', async () => {
    stubTree([{ root: '/media', photos: 1, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' }]);
    stubList([photoItem({ fingerprint: 'a', currentPath: '/media/a.jpg' })]);
    stubStatus();
    const proxiesSpy = vi.fn();
    server.use(
      http.post('/api/photos/scan', () => HttpResponse.json({ ok: true, data: { jobId: 'job-1' } })),
      http.get('/api/jobs/status', () => new Promise(() => undefined)),
      http.post('/api/photos/proxies', () => {
        proxiesSpy();
        return HttpResponse.json({ ok: true, data: { jobId: 'job-2' } });
      }),
    );

    const { result } = renderHook(
      () => usePhotosAnalysis({ active: true, addLine: vi.fn(), folder: '/media' }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.selectedRoot).toBe('/media'));
    act(() => result.current.scanFolder());
    await waitFor(() => expect(result.current.activeJobLabel).not.toBeNull());

    act(() => result.current.generateProxies());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(proxiesSpy).not.toHaveBeenCalled();
  });

  it('gives scanFolder distinct start/success/failure labels instead of reusing the page title for all three', async () => {
    stubTree([]);
    stubList([]);
    stubStatus();
    const addLine = vi.fn();
    server.use(
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
        },
      })),
    );

    const { result } = renderHook(
      () => usePhotosAnalysis({ active: true, addLine, folder: '/media' }),
      { wrapper: Wrapper },
    );
    act(() => result.current.scanFolder());

    await waitFor(() => expect(addLine.mock.calls.some(([, level]) => level === 'success')).toBe(true));
    const messages = new Set(addLine.mock.calls.map(([message]) => message));
    expect(messages.size).toBeGreaterThan(1);
  });

  it('analyzePhotos runs the process job over the selected root', async () => {
    stubTree([{ root: '/media', photos: 1, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' }]);
    stubList([photoItem({ fingerprint: 'a', currentPath: '/media/a.jpg' })]);
    stubStatus();
    let processedRoot: string | null = null;
    server.use(
      http.post('/api/photos/process', async ({ request }) => {
        const body = z.object({ root: z.string() }).parse(await request.json());
        processedRoot = body.root;
        return HttpResponse.json({ ok: true, data: { jobId: 'job-1' } });
      }),
      http.get('/api/jobs/status', () => HttpResponse.json({
        ok: true,
        data: {
          jobId: 'job-1',
          kind: 'photo_process',
          status: 'completed',
          progress: null,
          progressEvents: [],
          error: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          result: { media: 'photo', root: '/media', force: false, configId: 'cfg_1', batchSize: 1, candidates: 1, analysed: 1, failed: 0, skippedExisting: 0 },
        },
      })),
    );

    const { result } = renderHook(() => usePhotosAnalysis({ active: true, addLine: vi.fn(), folder: '/media' }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.selectedRoot).toBe('/media'));
    act(() => result.current.analyzePhotos());

    await waitFor(() => expect(processedRoot).toBe('/media'));
  });

  it('under the "all folders" scope, analyzePhotos processes every scanned root, not just the selected photo\'s folder (W56 Q5a)', async () => {
    window.localStorage.setItem('avc.photosScope', 'all');
    stubTree([
      { root: '/media', photos: 1, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' },
      { root: '/other', photos: 1, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' },
    ]);
    stubList([
      photoItem({ fingerprint: 'a', currentPath: '/media/a.jpg' }),
      photoItem({ fingerprint: 'b', currentPath: '/other/b.jpg' }),
    ]);
    stubStatus();
    server.use(http.get('/api/photos/detail', () => HttpResponse.json({ ok: false, error: { code: 'not_found', message: 'no detail' } })));
    server.use(http.get('/api/photos/variants', () => HttpResponse.json({ ok: true, data: { variants: [] } })));
    let processedBody: Record<string, unknown> | null = null;
    server.use(
      http.post('/api/photos/process', async ({ request }) => {
        processedBody = z.record(z.string(), z.unknown()).parse(await request.json());
        return HttpResponse.json({ ok: true, data: { jobId: 'job-1' } });
      }),
      http.get('/api/jobs/status', () => HttpResponse.json({
        ok: true,
        data: {
          jobId: 'job-1',
          kind: 'photo_process',
          status: 'completed',
          progress: null,
          progressEvents: [],
          error: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          result: { media: 'photo', root: null, force: false, configId: null, batchSize: 1, candidates: 2, analysed: 2, failed: 0, skippedExisting: 0 },
        },
      })),
    );

    const { result } = renderHook(() => usePhotosAnalysis({ active: true, addLine: vi.fn(), folder: '/media' }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.selectedRoot).toBe('/media'));
    act(() => result.current.selectFingerprint('b'));
    await waitFor(() => expect(result.current.items.some((item) => item.fingerprint === 'b')).toBe(true));
    act(() => result.current.analyzePhotos());

    await waitFor(() => expect(processedBody).not.toBeNull());
    expect(processedBody).not.toHaveProperty('root');
  });

  it('analyzeSelectedPhoto scopes the process job to the selected photo\'s fingerprint and owner folder (W56 Q4b)', async () => {
    window.localStorage.setItem('avc.photosScope', 'all');
    stubTree([
      { root: '/media', photos: 1, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' },
      { root: '/other', photos: 1, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' },
    ]);
    stubList([
      photoItem({ fingerprint: 'a', currentPath: '/media/a.jpg' }),
      photoItem({ fingerprint: 'b', currentPath: '/other/b.jpg' }),
    ]);
    stubStatus();
    server.use(http.get('/api/photos/detail', () => HttpResponse.json({ ok: false, error: { code: 'not_found', message: 'no detail' } })));
    server.use(http.get('/api/photos/variants', () => HttpResponse.json({ ok: true, data: { variants: [] } })));
    const processedBodySchema = z.object({ root: z.string().optional(), fingerprints: z.array(z.string()).optional() });
    let processedBody: z.output<typeof processedBodySchema> | null = null;
    server.use(
      http.post('/api/photos/process', async ({ request }) => {
        processedBody = processedBodySchema.parse(await request.json());
        return HttpResponse.json({ ok: true, data: { jobId: 'job-1' } });
      }),
      http.get('/api/jobs/status', () => HttpResponse.json({
        ok: true,
        data: {
          jobId: 'job-1',
          kind: 'photo_process',
          status: 'completed',
          progress: null,
          progressEvents: [],
          error: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          result: { media: 'photo', root: '/other', force: false, configId: 'cfg_1', batchSize: 1, candidates: 1, analysed: 1, failed: 0, skippedExisting: 0 },
        },
      })),
    );

    const { result } = renderHook(() => usePhotosAnalysis({ active: true, addLine: vi.fn(), folder: '/media' }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.selectedRoot).toBe('/media'));
    act(() => result.current.selectFingerprint('b'));
    await waitFor(() => expect(result.current.items.some((item) => item.fingerprint === 'b')).toBe(true));
    act(() => result.current.analyzeSelectedPhoto());

    await waitFor(() => expect(processedBody).toEqual({ root: '/other', fingerprints: ['b'] }));
  });

  it('marks only the single analyzed photo as in-flight, never its sibling, during analyzeSelectedPhoto (W56 Q4b)', async () => {
    stubTree([{ root: '/media', photos: 2, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' }]);
    stubList([
      photoItem({ fingerprint: 'a', currentPath: '/media/a.jpg' }),
      photoItem({ fingerprint: 'b', currentPath: '/media/b.jpg' }),
    ]);
    stubStatus();
    server.use(http.get('/api/photos/detail', () => HttpResponse.json({ ok: false, error: { code: 'not_found', message: 'no detail' } })));
    server.use(http.get('/api/photos/variants', () => HttpResponse.json({ ok: true, data: { variants: [] } })));

    let statusCall = 0;
    server.use(
      http.post('/api/photos/process', () => HttpResponse.json({ ok: true, data: { jobId: 'job-1' } })),
      http.get('/api/jobs/status', () => {
        statusCall += 1;
        if (statusCall === 1) {
          return HttpResponse.json({
            ok: true,
            data: {
              jobId: 'job-1',
              kind: 'photo_process',
              status: 'running',
              progress: { step: 'photo-analysis-batch-started', data: { fingerprints: ['a'] } },
              progressEvents: [
                { sequence: 1, progress: { step: 'photo-analysis-batch-started', data: { fingerprints: ['a'] } } },
              ],
              error: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          });
        }
        return HttpResponse.json({
          ok: true,
          data: {
            jobId: 'job-1',
            kind: 'photo_process',
            status: 'completed',
            progress: { step: 'photo-analysed', data: { fingerprint: 'a', current: 1, total: 1 } },
            progressEvents: [
              { sequence: 1, progress: { step: 'photo-analysis-batch-started', data: { fingerprints: ['a'] } } },
              { sequence: 2, progress: { step: 'photo-analysed', data: { fingerprint: 'a', current: 1, total: 1 } } },
            ],
            error: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            result: { media: 'photo', root: '/media', force: false, configId: 'cfg_1', batchSize: 1, candidates: 1, analysed: 1, failed: 0, skippedExisting: 0, splitRetries: 0 },
          },
        });
      }),
    );

    const { result } = renderHook(() => usePhotosAnalysis({ active: true, addLine: vi.fn(), folder: '/media', intervalMs: 250 }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.selectedRoot).toBe('/media'));
    act(() => result.current.selectFingerprint('a'));
    await waitFor(() => expect(result.current.items.some((item) => item.fingerprint === 'a')).toBe(true));

    act(() => result.current.analyzeSelectedPhoto());

    await waitFor(() => expect(result.current.processingFingerprints.has('a')).toBe(true));
    expect(result.current.processingFingerprints.has('b')).toBe(false);

    await waitFor(() => expect(result.current.activeJobLabel).toBe(null));
    expect(result.current.processingFingerprints.size).toBe(0);
  });

  it('does not duplicate already-loaded pages when a completed job invalidates and refetches the current offset', async () => {
    stubTree([{ root: '/media', photos: 300, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' }]);
    const allItems = Array.from({ length: 300 }, (_, index) =>
      photoItem({ fingerprint: `p${index}`, currentPath: `/media/p${index}.jpg` }));
    const analysedFlag = { current: false };
    stubPagedList(allItems, analysedFlag);
    stubStatus();
    server.use(
      http.post('/api/photos/process', () => {
        analysedFlag.current = true;
        return HttpResponse.json({ ok: true, data: { jobId: 'job-1' } });
      }),
      http.get('/api/jobs/status', () => HttpResponse.json({
        ok: true,
        data: {
          jobId: 'job-1',
          kind: 'photo_process',
          status: 'completed',
          progress: null,
          progressEvents: [],
          error: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          result: { media: 'photo', root: '/media', force: false, configId: 'cfg_1', batchSize: 1, candidates: 1, analysed: 1, failed: 0, skippedExisting: 0 },
        },
      })),
    );

    const { result } = renderHook(() => usePhotosAnalysis({ active: true, addLine: vi.fn(), folder: '/media' }), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.selectedRoot).toBe('/media'));
    await waitFor(() => expect(result.current.items.length).toBe(200));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items.length).toBe(300));
    expect(result.current.hasMore).toBe(false);

    act(() => result.current.analyzePhotos());
    await waitFor(() => expect(result.current.activeJobLabel).toBe(null));

    expect(result.current.items.length).toBe(300);
    const fingerprints = result.current.items.map((item) => item.fingerprint);
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
  });

  it('drives analyzeStatusLabel and per-photo in-flight tracking from the real photo_process event stream, not a frozen 0-of-0 label', async () => {
    stubTree([{ root: '/media', photos: 2, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' }]);
    stubList([
      photoItem({ fingerprint: 'a', currentPath: '/media/a.jpg' }),
      photoItem({ fingerprint: 'b', currentPath: '/media/b.jpg' }),
    ]);
    stubStatus();

    const running = (progressEvents: { sequence: number; progress: { step: string; data: Record<string, unknown> } }[]) => HttpResponse.json({
      ok: true,
      data: {
        jobId: 'job-1',
        kind: 'photo_process',
        status: 'running',
        progress: progressEvents.at(-1)?.progress ?? null,
        progressEvents,
        error: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });

    let statusCall = 0;
    server.use(
      http.post('/api/photos/process', () => HttpResponse.json({ ok: true, data: { jobId: 'job-1' } })),
      http.get('/api/jobs/status', () => {
        statusCall += 1;
        if (statusCall === 1) {
          return running([
            { sequence: 1, progress: { step: 'photo-analysis-batch-started', data: { fingerprints: ['a', 'b'] } } },
          ]);
        }
        if (statusCall === 2) {
          return running([
            { sequence: 1, progress: { step: 'photo-analysis-batch-started', data: { fingerprints: ['a', 'b'] } } },
            { sequence: 2, progress: { step: 'photo-analysed', data: { fingerprint: 'a', current: 1, total: 2 } } },
          ]);
        }
        return HttpResponse.json({
          ok: true,
          data: {
            jobId: 'job-1',
            kind: 'photo_process',
            status: 'completed',
            progress: { step: 'photo-analysed', data: { fingerprint: 'b', current: 2, total: 2 } },
            progressEvents: [
              { sequence: 1, progress: { step: 'photo-analysis-batch-started', data: { fingerprints: ['a', 'b'] } } },
              { sequence: 2, progress: { step: 'photo-analysed', data: { fingerprint: 'a', current: 1, total: 2 } } },
              { sequence: 3, progress: { step: 'photo-analysed', data: { fingerprint: 'b', current: 2, total: 2 } } },
            ],
            error: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            result: { media: 'photo', root: '/media', force: false, configId: 'cfg_1', batchSize: 2, candidates: 2, analysed: 2, failed: 0, skippedExisting: 0, splitRetries: 0 },
          },
        });
      }),
    );

    const { result } = renderHook(() => usePhotosAnalysis({ active: true, addLine: vi.fn(), folder: '/media', intervalMs: 250 }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.selectedRoot).toBe('/media'));

    act(() => result.current.analyzePhotos());

    await waitFor(() => expect(result.current.processingFingerprints.has('a')).toBe(true));
    expect(result.current.processingFingerprints.has('b')).toBe(true);

    await waitFor(() => expect(result.current.analyzeProgress).toEqual({ current: 1, total: 2 }));
    expect(result.current.analyzeStatusLabel).toBe('Analyzing 1 of 2…');
    expect(result.current.analyzeStatusLabel).not.toBe('Analyzing 0 of 0…');
    expect(result.current.processingFingerprints.has('a')).toBe(false);
    expect(result.current.processingFingerprints.has('b')).toBe(true);

    await waitFor(() => expect(result.current.activeJobLabel).toBe(null));
    expect(result.current.analyzeProgress).toBe(null);
    expect(result.current.processingFingerprints.size).toBe(0);
  });

  it('seeds the total from the scanning candidate count so the label never sits at 0 of 0 while the first batch runs', async () => {
    stubTree([{ root: '/media', photos: 2, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' }]);
    stubList([
      photoItem({ fingerprint: 'a', currentPath: '/media/a.jpg' }),
      photoItem({ fingerprint: 'b', currentPath: '/media/b.jpg' }),
    ]);
    stubStatus();

    server.use(
      http.post('/api/photos/process', () => HttpResponse.json({ ok: true, data: { jobId: 'job-1' } })),
      http.get('/api/jobs/status', () => HttpResponse.json({
        ok: true,
        data: {
          jobId: 'job-1',
          kind: 'photo_process',
          status: 'running',
          progress: { step: 'photo-analysis-batch-started', data: { fingerprints: ['a', 'b'] } },
          progressEvents: [
            { sequence: 1, progress: { step: 'photo-analysis-scanning', data: { root: '/media', configId: 'cfg_1', candidates: 9, skippedExisting: 0 } } },
            { sequence: 2, progress: { step: 'photo-analysis-batch-started', data: { fingerprints: ['a', 'b'] } } },
          ],
          error: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      })),
    );

    const { result } = renderHook(() => usePhotosAnalysis({ active: true, addLine: vi.fn(), folder: '/media', intervalMs: 250 }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.selectedRoot).toBe('/media'));

    act(() => result.current.analyzePhotos());

    await waitFor(() => expect(result.current.analyzeProgress).toEqual({ current: 0, total: 9 }));
    expect(result.current.analyzeStatusLabel).toBe('Analyzing 0 of 9…');
  });

  it('clears the analyze progress once the job settles so a later scan job does not inherit the analyze caption', async () => {
    stubTree([{ root: '/media', photos: 1, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' }]);
    stubList([photoItem({ fingerprint: 'a', currentPath: '/media/a.jpg' })]);
    stubStatus();

    server.use(
      http.post('/api/photos/process', () => HttpResponse.json({ ok: true, data: { jobId: 'job-1' } })),
      http.get('/api/jobs/status', () => HttpResponse.json({
        ok: true,
        data: {
          jobId: 'job-1',
          kind: 'photo_process',
          status: 'completed',
          progress: { step: 'photo-analysed', data: { fingerprint: 'a', current: 1, total: 1 } },
          progressEvents: [
            { sequence: 1, progress: { step: 'photo-analysis-scanning', data: { root: '/media', configId: 'cfg_1', candidates: 1, skippedExisting: 0 } } },
            { sequence: 2, progress: { step: 'photo-analysed', data: { fingerprint: 'a', current: 1, total: 1 } } },
          ],
          error: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          result: { media: 'photo', root: '/media', force: false, configId: 'cfg_1', batchSize: 1, candidates: 1, analysed: 1, failed: 0, skippedExisting: 0, splitRetries: 0 },
        },
      })),
    );

    const { result } = renderHook(() => usePhotosAnalysis({ active: true, addLine: vi.fn(), folder: '/media', intervalMs: 250 }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.selectedRoot).toBe('/media'));

    act(() => result.current.analyzePhotos());

    await waitFor(() => expect(result.current.activeJobLabel).toBe(null));
    expect(result.current.analyzeProgress).toBe(null);
    expect(result.current.analyzeStatusLabel).toBe(null);
  });

  it('logs a cancelled analyze job as a user cancellation instead of an unknown error', async () => {
    stubTree([{ root: '/media', photos: 1, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' }]);
    stubList([photoItem({ fingerprint: 'a', currentPath: '/media/a.jpg' })]);
    stubStatus();

    server.use(
      http.post('/api/photos/process', () => HttpResponse.json({ ok: true, data: { jobId: 'job-1' } })),
      http.get('/api/jobs/status', () => HttpResponse.json({
        ok: true,
        data: {
          jobId: 'job-1',
          kind: 'photo_process',
          status: 'cancelled',
          progress: { step: 'photo-analysis-batch-started', data: { fingerprints: ['a'] } },
          progressEvents: [
            { sequence: 1, progress: { step: 'photo-analysis-batch-started', data: { fingerprints: ['a'] } } },
          ],
          error: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      })),
    );

    const addLine = vi.fn();
    const { result } = renderHook(() => usePhotosAnalysis({ active: true, addLine, folder: '/media', intervalMs: 250 }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.selectedRoot).toBe('/media'));

    act(() => result.current.analyzePhotos());
    await waitFor(() => expect(result.current.activeJobLabel).toBe(null));

    expect(addLine).toHaveBeenCalledWith('Analysis cancelled by user', 'info');
    expect(addLine.mock.calls.some(([, level]) => level === 'error')).toBe(false);
  });

  it('confirmCancelAnalysis calls the job-cancel mutation with the running photo_process job id', async () => {
    stubTree([{ root: '/media', photos: 1, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' }]);
    stubList([photoItem({ fingerprint: 'a', currentPath: '/media/a.jpg' })]);
    stubStatus();

    let cancelledJobId: string | null = null;
    server.use(
      http.post('/api/photos/process', () => HttpResponse.json({ ok: true, data: { jobId: 'job-1' } })),
      http.get('/api/jobs/status', () => HttpResponse.json({
        ok: true,
        data: {
          jobId: 'job-1',
          kind: 'photo_process',
          status: 'running',
          progress: null,
          progressEvents: [],
          error: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      })),
      http.post('/api/jobs/cancel', async ({ request }) => {
        const body = z.object({ jobId: z.string() }).parse(await request.json());
        cancelledJobId = body.jobId;
        return HttpResponse.json({ ok: true, data: { jobId: body.jobId, cancelled: true } });
      }),
    );

    const { result } = renderHook(() => usePhotosAnalysis({ active: true, addLine: vi.fn(), folder: '/media', intervalMs: 10_000 }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.selectedRoot).toBe('/media'));

    act(() => result.current.analyzePhotos());
    await waitFor(() => expect(result.current.isCancellable).toBe(true));

    act(() => result.current.requestCancelAnalysis());
    expect(result.current.cancelConfirmation).toEqual({ open: true, isBatch: false });

    act(() => result.current.confirmCancelAnalysis());
    expect(result.current.cancelConfirmation.open).toBe(false);
    await waitFor(() => expect(cancelledJobId).toBe('job-1'));
  });

  it('surfaces an analyze job failure through the returned error, not just the terminal', async () => {
    stubTree([{ root: '/media', photos: 1, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' }]);
    stubList([photoItem({ fingerprint: 'a', currentPath: '/media/a.jpg' })]);
    stubStatus();
    server.use(
      http.post('/api/photos/process', () => HttpResponse.json({ ok: true, data: { jobId: 'job-1' } })),
      http.get('/api/jobs/status', () => HttpResponse.json({
        ok: true,
        data: {
          jobId: 'job-1',
          kind: 'photo_process',
          status: 'failed',
          progress: null,
          progressEvents: [],
          error: { code: 'processing_error', message: 'ffmpeg exploded' },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      })),
    );

    const { result } = renderHook(() => usePhotosAnalysis({ active: true, addLine: vi.fn(), folder: '/media' }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.selectedRoot).toBe('/media'));
    act(() => result.current.analyzePhotos());

    await waitFor(() => expect(result.current.error).toContain('ffmpeg exploded'));
  });

  it('surfaces a variant selection failure instead of leaving it fire-and-forget', async () => {
    const fingerprint = 'ph_0000000000000001';
    stubTree([{ root: '/media', photos: 1, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' }]);
    stubList([photoItem({ fingerprint, currentPath: '/media/a.jpg' })]);
    stubStatus();
    server.use(
      http.get('/api/photos/detail', () => HttpResponse.json({ ok: false, error: { code: 'not_found', message: 'no detail' } })),
      http.get('/api/photos/variants', () => HttpResponse.json({ ok: true, data: { variants: [] } })),
      http.post('/api/photos/variants/select', () => HttpResponse.json(
        { ok: false, error: { code: 'variant_not_found', message: 'unknown variant' } },
        { status: 404 },
      )),
    );

    const { result } = renderHook(() => usePhotosAnalysis({ active: true, addLine: vi.fn(), folder: '/media' }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.selectedRoot).toBe('/media'));
    act(() => result.current.selectFingerprint(fingerprint));
    await waitFor(() => expect(result.current.selectedFingerprint).toBe(fingerprint));

    act(() => result.current.selectVariant('cfg_000000000404'));

    await waitFor(() => expect(result.current.error).toContain('unknown variant'));
  });

  it('clears a stale variant selection error once a later selection succeeds', async () => {
    const fingerprint = 'ph_0000000000000001';
    stubTree([{ root: '/media', photos: 1, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' }]);
    stubList([photoItem({ fingerprint, currentPath: '/media/a.jpg' })]);
    stubStatus();
    let selectAttempts = 0;
    server.use(
      http.get('/api/photos/detail', () => HttpResponse.json({ ok: false, error: { code: 'not_found', message: 'no detail' } })),
      http.get('/api/photos/variants', () => HttpResponse.json({ ok: true, data: { variants: [] } })),
      http.post('/api/photos/variants/select', () => {
        selectAttempts += 1;
        if (selectAttempts === 1) {
          return HttpResponse.json(
            { ok: false, error: { code: 'variant_not_found', message: 'unknown variant' } },
            { status: 404 },
          );
        }
        return HttpResponse.json({ ok: true, data: { fingerprint, configId: null } });
      }),
    );

    const { result } = renderHook(() => usePhotosAnalysis({ active: true, addLine: vi.fn(), folder: '/media' }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.selectedRoot).toBe('/media'));
    act(() => result.current.selectFingerprint(fingerprint));
    await waitFor(() => expect(result.current.selectedFingerprint).toBe(fingerprint));

    act(() => result.current.selectVariant('cfg_000000000404'));
    await waitFor(() => expect(result.current.error).toContain('unknown variant'));

    act(() => result.current.selectVariant(null));

    await waitFor(() => expect(result.current.error).toBeNull());
  });
});
