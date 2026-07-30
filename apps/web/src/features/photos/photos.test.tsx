import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import type { z } from 'zod';

import type { photoListItemSchema, photosDetailOutputSchema } from '@core/contract/index.js';

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
  proxyPath: `/artifacts/proxies/${overrides.fingerprint}.jpg`,
  ...overrides,
});

const detailFor = (item: PhotoListItem): PhotoDetail => ({
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
});

const stubPhotos = (input: {
  roots?: { root: string; photos: number; missing: number; lastScanAt: string }[];
  items?: PhotoListItem[];
  counts?: { photos: number; paths: number; proxied: number; proxyFailed: number };
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
      return HttpResponse.json({ ok: true, data: detailFor(item) });
    }),
  );
};

describe('PhotosView', () => {
  it('renders the no-roots empty state with a scan action', async () => {
    stubPhotos({ roots: [], items: [] });

    renderThemed(<PhotosView active addLine={vi.fn()} />);

    expect(await screen.findByTestId('photos-empty-no-roots')).toBeDefined();
    expect(screen.getByTestId('photos-empty-scan')).toBeDefined();
  });

  it('opens the photos picker (not the video folder picker) when scanning', async () => {
    stubPhotos({ roots: [], items: [] });
    const showPicker = vi.spyOn(bridge.folder, 'showPicker').mockResolvedValue(null);

    renderThemed(<PhotosView active addLine={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('photos-empty-scan'));

    await waitFor(() => expect(showPicker).toHaveBeenCalledWith('photos'));
    showPicker.mockRestore();
  });

  it('renders the grid with media://local/ thumb URLs and a duplicate badge for repeated sightings', async () => {
    const items = [photoItem({ fingerprint: 'ph_0000000000000001', sightings: 3 }), photoItem({ fingerprint: 'ph_0000000000000002' })];
    stubPhotos({ roots: [{ root: '/photos', photos: 2, missing: 0, lastScanAt: '2024-03-02T10:00:00.000Z' }], items });

    renderThemed(<PhotosView active addLine={vi.fn()} />);

    const tiles = await screen.findAllByTestId('photos-tile');
    expect(tiles).toHaveLength(2);
    const image = tiles[0]?.querySelector('img');
    expect(image?.getAttribute('src')).toContain('media://local/');
    expect(screen.getByTestId('photos-duplicate-badge')).toBeDefined();
  });

  it('opens the viewer on tile double-click and the detail pane shows the capture provenance', async () => {
    const items = [photoItem({ fingerprint: 'ph_0000000000000001' }), photoItem({ fingerprint: 'ph_0000000000000002' })];
    stubPhotos({ roots: [{ root: '/photos', photos: 2, missing: 0, lastScanAt: '2024-03-02T10:00:00.000Z' }], items });

    renderThemed(<PhotosView active addLine={vi.fn()} />);

    const tiles = await screen.findAllByTestId('photos-tile');
    const firstTile = tiles[0];
    if (firstTile === undefined) throw new Error('missing tile');
    fireEvent.doubleClick(firstTile);

    expect(await screen.findByTestId('photos-viewer')).toBeDefined();
    expect(await screen.findByTestId('photos-detail')).toBeDefined();
    expect(screen.getByText('EXIF (UTC offset)', { exact: false })).toBeDefined();
  });

  it('reports the honest dual counts in the status strip', async () => {
    const items = [photoItem({ fingerprint: 'ph_0000000000000001', sightings: 3 })];
    stubPhotos({
      roots: [{ root: '/photos', photos: 1, missing: 0, lastScanAt: '2024-03-02T10:00:00.000Z' }],
      items,
      counts: { photos: 1, paths: 3, proxied: 1, proxyFailed: 0 },
    });

    renderThemed(<PhotosView active addLine={vi.fn()} />);

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

    renderThemed(<PhotosView active addLine={vi.fn()} />);

    await screen.findAllByTestId('photos-tile');
    expect(screen.queryByTestId('photos-proxies-pending')).toBeNull();
  });

  it('moves the viewer selection with the next arrow', async () => {
    const items = [photoItem({ fingerprint: 'ph_0000000000000001' }), photoItem({ fingerprint: 'ph_0000000000000002' })];
    stubPhotos({ roots: [{ root: '/photos', photos: 2, missing: 0, lastScanAt: '2024-03-02T10:00:00.000Z' }], items });

    renderThemed(<PhotosView active addLine={vi.fn()} />);

    const tiles = await screen.findAllByTestId('photos-tile');
    const firstTile = tiles[0];
    if (firstTile === undefined) throw new Error('missing tile');
    fireEvent.doubleClick(firstTile);
    await screen.findByTestId('photos-viewer');

    fireEvent.click(screen.getByTestId('photos-viewer-next'));

    await waitFor(() => expect(screen.getByTestId('photos-viewer-previous')).toBeDefined());
  });
});
