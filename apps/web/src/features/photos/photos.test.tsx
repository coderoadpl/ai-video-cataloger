import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { photoListItemSchema, photosDetailOutputSchema, photosSearchResultSchema, photosVariantRecordSchema } from '@core/contract/index.js';

import { bridge } from '../../api.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { PhotosView } from './PhotosView.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

type PhotoListItem = z.output<typeof photoListItemSchema>;
type PhotoDetail = z.output<typeof photosDetailOutputSchema>;

const photoItem = (overrides: Partial<PhotoListItem> & { fingerprint: string }): PhotoListItem => ({
  fileName: `${overrides.fingerprint}.jpg`,
  currentPath: `/photos/${overrides.fingerprint}.jpg`,
  ext: 'jpg',
  capturedAt: '2024-03-02T10:00:00.000Z',
  capturedAtSource: 'exif_offset',
  width: 800,
  height: 600,
  proxyState: 'done',
  thumbState: 'done',
  missingAt: null,
  sightings: 1,
  thumbPath: `/artifacts/thumbs/${overrides.fingerprint}.jpg`,
  gridThumbPath: null,
  proxyPath: `/artifacts/proxies/${overrides.fingerprint}.jpg`,
  analysed: false,
  exifReadAt: null,
  ...overrides,
});

type PhotosDetailAnalysis = PhotoDetail['analysis'];

const detailFor = (item: PhotoListItem, analysis: PhotosDetailAnalysis = null): PhotoDetail => ({
  media: 'photo',
  photo: {
    fingerprint: item.fingerprint,
    folderId: 'folder-1',
    fileName: item.fileName,
    currentPath: item.currentPath,
    ext: item.ext,
    size: 1024,
    width: item.width,
    height: item.height,
    orientation: null,
    cameraMake: 'Sony',
    cameraModel: 'A7 III',
    lens: null,
    iso: 200,
    fNumber: 2.8,
    exposureTime: 0.01,
    exifRating: null,
    capturedAt: item.capturedAt,
    capturedAtSource: item.capturedAtSource,
    discoveredAt: '2024-03-02T10:00:00.000Z',
    exifReadAt: '2024-03-02T10:00:00.000Z',
    proxyState: item.proxyState,
    proxyWidth: 1280,
    proxyHeight: 960,
    thumbState: item.thumbState,
    missingAt: item.missingAt,
  },
  sightings: [{ currentPath: item.currentPath, folderId: 'folder-1', lastSeenAt: '2024-03-02T10:00:00.000Z' }],
  ownerPath: item.currentPath,
  proxyPath: item.proxyPath,
  thumbPath: item.thumbPath,
  gridThumbPath: item.gridThumbPath,
  analysis,
});

type PhotosSearchResult = z.output<typeof photosSearchResultSchema>;
type PhotoVariantRecord = z.output<typeof photosVariantRecordSchema>;

const variantsSelectBody = z.object({ fingerprint: z.string(), configId: z.string().nullable() });
const processBody = z.object({ root: z.string() });

const searchInput = (): HTMLInputElement => {
  const element = screen.getByTestId('photos-search-input');
  if (!(element instanceof HTMLInputElement)) throw new Error('missing search input');
  return element;
};

const stubPhotos = (input: {
  roots?: { root: string; photos: number; missing: number; lastScanAt: string }[];
  items?: PhotoListItem[];
  counts?: { photos: number; paths: number; proxied: number; proxyFailed: number; analysed?: number };
  analysisByFingerprint?: Record<string, PhotosDetailAnalysis>;
  searchResults?: PhotosSearchResult[];
  variants?: PhotoVariantRecord[];
  selectedConfigId?: string | null;
}) => {
  const items = input.items ?? [];
  server.use(
    http.get('/api/photos/tree', () =>
      HttpResponse.json({ ok: true, data: { media: 'photo', roots: input.roots ?? [] } })),
    http.get('/api/photos/status', () => HttpResponse.json({
      ok: true,
      data: {
        media: 'photo',
        root: null,
        counts: {
          photos: input.counts?.photos ?? items.length,
          paths: input.counts?.paths ?? items.length,
          exifRead: items.length,
          exifFailed: 0,
          missing: 0,
          duplicates: 0,
          proxied: input.counts?.proxied ?? items.length,
          proxyFailed: input.counts?.proxyFailed ?? 0,
          analysed: input.counts?.analysed ?? 0,
          facesIndexed: 0,
        },
      },
    })),
    http.get('/api/photos/list', () => HttpResponse.json({
      ok: true,
      data: { media: 'photo', root: null, total: items.length, offset: 0, items },
    })),
    http.get('/api/photos/detail', ({ request }) => {
      const fingerprint = new URL(request.url).searchParams.get('fingerprint') ?? '';
      const item = items.find((candidate) => candidate.fingerprint === fingerprint);
      if (item === undefined) return HttpResponse.json({ ok: false, error: { code: 'not_found', message: 'missing' } }, { status: 404 });
      return HttpResponse.json({ ok: true, data: detailFor(item, input.analysisByFingerprint?.[fingerprint] ?? null) });
    }),
    http.get('/api/photos/search', ({ request }) => {
      const query = new URL(request.url).searchParams.get('query') ?? '';
      const results = input.searchResults ?? [];
      return HttpResponse.json({
        ok: true,
        data: { media: 'photo', query, limit: 50, offset: 0, count: results.length, results },
      });
    }),
    http.get('/api/photos/variants', () => HttpResponse.json({
      ok: true,
      data: {
        media: 'photo',
        fingerprint: items[0]?.fingerprint ?? '',
        selectedConfigId: input.selectedConfigId ?? null,
        variants: input.variants ?? [],
      },
    })),
    http.post('/api/photos/variants/select', async ({ request }) => {
      const body = variantsSelectBody.parse(await request.json());
      return HttpResponse.json({ ok: true, data: { media: 'photo', fingerprint: body.fingerprint, configId: body.configId } });
    }),
  );
};

describe('PhotosView', () => {
  it('renders the no-roots empty state with a scan action', async () => {
    stubPhotos({ roots: [], items: [] });

    renderThemed(<PhotosView active variant="analysis" addLine={vi.fn()} />);

    expect(await screen.findByTestId('photos-empty-no-roots')).toBeDefined();
    expect(screen.getByTestId('photos-empty-scan')).toBeDefined();
  });

  it('opens the photos picker (not the video folder picker) when scanning', async () => {
    stubPhotos({ roots: [], items: [] });
    const showPicker = vi.spyOn(bridge.folder, 'showPicker').mockResolvedValue(null);

    renderThemed(<PhotosView active variant="analysis" addLine={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('photos-empty-scan'));

    await waitFor(() => expect(showPicker).toHaveBeenCalledWith('photos'));
    showPicker.mockRestore();
  });

  it('renders the grid with media://local/ thumb URLs and a duplicate badge for repeated sightings', async () => {
    const items = [photoItem({ fingerprint: 'ph_0000000000000001', sightings: 3 }), photoItem({ fingerprint: 'ph_0000000000000002' })];
    stubPhotos({ roots: [{ root: '/photos', photos: 2, missing: 0, lastScanAt: '2024-03-02T10:00:00.000Z' }], items });

    renderThemed(<PhotosView active variant="analysis" addLine={vi.fn()} />);

    const tiles = await screen.findAllByTestId('photos-tile');
    expect(tiles).toHaveLength(2);
    const image = tiles[0]?.querySelector('img');
    expect(image?.getAttribute('src')).toContain('media://local/');
    expect(screen.getByTestId('photos-duplicate-badge')).toBeDefined();
  });

  it('pages the grid past the first page instead of stopping at the first request', async () => {
    const all = Array.from({ length: 250 }, (_, index) =>
      photoItem({ fingerprint: `ph_${String(index).padStart(16, '0')}` }));
    stubPhotos({ roots: [{ root: '/photos', photos: all.length, missing: 0, lastScanAt: '2024-03-02T10:00:00.000Z' }], items: all });
    server.use(http.get('/api/photos/list', ({ request }) => {
      const params = new URL(request.url).searchParams;
      const offset = Number(params.get('offset') ?? '0');
      const limit = Number(params.get('limit') ?? '200');
      return HttpResponse.json({
        ok: true,
        data: { media: 'photo', root: null, total: all.length, offset, items: all.slice(offset, offset + limit) },
      });
    }));

    renderThemed(<PhotosView active variant="analysis" addLine={vi.fn()} />);

    const loadMore = await screen.findByTestId('photos-load-more');
    fireEvent.click(loadMore);

    await waitFor(() => expect(screen.queryByTestId('photos-load-more')).toBeNull());
  });

  it('opens the viewer on tile double-click and the detail pane shows the capture provenance', async () => {
    const items = [photoItem({ fingerprint: 'ph_0000000000000001' }), photoItem({ fingerprint: 'ph_0000000000000002' })];
    stubPhotos({ roots: [{ root: '/photos', photos: 2, missing: 0, lastScanAt: '2024-03-02T10:00:00.000Z' }], items });

    renderThemed(<PhotosView active variant="analysis" addLine={vi.fn()} />);

    const tiles = await screen.findAllByTestId('photos-tile');
    const firstTile = tiles[0];
    if (firstTile === undefined) throw new Error('missing tile');
    fireEvent.doubleClick(firstTile);

    expect(await screen.findByTestId('photos-viewer')).toBeDefined();
    expect(await screen.findByTestId('photos-detail')).toBeDefined();
    expect(screen.getByText('EXIF (UTC offset)', { exact: false })).toBeDefined();
  });

  it('opens the viewer and consumes the focus request when the focused fingerprint is in the loaded page', async () => {
    const items = [photoItem({ fingerprint: 'ph_0000000000000001' }), photoItem({ fingerprint: 'ph_0000000000000002' })];
    stubPhotos({ roots: [{ root: '/photos', photos: 2, missing: 0, lastScanAt: '2024-03-02T10:00:00.000Z' }], items });
    const onFocusConsumed = vi.fn();

    renderThemed(<PhotosView active variant="analysis" addLine={vi.fn()} focusFingerprint="ph_0000000000000002" onFocusConsumed={onFocusConsumed} />);

    expect(await screen.findByTestId('photos-viewer')).toBeDefined();
    await waitFor(() => expect(onFocusConsumed).toHaveBeenCalledTimes(1));
  });

  it('selects the detail pane without opening the viewer when the focused fingerprint is not in the loaded page', async () => {
    const items = [photoItem({ fingerprint: 'ph_0000000000000001' })];
    stubPhotos({ roots: [{ root: '/photos', photos: 1, missing: 0, lastScanAt: '2024-03-02T10:00:00.000Z' }], items });
    const onFocusConsumed = vi.fn();

    renderThemed(<PhotosView active variant="analysis" addLine={vi.fn()} focusFingerprint="ph_not_loaded" onFocusConsumed={onFocusConsumed} />);

    await waitFor(() => expect(screen.getAllByTestId('photos-tile')).toHaveLength(1));
    expect(screen.queryByTestId('photos-viewer')).toBeNull();
  });

  it('reports the honest dual counts in the status strip', async () => {
    const items = [photoItem({ fingerprint: 'ph_0000000000000001', sightings: 3 })];
    stubPhotos({
      roots: [{ root: '/photos', photos: 1, missing: 0, lastScanAt: '2024-03-02T10:00:00.000Z' }],
      items,
      counts: { photos: 1, paths: 3, proxied: 1, proxyFailed: 0 },
    });

    renderThemed(<PhotosView active variant="analysis" addLine={vi.fn()} />);

    const strip = await screen.findByTestId('photos-status-strip');
    expect(strip.textContent).toBe('1 photos · 3 paths · 1 proxied · 0 proxy failed');
  });

  it('offers the proxies action only once a root is picked, never for the all-photos scope', async () => {
    const items = [photoItem({ fingerprint: 'ph_0000000000000001', proxyState: 'pending', thumbState: 'pending' })];
    stubPhotos({
      roots: [{ root: '/photos', photos: 1, missing: 0, lastScanAt: '2024-03-02T10:00:00.000Z' }],
      items,
      counts: { photos: 1, paths: 1, proxied: 0, proxyFailed: 0 },
    });

    renderThemed(<PhotosView active variant="analysis" addLine={vi.fn()} />);

    await screen.findAllByTestId('photos-tile');
    expect(screen.queryByTestId('photos-proxies-pending')).toBeNull();
  });

  it('moves the viewer selection with the next arrow', async () => {
    const items = [photoItem({ fingerprint: 'ph_0000000000000001' }), photoItem({ fingerprint: 'ph_0000000000000002' })];
    stubPhotos({ roots: [{ root: '/photos', photos: 2, missing: 0, lastScanAt: '2024-03-02T10:00:00.000Z' }], items });

    renderThemed(<PhotosView active variant="analysis" addLine={vi.fn()} />);

    const tiles = await screen.findAllByTestId('photos-tile');
    const firstTile = tiles[0];
    if (firstTile === undefined) throw new Error('missing tile');
    fireEvent.doubleClick(firstTile);
    await screen.findByTestId('photos-viewer');

    fireEvent.click(screen.getByTestId('photos-viewer-next'));

    await waitFor(() => expect(screen.getByTestId('photos-viewer-previous')).toBeDefined());
  });

  const searchResult = (overrides: Partial<PhotosSearchResult> & { fingerprint: string }): PhotosSearchResult => ({
    fileName: `${overrides.fingerprint}.jpg`,
    currentPath: `/photos/${overrides.fingerprint}.jpg`,
    ext: 'jpg',
    capturedAt: '2024-03-02T10:00:00.000Z',
    description: 'a red bicycle',
    snippet: 'a red <mark>bicycle</mark>',
    tags: ['bicycle'],
    variantCount: 1,
    thumbState: 'done',
    proxyState: 'done',
    missingAt: null,
    thumbPath: `/artifacts/thumbs/${overrides.fingerprint}.jpg`,
    gridThumbPath: null,
    proxyPath: `/artifacts/proxies/${overrides.fingerprint}.jpg`,
    ...overrides,
  });

  it('typing a query renders result tiles from the search fake and the results label, and clearing returns to browse', async () => {
    const items = [photoItem({ fingerprint: 'ph_0000000000000001' })];
    stubPhotos({
      roots: [{ root: '/photos', photos: 1, missing: 0, lastScanAt: '2024-03-02T10:00:00.000Z' }],
      items,
      searchResults: [searchResult({ fingerprint: 'ph_0000000000000002' })],
    });

    renderThemed(<PhotosView active variant="analysis" addLine={vi.fn()} />);
    await screen.findAllByTestId('photos-tile');

    fireEvent.change(searchInput(), {
      target: { value: 'bicycle' },
    });

    await waitFor(() => expect(screen.getByText('1 result')).toBeDefined(), { timeout: 2000 });
    const tiles = await screen.findAllByTestId('photos-tile');
    expect(tiles.map((tile) => tile.getAttribute('data-fingerprint'))).toEqual(['ph_0000000000000002']);

    fireEvent.click(screen.getByTestId('photos-search-clear'));
    await waitFor(() => {
      const browseTiles = screen.getAllByTestId('photos-tile');
      expect(browseTiles.map((tile) => tile.getAttribute('data-fingerprint'))).toEqual(['ph_0000000000000001']);
    });
  });

  it('detail pane renders description/scene/quality/tag chips, and a chip click enters search mode with that tag', async () => {
    const items = [photoItem({ fingerprint: 'ph_0000000000000001' })];
    stubPhotos({
      roots: [{ root: '/photos', photos: 1, missing: 0, lastScanAt: '2024-03-02T10:00:00.000Z' }],
      items,
      analysisByFingerprint: {
        ph_0000000000000001: {
          configId: 'cfg_ab12cd34ef56',
          label: 'harness · claude-code · en',
          description: 'a red bicycle',
          scene: 'urban',
          quality: 'good',
          tags: ['bicycle', 'brick-wall'],
          batchSize: 1,
          createdAt: '2024-03-02T10:00:00.000Z',
          variantCount: 1,
          explicit: false,
        },
      },
      searchResults: [searchResult({ fingerprint: 'ph_0000000000000001', tags: ['bicycle'] })],
    });

    renderThemed(<PhotosView active variant="analysis" addLine={vi.fn()} />);
    const tiles = await screen.findAllByTestId('photos-tile');
    const firstTile = tiles[0];
    if (firstTile === undefined) throw new Error('missing tile');
    fireEvent.click(firstTile);

    await screen.findByTestId('photos-detail');
    expect(screen.getByText('a red bicycle')).toBeDefined();
    expect(screen.getByText('Urban')).toBeDefined();
    expect(screen.getByText('Good')).toBeDefined();
    const chips = screen.getAllByTestId('photo-tag-chip');
    expect(chips.map((chip) => chip.textContent)).toEqual(['bicycle', 'brick-wall']);

    const firstChip = chips[0];
    if (firstChip === undefined) throw new Error('missing tag chip');
    fireEvent.click(firstChip);
    await waitFor(() => expect(searchInput().value).toBe('bicycle'));
  });

  it('the variant picker fires the select mutation', async () => {
    const items = [photoItem({ fingerprint: 'ph_0000000000000001' })];
    stubPhotos({
      roots: [{ root: '/photos', photos: 1, missing: 0, lastScanAt: '2024-03-02T10:00:00.000Z' }],
      items,
      analysisByFingerprint: {
        ph_0000000000000001: {
          configId: 'cfg_ab12cd34ef56',
          label: 'harness · claude-code · en',
          description: 'a red bicycle',
          scene: 'urban',
          quality: 'good',
          tags: [],
          batchSize: 1,
          createdAt: '2024-03-02T10:00:00.000Z',
          variantCount: 2,
          explicit: false,
        },
      },
      variants: [
        { configId: 'cfg_ab12cd34ef56', label: 'harness · claude-code · en', description: 'a red bicycle', scene: 'urban', quality: 'good', language: 'en', analyzer: 'harness', model: 'claude-code', batchSize: 1, createdAt: '2024-03-02T10:00:00.000Z', tags: [], selected: true, explicit: false },
        { configId: 'cfg_ba21dc43fe65', label: 'harness · claude-code · pl', description: 'rower', scene: 'urban', quality: 'good', language: 'pl', analyzer: 'harness', model: 'claude-code', batchSize: 1, createdAt: '2024-03-01T10:00:00.000Z', tags: [], selected: false, explicit: false },
      ],
    });
    let selectedBody: unknown = null;
    server.use(
      http.post('/api/photos/variants/select', async ({ request }) => {
        selectedBody = await request.json();
        return HttpResponse.json({ ok: true, data: { media: 'photo', fingerprint: 'ph_0000000000000001', configId: 'cfg_ba21dc43fe65' } });
      }),
    );

    renderThemed(<PhotosView active variant="analysis" addLine={vi.fn()} />);
    const tiles = await screen.findAllByTestId('photos-tile');
    const firstTile = tiles[0];
    if (firstTile === undefined) throw new Error('missing tile');
    fireEvent.click(firstTile);
    await screen.findByTestId('photos-detail');

    const picker = await screen.findByTestId('photo-variant-picker');
    const combobox = picker.querySelector('[role="combobox"]');
    if (combobox === null) throw new Error('missing combobox element');
    fireEvent.mouseDown(combobox);
    const option = await screen.findByText('harness · claude-code · pl');
    fireEvent.click(option);

    await waitFor(() => expect(selectedBody).toEqual({ fingerprint: 'ph_0000000000000001', configId: 'cfg_ba21dc43fe65' }));
  });

  it('the Analyze action fires the process mutation', async () => {
    const items = [photoItem({ fingerprint: 'ph_0000000000000001' })];
    stubPhotos({
      roots: [{ root: '/photos', photos: 1, missing: 0, lastScanAt: '2024-03-02T10:00:00.000Z' }],
      items,
    });
    let processedRoot: string | null = null;
    server.use(
      http.post('/api/photos/process', async ({ request }) => {
        const body = processBody.parse(await request.json());
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
          createdAt: '2024-03-02T10:00:00.000Z',
          updatedAt: '2024-03-02T10:00:00.000Z',
          result: { media: 'photo', root: '/photos', force: false, configId: 'cfg_ab12cd34ef56', batchSize: 1, candidates: 1, analysed: 1, failed: 0, skippedExisting: 0 },
        },
      })),
    );

    renderThemed(<PhotosView active variant="analysis" addLine={vi.fn()} />);
    const tiles = await screen.findAllByTestId('photos-tile');
    const firstTile = tiles[0];
    if (firstTile === undefined) throw new Error('missing tile');
    fireEvent.click(firstTile);
    await screen.findByTestId('photos-detail');

    fireEvent.click(await screen.findByTestId('photos-analyze-action'));

    await waitFor(() => expect(processedRoot).toBe('/photos'));
  });

  describe('browse variant', () => {
    it('hides scan, proxies and analyze affordances, and the variant picker', async () => {
      const items = [photoItem({ fingerprint: 'ph_0000000000000001' })];
      stubPhotos({
        roots: [{ root: '/photos', photos: 1, missing: 0, lastScanAt: '2024-03-02T10:00:00.000Z' }],
        items,
        analysisByFingerprint: {
          ph_0000000000000001: {
            configId: 'cfg_ab12cd34ef56',
            label: 'harness · claude-code · en',
            description: 'a red bicycle',
            scene: 'urban',
            quality: 'good',
            tags: ['bicycle'],
            batchSize: 1,
            createdAt: '2024-03-02T10:00:00.000Z',
            variantCount: 2,
            explicit: false,
          },
        },
      });

      renderThemed(<PhotosView active variant="browse" addLine={vi.fn()} onOpenInAnalysis={vi.fn()} />);
      const tiles = await screen.findAllByTestId('photos-tile');
      const firstTile = tiles[0];
      if (firstTile === undefined) throw new Error('missing tile');
      fireEvent.click(firstTile);
      await screen.findByTestId('photos-detail');

      expect(screen.queryByTestId('photos-scan-action')).toBeNull();
      expect(screen.queryByTestId('photos-proxies-pending')).toBeNull();
      expect(screen.queryByTestId('photos-analyze-strip')).toBeNull();
      expect(screen.queryByTestId('photo-variant-picker')).toBeNull();
      expect(screen.getByText('a red bicycle')).toBeDefined();
    });

    it('shows the open-in-analysis escape hatch with an owner path, and hides it without one', async () => {
      const items = [photoItem({ fingerprint: 'ph_0000000000000001' })];
      stubPhotos({
        roots: [{ root: '/photos', photos: 1, missing: 0, lastScanAt: '2024-03-02T10:00:00.000Z' }],
        items,
      });
      const onOpenInAnalysis = vi.fn();

      renderThemed(<PhotosView active variant="browse" addLine={vi.fn()} onOpenInAnalysis={onOpenInAnalysis} />);
      const tiles = await screen.findAllByTestId('photos-tile');
      const firstTile = tiles[0];
      if (firstTile === undefined) throw new Error('missing tile');
      fireEvent.click(firstTile);

      const link = await screen.findByTestId('photos-open-analysis');
      fireEvent.click(link);
      expect(onOpenInAnalysis).toHaveBeenCalledWith('/photos', items[0]?.currentPath);
    });

    it('never shows the empty-no-roots scan action', async () => {
      stubPhotos({ roots: [], items: [] });

      renderThemed(<PhotosView active variant="browse" addLine={vi.fn()} />);

      expect(await screen.findByTestId('photos-empty-no-roots')).toBeDefined();
      expect(screen.queryByTestId('photos-empty-scan')).toBeNull();
    });
  });
});
