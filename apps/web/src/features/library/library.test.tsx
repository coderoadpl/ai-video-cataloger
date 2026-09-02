import { type ReactElement } from 'react';
import { hexToRgb, ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { z } from 'zod';

import type { libraryFacetsOutputSchema } from '@core/contract/index.js';

import { bridge } from '../../api.js';
import { en } from '../../i18n/dictionary.js';
import { configResponse } from '../../test/config-response.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { LibraryView } from './LibraryView.js';
import { PersonMediaPanel } from './PersonMediaPanel.js';
import type { LibraryItem, LibraryPhotoItem, LibraryVideoItem } from './core/index.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

const videoItem = (overrides: Partial<LibraryVideoItem> & { fingerprint: string }): LibraryVideoItem => ({
  media: 'video',
  variantCount: 1,
  fileName: `${overrides.fingerprint}.mp4`,
  finalName: null,
  description: null,
  snippet: '',
  thumbnailPath: `/videos/.ai-video-cataloger/thumbnails/${overrides.fingerprint}.jpg`,
  gridThumbnailPath: null,
  tags: [],
  folder: {
    folderId: '11111111-1111-4111-8111-111111111111',
    currentPath: '/videos',
    displayName: 'videos',
    online: true,
    offlineReason: null,
  },
  gps: null,
  missing: false,
  capturedAt: '2026-01-02T10:00:00.000Z',
  place: null,
  width: null,
  height: null,
  ...overrides,
});

const photoItem = (overrides: Partial<LibraryPhotoItem> & { fingerprint: string }): LibraryPhotoItem => ({
  media: 'photo',
  fileName: `${overrides.fingerprint}.jpg`,
  currentPath: `/photos/${overrides.fingerprint}.jpg`,
  ext: 'jpg',
  capturedAt: '2026-01-02T10:00:00.000Z',
  description: null,
  snippet: '',
  tags: [],
  variantCount: 0,
  missingAt: null,
  thumbPath: `/photos/.ai-video-cataloger/thumbnails/${overrides.fingerprint}.jpg`,
  gridThumbPath: null,
  proxyPath: null,
  ...overrides,
});

const displayNameOf = (item: LibraryItem): string => item.media === 'video' ? (item.finalName ?? item.fileName) : item.fileName;

const matchesQuery = (item: LibraryItem, query: string): boolean =>
  displayNameOf(item).includes(query) || item.tags.some((tag) => tag.includes(query));

const collectionRequests: URLSearchParams[] = [];

const CURSOR_LIMIT_DEFAULT = 200;

const stubCollection = (items: LibraryItem[]) => {
  server.use(
    http.get('/api/library/collection', ({ request }) => {
      const url = new URL(request.url);
      collectionRequests.push(url.searchParams);
      const query = url.searchParams.get('query');
      const people = url.searchParams.get('people');
      const place = url.searchParams.get('place');
      const hasGps = url.searchParams.get('hasGps');
      const folderId = url.searchParams.get('folderId');
      const media = url.searchParams.get('media') ?? 'all';
      const sort = url.searchParams.get('sort');
      const limit = Number(url.searchParams.get('limit') ?? String(CURSOR_LIMIT_DEFAULT));
      const cursor = url.searchParams.get('cursor');
      const hideUnavailable = url.searchParams.get('hideUnavailable') === 'true';
      const offset = cursor === null ? 0 : Number(cursor);

      const videoOnlyFilterActive = (people !== null && people.length > 0) || place !== null || hasGps !== null;

      let matchedVideo = items.filter((item) => item.media === 'video');
      let matchedPhoto = videoOnlyFilterActive ? [] : items.filter((item) => item.media === 'photo');

      if (query !== null && query.length > 0) {
        matchedVideo = matchedVideo.filter((item) => matchesQuery(item, query));
        matchedPhoto = matchedPhoto.filter((item) => matchesQuery(item, query));
      }
      if (hasGps === 'true') matchedVideo = matchedVideo.filter((item) => item.media === 'video' && item.gps !== null);
      if (hasGps === 'false') matchedVideo = matchedVideo.filter((item) => item.media === 'video' && item.gps === null);
      if (folderId !== null && folderId.length > 0) {
        const folderPath = items.find(
          (item): item is LibraryVideoItem => item.media === 'video' && item.folder.folderId === folderId,
        )?.folder.currentPath;
        matchedVideo = matchedVideo.filter((item) => item.media === 'video' && item.folder.folderId === folderId);
        matchedPhoto = folderPath === undefined
          ? []
          : matchedPhoto.filter((item) => item.media === 'photo' && item.currentPath.startsWith(`${folderPath}/`));
      }
      if (hideUnavailable) {
        matchedVideo = matchedVideo.filter((item) => item.media === 'video' && item.folder.online && !item.missing);
        matchedPhoto = matchedPhoto.filter((item) => item.media === 'photo' && item.missingAt === null);
      }
      const mediaTotals = {
        all: matchedVideo.length + matchedPhoto.length,
        video: matchedVideo.length,
        photo: matchedPhoto.length,
      };
      if (media === 'video') matchedPhoto = [];
      if (media === 'photo') matchedVideo = [];

      const combined = [...matchedVideo, ...matchedPhoto].sort((left, right) => {
        if (sort === 'name_asc') return displayNameOf(left).localeCompare(displayNameOf(right));
        if (sort === 'captured_asc') return (left.capturedAt ?? '').localeCompare(right.capturedAt ?? '');
        if (sort === 'relevance') return 0;
        return (right.capturedAt ?? '').localeCompare(left.capturedAt ?? '');
      });

      const page = combined.slice(offset, offset + limit);
      const nextOffset = offset + page.length;
      const nextCursor = nextOffset < combined.length ? String(nextOffset) : null;

      return HttpResponse.json({
        ok: true,
        data: {
          query,
          media,
          limit,
          total: matchedVideo.length + matchedPhoto.length,
          videoTotal: matchedVideo.length,
          photoTotal: matchedPhoto.length,
          mediaTotals,
          count: page.length,
          items: page,
          nextCursor,
        },
      });
    }),
  );
};

const RECENT_SEARCHES_KEY = 'ai-video-cataloger.recent-searches';

const stubTags = (tags: { name: string; count: number }[]) => {
  server.use(http.get('/api/tags', () => HttpResponse.json({ ok: true, data: { tags } })));
};

const stubFacets = (overrides: Partial<z.infer<typeof libraryFacetsOutputSchema>> = {}) => {
  server.use(
    http.get('/api/library/facets', () => HttpResponse.json({
      ok: true,
      data: {
        tags: [],
        people: [],
        places: [],
        years: [],
        folders: [],
        counts: { total: 0, withGps: 0, withoutCaptureDate: 0, missing: 0, offlineFolders: 0 },
        ...overrides,
      },
    })),
  );
};

const stubPhotoRoots = (roots: { root: string; photos: number; missing: number; lastScanAt: string }[] = []) => {
  server.use(http.get('/api/photos/tree', () => HttpResponse.json({ ok: true, data: { media: 'photo', roots } })));
};

const stubPhotoDetail = (fingerprint: string) => {
  server.use(http.get('/api/photos/detail', () => HttpResponse.json({
    ok: true,
    data: {
      media: 'photo',
      photo: {
        fingerprint,
        folderId: 'path-aaaaaaaa',
        fileName: `${fingerprint}.jpg`,
        currentPath: `/photos/${fingerprint}.jpg`,
        ext: 'jpg',
        size: 1024,
        width: 1920,
        height: 1080,
        orientation: 1,
        cameraMake: null,
        cameraModel: null,
        lens: null,
        iso: null,
        fNumber: null,
        exposureTime: null,
        exifRating: null,
        capturedAt: '2026-01-02T10:00:00.000Z',
        capturedAtSource: 'file_mtime',
        discoveredAt: '2026-01-02T10:00:00.000Z',
        exifReadAt: null,
        proxyState: 'done',
        proxyWidth: 1920,
        proxyHeight: 1080,
        thumbState: 'done',
        missingAt: null,
      },
      sightings: [{ currentPath: `/photos/${fingerprint}.jpg`, folderId: 'path-aaaaaaaa', lastSeenAt: '2026-01-02T10:00:00.000Z' }],
      ownerPath: `/photos/${fingerprint}.jpg`,
      proxyPath: `/photo-artifacts/proxies/${fingerprint}.jpg`,
      thumbPath: `/photo-artifacts/thumbs/${fingerprint}.jpg`,
      gridThumbPath: null,
      analysis: {
        configId: 'cfg_0123456789ab',
        label: 'local · gemma3:4b · auto',
        description: 'Sunset over a quiet lake',
        scene: 'landscape',
        quality: 'good',
        tags: ['sunset', 'lake'],
        batchSize: 1,
        createdAt: '2026-01-03T12:00:00.000Z',
        variantCount: 1,
        explicit: false,
      },
    },
  })));
};

const stubLibraryPreview = (
  overrides: {
    transcript?: string | null;
    analysis?: { label: string; createdAt: string } | null;
    people?: { personId: string; displayName: string | null }[];
  } = {},
) => {
  server.use(http.get('/api/library/preview', ({ request }) => {
    const fingerprint = new URL(request.url).searchParams.get('fingerprint') ?? 'fp-1';
    return HttpResponse.json({
      ok: true,
      data: {
        fingerprint,
        path: `/videos/${fingerprint}.mp4`,
        fileName: `${fingerprint}.mp4`,
        size: 2048,
        sizeFormatted: '2.0 KB',
        durationS: 65,
        durationFormatted: '1:05',
        transcript: overrides.transcript ?? null,
        transcriptSegments: null,
        width: 1920,
        height: 1080,
        rotation: null,
        people: overrides.people ?? [],
        analysis: overrides.analysis ?? null,
      },
    });
  }));
};

describe('LibraryView', () => {
  beforeEach(() => {
    collectionRequests.length = 0;
    window.localStorage.removeItem(RECENT_SEARCHES_KEY);
    window.localStorage.removeItem('avc.library.media');
    window.localStorage.removeItem('avc.library.groupBy');
    stubFacets();
    stubPhotoRoots();
  });

  it('renders the honest empty-catalog state, not a generic no-results message', async () => {
    stubCollection([]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);

    expect(await screen.findByTestId('library-empty-catalog')).toBeDefined();
    expect(screen.queryByTestId('library-no-match')).toBeNull();
  });

  it('mentions both videos and photos in the empty-catalog copy', async () => {
    stubCollection([]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);

    const body = await screen.findByText(en.library.emptyCatalogBody);
    expect(body.textContent?.toLowerCase()).toContain('video');
    expect(body.textContent?.toLowerCase()).toContain('photo');
  });

  it('routes the empty-catalog action to the Videos view', async () => {
    stubCollection([]);
    const onGoToVideos = vi.fn();

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={onGoToVideos} />);
    fireEvent.click(await screen.findByTestId('library-empty-go-videos'));

    expect(onGoToVideos).toHaveBeenCalledOnce();
  });

  it('renders tiles grouped by capture day with the file count header', async () => {
    const items = [
      videoItem({ fingerprint: 'fp-1', capturedAt: '2026-01-02T10:00:00.000Z' }),
      videoItem({ fingerprint: 'fp-2', capturedAt: '2026-01-02T08:00:00.000Z' }),
    ];
    stubCollection(items);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);

    const tiles = await screen.findAllByTestId('library-tile');
    expect(tiles).toHaveLength(2);
    expect(await screen.findByText('2 files')).toBeDefined();
  });

  it('renders the capture-day section header in the UI language, never the raw ISO group key', async () => {
    stubCollection([videoItem({ fingerprint: 'fp-1', capturedAt: '2026-01-02T10:00:00.000Z' })]);
    server.use(http.get('/api/config', () => HttpResponse.json(configResponse('pl'))));

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('library-section-header').textContent).toBe('2 stycznia 2026');
    });
  });

  it('opens the shared media viewer for an online video tile, not the analysis workspace', async () => {
    stubCollection([videoItem({ fingerprint: 'fp-open' })]);
    stubLibraryPreview();
    const onOpenResult = vi.fn();

    renderThemed(<LibraryView active onOpenResult={onOpenResult} onGoToVideos={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('library-tile'));

    const viewer = await screen.findByTestId('library-media-viewer');
    expect(viewer.getAttribute('data-media')).toBe('video');
    expect(viewer.getAttribute('data-fingerprint')).toBe('fp-open');
    expect(screen.getByTestId('library-media-viewer-player')).toBeDefined();
    expect(onOpenResult).not.toHaveBeenCalled();
  });

  it('opens the shared media viewer for an offline-folder tile and states why the video cannot play', async () => {
    stubCollection([videoItem({ fingerprint: 'fp-offline', folder: { folderId: '22222222-2222-4222-8222-222222222222', currentPath: '/Volumes/Ghost', displayName: 'offline', online: false, offlineReason: 'drive-disconnected' } })]);
    stubLibraryPreview();

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('library-tile'));

    expect(screen.getByTestId('library-offline-badge').textContent).toBe(en.library.offlineFolderBadge);
    expect((await screen.findByTestId('library-media-viewer')).getAttribute('data-fingerprint')).toBe('fp-offline');
    expect(screen.getByTestId('library-media-viewer-unavailable').textContent).toBe(en.preview.offline);
    expect(screen.queryByTestId('library-media-viewer-player')).toBeNull();
  });

  it('hides offline-folder tiles behind the hide-unavailable toggle, restores them when it is switched back, and remembers the choice', async () => {
    stubCollection([
      videoItem({ fingerprint: 'fp-here' }),
      videoItem({
        fingerprint: 'fp-unplugged',
        folder: { folderId: '22222222-2222-4222-8222-222222222222', currentPath: '/Volumes/Ghost', displayName: 'offline', online: false, offlineReason: 'drive-disconnected' },
      }),
    ]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    await waitFor(() => { expect(screen.getAllByTestId('library-tile')).toHaveLength(2); });

    const toggle = screen.getByTestId('library-hide-unavailable');
    expect(toggle.textContent).toBe(en.library.hideUnavailable);
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getAllByTestId('library-tile').map((tile) => tile.getAttribute('data-fingerprint'))).toEqual(['fp-here']);
    });
    expect(window.localStorage.getItem('avc.library.hideUnavailable')).toBe('true');

    fireEvent.click(screen.getByTestId('library-hide-unavailable'));

    await waitFor(() => { expect(screen.getAllByTestId('library-tile')).toHaveLength(2); });
    expect(window.localStorage.getItem('avc.library.hideUnavailable')).toBe('false');
  });

  it('offers the no-match state, not the empty-catalog pitch, when hide-unavailable empties a catalog of offline items', async () => {
    stubCollection([
      videoItem({
        fingerprint: 'fp-unplugged',
        folder: { folderId: '22222222-2222-4222-8222-222222222222', currentPath: '/Volumes/Ghost', displayName: 'offline', online: false, offlineReason: 'drive-disconnected' },
      }),
    ]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findByTestId('library-tile');
    fireEvent.click(screen.getByTestId('library-hide-unavailable'));

    await screen.findByTestId('library-no-match');
    expect(screen.queryByTestId('library-empty-catalog')).toBeNull();

    fireEvent.click(screen.getByTestId('library-no-match-clear'));

    await waitFor(() => { expect(screen.getAllByTestId('library-tile')).toHaveLength(1); });
    expect(window.localStorage.getItem('avc.library.hideUnavailable')).toBe('false');
  });

  it('shows the file-missing badge for a folder deleted on a still-mounted volume, not a drive-disconnected badge', async () => {
    const items = [videoItem({ fingerprint: 'fp-deleted-folder', folder: { folderId: '22222222-2222-4222-8222-222222222222', currentPath: '/videos/deleted', displayName: 'deleted', online: false, offlineReason: 'file-missing' } })];
    stubCollection(items);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findByTestId('library-tile');

    expect(screen.getByTestId('library-offline-badge').textContent).toBe(en.library.missingBadge);
  });

  it('shows exactly one missing-file label when the folder is offline and the file is also flagged missing', async () => {
    const items = [videoItem({
      fingerprint: 'fp-offline-missing',
      thumbnailPath: null,
      gridThumbnailPath: null,
      missing: true,
      folder: { folderId: '22222222-2222-4222-8222-222222222222', currentPath: '/videos/deleted', displayName: 'deleted', online: false, offlineReason: 'file-missing' },
    })];
    stubCollection(items);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findByTestId('library-tile');

    expect(screen.queryByTestId('library-missing-badge')).toBeNull();
    expect(screen.getAllByText(en.library.missingBadge)).toHaveLength(1);
  });

  it('renders every unavailable tile at the same opacity as a plain offline-folder tile', async () => {
    const items = [
      videoItem({
        fingerprint: 'fp-offline-only',
        thumbnailPath: null,
        gridThumbnailPath: null,
        missing: false,
        folder: { folderId: '22222222-2222-4222-8222-222222222222', currentPath: '/videos/deleted', displayName: 'deleted', online: false, offlineReason: 'file-missing' },
      }),
      videoItem({
        fingerprint: 'fp-offline-and-missing',
        thumbnailPath: null,
        gridThumbnailPath: null,
        missing: true,
        folder: { folderId: '22222222-2222-4222-8222-222222222222', currentPath: '/videos/deleted', displayName: 'deleted', online: false, offlineReason: 'file-missing' },
      }),
    ];
    stubCollection(items);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findAllByTestId('library-tile');

    const offlineOnly = document.querySelector('[data-testid="library-tile"][data-fingerprint="fp-offline-only"]');
    const offlineAndMissing = document.querySelector(
      '[data-testid="library-tile"][data-fingerprint="fp-offline-and-missing"]',
    );
    if (offlineOnly === null || offlineAndMissing === null) throw new Error('expected both tiles to render');

    expect(getComputedStyle(offlineAndMissing).opacity).toBe(getComputedStyle(offlineOnly).opacity);
  });

  it('keeps the per-file missing badge when the folder is online but the file alone is missing', async () => {
    const items = [videoItem({
      fingerprint: 'fp-online-missing',
      thumbnailPath: '/videos/.ai-video-cataloger/thumbnails/fp-online-missing.jpg',
      missing: true,
      folder: { folderId: '11111111-1111-4111-8111-111111111111', currentPath: '/videos', displayName: 'videos', online: true, offlineReason: null },
    })];
    stubCollection(items);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findByTestId('library-tile');

    expect(screen.getByTestId('library-missing-badge').textContent).toBe(en.library.missingBadge);
  });

  it('shows the portrait aspect-ratio indicator for a tile whose stored dimensions are taller than wide', async () => {
    const items = [videoItem({ fingerprint: 'fp-portrait', width: 1080, height: 1920 })];
    stubCollection(items);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findByTestId('library-tile');

    expect(screen.getByTestId('library-aspect-indicator')).toBeDefined();
  });

  it('shows the panorama aspect-ratio indicator for an extreme-wide tile', async () => {
    const items = [videoItem({ fingerprint: 'fp-panorama', width: 3000, height: 1000 })];
    stubCollection(items);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findByTestId('library-tile');

    expect(screen.getByTestId('library-aspect-indicator')).toBeDefined();
  });

  it('shows no aspect-ratio indicator for a plain landscape tile', async () => {
    const items = [videoItem({ fingerprint: 'fp-landscape', width: 1920, height: 1080 })];
    stubCollection(items);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findByTestId('library-tile');

    expect(screen.queryByTestId('library-aspect-indicator')).toBeNull();
  });

  it('shows no aspect-ratio indicator when dimensions are unknown', async () => {
    const items = [videoItem({ fingerprint: 'fp-unknown-dims', width: null, height: null })];
    stubCollection(items);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findByTestId('library-tile');

    expect(screen.queryByTestId('library-aspect-indicator')).toBeNull();
  });

  it('tiles request the 512px grid thumbnail when it exists, small thumb only as fallback', async () => {
    const items = [
      videoItem({
        fingerprint: 'fp-grid',
        thumbnailPath: '/videos/.ai-video-cataloger/thumbnails/a.jpg',
        gridThumbnailPath: '/videos/.ai-video-cataloger/thumbnails/a.grid.jpg',
      }),
      videoItem({
        fingerprint: 'fp-small',
        thumbnailPath: '/videos/.ai-video-cataloger/thumbnails/b.jpg',
        gridThumbnailPath: null,
      }),
    ];
    stubCollection(items);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);

    const tiles = await screen.findAllByTestId('library-tile');
    expect(tiles).toHaveLength(2);
    const gridTile = tiles.find((tile) => tile.getAttribute('data-fingerprint') === 'fp-grid');
    const smallTile = tiles.find((tile) => tile.getAttribute('data-fingerprint') === 'fp-small');
    const gridImg = gridTile?.querySelector('img');
    const smallImg = smallTile?.querySelector('img');
    expect(gridImg?.getAttribute('src')).toContain('a.grid.jpg');
    expect(gridImg?.getAttribute('src')).not.toContain('a.jpg?');
    expect(smallImg?.getAttribute('src')).toContain('b.jpg');
    expect(gridImg === undefined || gridImg === null ? null : window.getComputedStyle(gridImg).objectFit).toBe('cover');
    expect(smallImg === undefined || smallImg === null ? null : window.getComputedStyle(smallImg).objectFit).toBe('contain');
  });

  it('renders a square gradient placeholder tile with the file name when no thumbnail exists', async () => {
    const items = [videoItem({ fingerprint: 'fp-none', thumbnailPath: null, gridThumbnailPath: null, fileName: 'clip.mp4' })];
    stubCollection(items);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);

    const placeholder = await screen.findByTestId('library-tile-placeholder');
    expect(placeholder.getAttribute('style')).toContain('linear-gradient');
    const tile = await screen.findByTestId('library-tile');
    expect(tile.getBoundingClientRect).toBeDefined();
    const label = screen.getByText('clip.mp4');
    expect(label).toBeDefined();
    expect(getComputedStyle(label).color).toBe(hexToRgb(theme.palette.text.primary));
  });

  it('the tile menu opens the video in Analysis, with no folder-view item', async () => {
    const items = [videoItem({ fingerprint: 'fp-menu' })];
    stubCollection(items);
    const onOpenResult = vi.fn();

    renderThemed(<LibraryView active onOpenResult={onOpenResult} onGoToVideos={vi.fn()} />);
    fireEvent.contextMenu(await screen.findByTestId('library-tile'));

    expect(screen.queryByTestId('library-tile-menu-open-folder')).toBeNull();
    fireEvent.click(await screen.findByTestId('library-tile-menu-open-analysis'));

    expect(onOpenResult).toHaveBeenCalledWith('/videos', '/videos/fp-menu.mp4');
  });

  it('shows an error toast when revealing a library tile fails, instead of doing nothing', async () => {
    const items = [videoItem({ fingerprint: 'fp-reveal' })];
    stubCollection(items);
    const reveal = vi.spyOn(bridge, 'revealInFinder').mockResolvedValue(false);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    fireEvent.contextMenu(await screen.findByTestId('library-tile'));
    fireEvent.click(await screen.findByTestId('library-tile-menu-reveal'));

    await screen.findByTestId('library-tile-menu-reveal-failed-toast');
    reveal.mockRestore();
  });

  it('confirms a successful copy-path and surfaces a rejected clipboard write instead of failing silently', async () => {
    const items = [videoItem({ fingerprint: 'fp-copy' })];
    stubCollection(items);
    const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    fireEvent.contextMenu(await screen.findByTestId('library-tile'));
    fireEvent.click(await screen.findByTestId('library-tile-menu-copy-path'));

    await screen.findByTestId('library-tile-menu-copy-failed-toast');

    fireEvent.contextMenu(await screen.findByTestId('library-tile'));
    fireEvent.click(await screen.findByTestId('library-tile-menu-copy-path'));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
  });

  it('surfaces a failed catalog read instead of claiming nothing has been processed', async () => {
    server.use(http.get('/api/library/collection', () => HttpResponse.json({ ok: false, error: { code: 'read_error', message: 'catalog is locked' } }, { status: 500 })));

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);

    expect(await screen.findByTestId('library-error')).toBeDefined();
    expect(screen.queryByTestId('library-empty-catalog')).toBeNull();
  });

  it('never leaks an absolute filesystem path from a failed catalog read into the error strip', async () => {
    server.use(http.get('/api/library/collection', () => HttpResponse.json(
      { ok: false, error: { code: 'read_error', message: 'Command failed: /var/folders/s4/xw5m39vj0bvd7z1v0pcs5ssr0000gn/T/cmux-cli-shims/8DC7FBD3-E6C8-42C3-B012-BECEA9CC11AD/claude' } },
      { status: 500 },
    )));

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);

    expect((await screen.findByTestId('library-error')).textContent).toBe(en.errors.analyzerFailed);
    expect(document.body.textContent).not.toContain('/var/folders');
  });

  it('renders the no-match state, distinct from the empty-catalog state, once a query eliminates everything', async () => {
    stubCollection([videoItem({ fingerprint: 'fp-1' })]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findAllByTestId('library-tile');

    fireEvent.change(screen.getByTestId('library-search-input').querySelector('input') ?? screen.getByTestId('library-search-input'), {
      target: { value: 'no-such-file' },
    });

    await waitFor(() => expect(screen.getByTestId('library-no-match')).toBeDefined());
    expect(screen.queryByTestId('library-empty-catalog')).toBeNull();
  });

  it('names the active chip in the no-match copy', async () => {
    stubCollection([videoItem({ fingerprint: 'fp-1', gps: { lat: 1, lon: 2 } })]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findAllByTestId('library-tile');

    const gpsSelect = screen.getByTestId('library-filter-has-gps').querySelector('input');
    fireEvent.change(gpsSelect ?? screen.getByTestId('library-filter-has-gps'), { target: { value: 'without' } });

    await waitFor(() => expect(screen.getByTestId('library-no-match')).toBeDefined());
    expect(screen.getByTestId('library-no-match-body').textContent).toContain('Without GPS');
  });

  it('a hasGps chip narrows the search request', async () => {
    stubCollection([
      videoItem({ fingerprint: 'fp-gps', gps: { lat: 1, lon: 2 } }),
      videoItem({ fingerprint: 'fp-no-gps' }),
    ]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    expect(await screen.findAllByTestId('library-tile')).toHaveLength(2);

    const gpsSelect = screen.getByTestId('library-filter-has-gps').querySelector('input');
    fireEvent.change(gpsSelect ?? screen.getByTestId('library-filter-has-gps'), { target: { value: 'with' } });

    await waitFor(async () => expect(await screen.findAllByTestId('library-tile')).toHaveLength(1));
    expect(screen.getByTestId('library-chip-hasGps')).toBeDefined();
  });

  it('picking a folder facet option filters results and shows a removable chip with the facet count', async () => {
    const items = [
      videoItem({ fingerprint: 'fp-1' }),
      videoItem({
        fingerprint: 'fp-target',
        folder: { folderId: '99999999-9999-4999-8999-999999999999', currentPath: '/other', displayName: 'Other Folder', online: true, offlineReason: null },
      }),
    ];
    stubCollection(items);
    stubFacets({
      folders: [
        { folderId: '11111111-1111-4111-8111-111111111111', displayName: 'videos', currentPath: '/videos', online: true, count: 1 },
        { folderId: '99999999-9999-4999-8999-999999999999', displayName: 'Other Folder', currentPath: '/other', online: true, count: 1 },
      ],
    });

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    expect(await screen.findAllByTestId('library-tile')).toHaveLength(2);

    const folderInput = screen.getByTestId('library-filter-folder').querySelector('input');
    if (folderInput === null) throw new Error('missing folder filter input');
    fireEvent.mouseDown(folderInput);
    fireEvent.click(await screen.findByText('Other Folder (1)'));

    expect(await screen.findByTestId('library-chip-folder:99999999-9999-4999-8999-999999999999')).toBeDefined();
    expect(screen.getByText('Folder: Other Folder')).toBeDefined();
    await waitFor(async () => expect(await screen.findAllByTestId('library-tile')).toHaveLength(1));

    fireEvent.click(screen.getByTestId('library-chip-folder:99999999-9999-4999-8999-999999999999').querySelector('svg') ?? screen.getByTestId('library-chip-folder:99999999-9999-4999-8999-999999999999'));
    await waitFor(() => expect(screen.queryByTestId('library-chip-folder:99999999-9999-4999-8999-999999999999')).toBeNull());
  });

  it('combines the folder facet with a text query in the same search request', async () => {
    stubCollection([videoItem({ fingerprint: 'fp-1' })]);
    stubFacets({
      folders: [{ folderId: '11111111-1111-4111-8111-111111111111', displayName: 'videos', currentPath: '/videos', online: true, count: 1 }],
    });

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findAllByTestId('library-tile');

    const folderInput = screen.getByTestId('library-filter-folder').querySelector('input');
    if (folderInput === null) throw new Error('missing folder filter input');
    fireEvent.mouseDown(folderInput);
    fireEvent.click(await screen.findByText('videos (1)'));

    const searchInput = screen.getByTestId('library-search-input').querySelector('input');
    if (searchInput === null) throw new Error('missing search input');
    fireEvent.change(searchInput, { target: { value: 'fp-1' } });

    await waitFor(() => {
      const latest = collectionRequests[collectionRequests.length - 1];
      expect(latest?.get('folderId')).toBe('11111111-1111-4111-8111-111111111111');
      expect(latest?.get('query')).toBe('fp-1');
    });
  });

  it('keeps the chosen sort while a text query is active instead of silently falling back to relevance', async () => {
    stubCollection([videoItem({ fingerprint: 'fp-1' })]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findAllByTestId('library-tile');

    const sortSelect = screen.getByTestId('library-sort').querySelector('input');
    fireEvent.change(sortSelect ?? screen.getByTestId('library-sort'), { target: { value: 'name_asc' } });
    fireEvent.change(screen.getByTestId('library-search-input').querySelector('input') ?? screen.getByTestId('library-search-input'), { target: { value: 'fp' } });

    await waitFor(() => {
      const latest = collectionRequests[collectionRequests.length - 1];
      expect(latest?.get('query')).toBe('fp');
      expect(latest?.get('sort')).toBe('name_asc');
    });
  });

  it('offers facet options with their whole-catalog counts', async () => {
    stubFacets({ tags: [{ name: 'beach', count: 4 }, { name: 'sunset', count: 2 }] });
    stubCollection([videoItem({ fingerprint: 'fp-1' })]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findAllByTestId('library-tile');

    const tagInput = screen.getByTestId('library-filter-tags').querySelector('input');
    fireEvent.change(tagInput ?? screen.getByTestId('library-filter-tags'), { target: { value: 'bea' } });

    expect(await screen.findByText('beach (4)')).toBeDefined();
  });

  it('reads unnamed people by their People-surface number, never a raw person id', async () => {
    stubFacets({ people: [{ personId: 'person-abc123', displayName: null, count: 3, fallbackIndex: 6 }] });
    stubCollection([videoItem({ fingerprint: 'fp-1' })]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findAllByTestId('library-tile');

    const peopleInput = screen.getByTestId('library-filter-people').querySelector('input');
    fireEvent.change(peopleInput ?? screen.getByTestId('library-filter-people'), { target: { value: 'Person' } });

    expect(await screen.findByText('Person 7 (3)')).toBeDefined();
    expect(screen.queryByText(/person-abc123/)).toBeNull();
  });

  it('debounces the free-text place filter into a single search request', async () => {
    stubCollection([videoItem({ fingerprint: 'fp-1' })]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findAllByTestId('library-tile');

    const placeInput = screen.getByTestId('library-filter-place').querySelector('input');
    const target = placeInput ?? screen.getByTestId('library-filter-place');
    fireEvent.change(target, { target: { value: 'W' } });
    fireEvent.change(target, { target: { value: 'Wr' } });
    fireEvent.change(target, { target: { value: 'Wro' } });

    await waitFor(() => expect(collectionRequests.filter((params) => params.get('place') !== null)).toHaveLength(1));
    expect(collectionRequests[collectionRequests.length - 1]?.get('place')).toBe('Wro');
  });

  it('toggles grouping by folder', async () => {
    const items = [
      videoItem({ fingerprint: 'fp-1', folder: { folderId: '11111111-1111-4111-8111-000000000001', currentPath: '/a', displayName: 'Alpha', online: true, offlineReason: null } }),
      videoItem({ fingerprint: 'fp-2', folder: { folderId: '22222222-2222-4222-8222-000000000002', currentPath: '/b', displayName: 'Beta', online: true, offlineReason: null } }),
    ];
    stubCollection(items);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findAllByTestId('library-tile');

    fireEvent.click(screen.getByTestId('library-group-by-folder'));

    await waitFor(() => {
      const headers = screen.getAllByTestId('library-section-header').map((node) => node.textContent);
      expect(headers).toEqual(['Alpha', 'Beta']);
    });
  });

  it('shows recent searches and top tags when the empty search field is focused', async () => {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(['drone']));
    stubTags([{ name: 'beach', count: 4 }]);
    stubCollection([videoItem({ fingerprint: 'fp-1' })]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findAllByTestId('library-tile');

    const input = screen.getByTestId('library-search-input').querySelector('input') ?? screen.getByTestId('library-search-input');
    fireEvent.focus(input);

    expect(await screen.findByText('drone')).toBeDefined();
    expect(await screen.findByText('beach')).toBeDefined();
  });

  it('Escape closes the suggestion popper while the field stays focused', async () => {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(['drone']));
    stubTags([{ name: 'beach', count: 4 }]);
    stubCollection([videoItem({ fingerprint: 'fp-1' })]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findAllByTestId('library-tile');

    const input = screen.getByTestId('library-search-input').querySelector('input') ?? screen.getByTestId('library-search-input');
    fireEvent.focus(input);
    await screen.findByText('drone');

    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByText('drone')).toBeNull();
      expect(screen.queryByText('beach')).toBeNull();
    });
  });

  it('typing after Escape reopens the suggestions once the field is empty again', async () => {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(['drone']));
    stubTags([{ name: 'beach', count: 4 }]);
    stubCollection([videoItem({ fingerprint: 'fp-1' })]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findAllByTestId('library-tile');

    const input = screen.getByTestId('library-search-input').querySelector('input') ?? screen.getByTestId('library-search-input');
    fireEvent.focus(input);
    await screen.findByText('drone');
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('drone')).toBeNull();
    });

    fireEvent.change(input, { target: { value: 'dro' } });
    fireEvent.change(input, { target: { value: '' } });

    expect(await screen.findByText('drone')).toBeDefined();
  });

  it('picking a suggestion sets the query and the grid request carries it', async () => {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(['drone']));
    stubTags([]);
    stubCollection([videoItem({ fingerprint: 'fp-1', fileName: 'drone-clip.mp4' })]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findAllByTestId('library-tile');

    const input = screen.getByTestId('library-search-input').querySelector('input') ?? screen.getByTestId('library-search-input');
    fireEvent.focus(input);
    fireEvent.click(await screen.findByText('drone'));

    await waitFor(() => {
      const latest = collectionRequests[collectionRequests.length - 1];
      expect(latest?.get('query')).toBe('drone');
    });
  });

  it('deleting a recent entry removes it from storage', async () => {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(['drone']));
    stubTags([]);
    stubCollection([videoItem({ fingerprint: 'fp-1' })]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findAllByTestId('library-tile');

    const input = screen.getByTestId('library-search-input').querySelector('input') ?? screen.getByTestId('library-search-input');
    fireEvent.focus(input);
    await screen.findByText('drone');
    fireEvent.click(screen.getByLabelText('Remove drone'));

    expect(JSON.parse(window.localStorage.getItem(RECENT_SEARCHES_KEY) ?? '[]')).toEqual([]);
  });

  it('records an Enter submit into recent searches', async () => {
    stubTags([]);
    stubCollection([videoItem({ fingerprint: 'fp-1' })]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findAllByTestId('library-tile');

    const input = screen.getByTestId('library-search-input').querySelector('input') ?? screen.getByTestId('library-search-input');
    fireEvent.change(input, { target: { value: 'drone' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem(RECENT_SEARCHES_KEY) ?? '[]')).toEqual(['drone']);
    });
  });

  it('a tag seed adds a removable tag chip', async () => {
    stubCollection([videoItem({ fingerprint: 'fp-1', tags: ['aerial'] })]);

    renderThemed(
      <LibraryView
        active
        onOpenResult={vi.fn()}
       
        onGoToVideos={vi.fn()}
        seed={{ kind: 'tag', tag: 'aerial' }}
        onSeedConsumed={vi.fn()}
      />,
    );

    expect(await screen.findByText('#aerial')).toBeDefined();
  });

  it('a person seed filters by that person and shows a removable chip built from the seed label', async () => {
    stubCollection([videoItem({ fingerprint: 'fp-1' })]);

    renderThemed(
      <LibraryView
        active
        onOpenResult={vi.fn()}
       
        onGoToVideos={vi.fn()}
        seed={{ kind: 'person', personId: 'person-abc123', label: 'Alex' }}
        onSeedConsumed={vi.fn()}
      />,
    );

    expect(await screen.findByText('Alex')).toBeDefined();
    await waitFor(() =>
      expect(collectionRequests[collectionRequests.length - 1]?.get('people')).toBe('person-abc123'),
    );
  });

  it('a photo media seed preselects the Kolekcja Zdjęcia chip for map navigation', async () => {
    stubCollection([photoItem({ fingerprint: 'ph_0000000000000001' })]);

    renderThemed(
      <LibraryView
        active
        onOpenResult={vi.fn()}
       
        onGoToVideos={vi.fn()}
        seed={{ kind: 'media', media: 'photo' }}
        onSeedConsumed={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(collectionRequests[collectionRequests.length - 1]?.get('media')).toBe('photo'),
    );
    expect(screen.getByTestId('library-media-photo').getAttribute('aria-pressed')).toBe('true');
  });

  it('load more keeps the grid mounted and does not flash the no-match state while the next page is in flight', async () => {
    const page1 = [videoItem({ fingerprint: 'fp-1', capturedAt: '2026-01-02T10:00:00.000Z' })];
    const page2 = [videoItem({ fingerprint: 'fp-2', capturedAt: '2026-01-01T10:00:00.000Z' })];
    const total = 201;
    const release: { current: (() => void) | null } = { current: null };
    const page2Gate = new Promise<void>((resolve) => { release.current = resolve; });

    server.use(
      http.get('/api/library/collection', async ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        if (cursor !== null) await page2Gate;
        return HttpResponse.json({
          ok: true,
          data: {
            query: null,
            media: 'all',
            limit: 200,
            total,
            videoTotal: total,
            photoTotal: 0,
            mediaTotals: { all: total, video: total, photo: 0 },
            count: cursor === null ? page1.length : page2.length,
            items: cursor === null ? page1 : page2,
            nextCursor: cursor === null ? '200' : null,
          },
        });
      }),
    );

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findAllByTestId('library-tile');

    fireEvent.click(await screen.findByTestId('library-load-more'));

    expect(screen.queryByTestId('library-no-match')).toBeNull();
    expect(screen.getByTestId('library-grid')).toBeDefined();
    expect(screen.getByTestId('library-section-header')).toBeDefined();

    release.current?.();

    await waitFor(() => expect(screen.getAllByTestId('library-tile')).toHaveLength(2));
    const fingerprints = screen.getAllByTestId('library-tile').map((tile) => tile.getAttribute('data-fingerprint'));
    expect(fingerprints).toEqual(['fp-1', 'fp-2']);
  });

  it('never carries a cursor from the previous result set into the request that a media change starts', async () => {
    server.use(
      http.get('/api/library/collection', ({ request }) => {
        const url = new URL(request.url);
        collectionRequests.push(url.searchParams);
        const media = url.searchParams.get('media') ?? 'all';
        const cursor = url.searchParams.get('cursor');
        const items: LibraryItem[] = media === 'video'
          ? [videoItem({ fingerprint: 'fp-v1' })]
          : [cursor === null ? videoItem({ fingerprint: 'fp-v1' }) : photoItem({ fingerprint: 'ph_0000000000000001' })];
        return HttpResponse.json({
          ok: true,
          data: {
            query: null,
            media,
            limit: 1,
            total: media === 'video' ? 1 : 2,
            videoTotal: 1,
            photoTotal: media === 'video' ? 0 : 1,
            mediaTotals: { all: 2, video: 1, photo: 1 },
            count: items.length,
            items,
            nextCursor: media === 'all' && cursor === null ? 'page-2' : null,
          },
        });
      }),
    );

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('library-load-more'));
    await waitFor(() => expect(screen.getAllByTestId('library-tile')).toHaveLength(2));

    fireEvent.click(screen.getByTestId('library-media-video'));

    await waitFor(() => expect(screen.getAllByTestId('library-tile')).toHaveLength(1));
    expect(collectionRequests.filter((params) => params.get('media') === 'video' && params.get('cursor') !== null)).toEqual([]);
  });

  it('does not duplicate an item that both the first and the next cursor page return, the #74 offset-merge bug class in the new cursor world', async () => {
    const shared = videoItem({ fingerprint: 'fp-shared', capturedAt: '2026-01-02T09:00:00.000Z' });
    const page1 = [videoItem({ fingerprint: 'fp-first', capturedAt: '2026-01-02T10:00:00.000Z' }), shared];
    const page2 = [shared, videoItem({ fingerprint: 'fp-second', capturedAt: '2026-01-02T08:00:00.000Z' })];
    const release: { current: (() => void) | null } = { current: null };
    const page2Gate = new Promise<void>((resolve) => { release.current = resolve; });

    server.use(
      http.get('/api/library/collection', async ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        if (cursor !== null) await page2Gate;
        return HttpResponse.json({
          ok: true,
          data: {
            query: null,
            media: 'all',
            limit: 2,
            total: 3,
            videoTotal: 3,
            photoTotal: 0,
            mediaTotals: { all: 3, video: 3, photo: 0 },
            count: cursor === null ? page1.length : page2.length,
            items: cursor === null ? page1 : page2,
            nextCursor: cursor === null ? 'next' : null,
          },
        });
      }),
    );

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findAllByTestId('library-tile');

    fireEvent.click(await screen.findByTestId('library-load-more'));
    release.current?.();

    await waitFor(() => expect(screen.getAllByTestId('library-tile')).toHaveLength(3));
    const fingerprints = screen.getAllByTestId('library-tile').map((tile) => tile.getAttribute('data-fingerprint'));
    expect(new Set(fingerprints).size).toBe(3);
  });

  it('loads more person media by cursor so items behind the displayed total are reachable', async () => {
    const page1 = [photoItem({ fingerprint: 'ph_0000000000000001' })];
    const page2 = [photoItem({ fingerprint: 'ph_0000000000000002' })];

    server.use(
      http.get('/api/library/collection', ({ request }) => {
        const url = new URL(request.url);
        collectionRequests.push(url.searchParams);
        const cursor = url.searchParams.get('cursor');
        const items = cursor === null ? page1 : page2;
        return HttpResponse.json({
          ok: true,
          data: {
            query: null,
            media: 'photo',
            limit: 200,
            total: 201,
            videoTotal: 0,
            photoTotal: 201,
            mediaTotals: { all: 201, video: 0, photo: 201 },
            count: items.length,
            items,
            nextCursor: cursor === null ? 'page-2' : null,
          },
        });
      }),
    );

    renderThemed(
      <PersonMediaPanel
        personId="person-abc123"
        label="Anna"
        media="photo"
        onClose={vi.fn()}
        onOpenResult={vi.fn()}
        onOpenPhotoInAnalysis={vi.fn()}
      />,
    );

    expect(await screen.findByText('Anna (201)')).toBeDefined();
    expect((await screen.findByTestId('library-tile')).getAttribute('data-fingerprint')).toBe('ph_0000000000000001');

    fireEvent.click(await screen.findByTestId('person-media-load-more'));

    await waitFor(() => expect(collectionRequests.some((params) => params.get('cursor') === 'page-2')).toBe(true));
    await waitFor(() => {
      const fingerprints = screen.getAllByTestId('library-tile').map((tile) => tile.getAttribute('data-fingerprint'));
      expect(fingerprints).toEqual(['ph_0000000000000001', 'ph_0000000000000002']);
    });
  });

  describe('mixed media (Kolekcja)', () => {
    it('renders a photo tile alongside video tiles in one shared date-grouped timeline', async () => {
      const items = [
        videoItem({ fingerprint: 'fp-v1', capturedAt: '2026-05-01T09:00:00.000Z' }),
        photoItem({ fingerprint: 'ph_0000000000000001', capturedAt: '2026-05-01T15:00:00.000Z' }),
      ];
      stubCollection(items);

      renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);

      const tiles = await screen.findAllByTestId('library-tile');
      expect(tiles).toHaveLength(2);
      expect(screen.getAllByTestId('library-section-header')).toHaveLength(1);
      const media = tiles.map((tile) => tile.getAttribute('data-media')).sort();
      expect(media).toEqual(['photo', 'video']);
    });

    it('shows Wszystko/Filmy/Zdjęcia media chips with server-reported totals', async () => {
      stubCollection([
        videoItem({ fingerprint: 'fp-v1' }),
        photoItem({ fingerprint: 'ph_0000000000000001' }),
        photoItem({ fingerprint: 'ph_0000000000000002' }),
      ]);

      renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
      await screen.findAllByTestId('library-tile');

      expect(screen.getByTestId('library-media-all').textContent).toContain('3');
      expect(screen.getByTestId('library-media-video').textContent).toContain('1');
      expect(screen.getByTestId('library-media-photo').textContent).toContain('2');
    });

    it('clicking the Photos media chip narrows the request to photos only', async () => {
      stubCollection([videoItem({ fingerprint: 'fp-v1' }), photoItem({ fingerprint: 'ph_0000000000000001' })]);

      renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
      await screen.findAllByTestId('library-tile');

      fireEvent.click(screen.getByTestId('library-media-photo'));

      await waitFor(() => {
        const tiles = screen.getAllByTestId('library-tile');
        expect(tiles).toHaveLength(1);
        expect(tiles[0]?.getAttribute('data-media')).toBe('photo');
      });
      expect(collectionRequests[collectionRequests.length - 1]?.get('media')).toBe('photo');
    });

    it('shows an inline notice and hides photos when a video-only filter is active with media set to all', async () => {
      stubCollection([videoItem({ fingerprint: 'fp-v1', gps: { lat: 1, lon: 2 } }), photoItem({ fingerprint: 'ph_0000000000000001' })]);

      renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
      await screen.findAllByTestId('library-tile');
      expect(screen.queryByTestId('library-video-only-filter-notice')).toBeNull();

      const gpsSelect = screen.getByTestId('library-filter-has-gps').querySelector('input');
      fireEvent.change(gpsSelect ?? screen.getByTestId('library-filter-has-gps'), { target: { value: 'with' } });

      await waitFor(() => expect(screen.getByTestId('library-video-only-filter-notice')).toBeDefined());
      await waitFor(() => {
        const tiles = screen.getAllByTestId('library-tile');
        expect(tiles.every((tile) => tile.getAttribute('data-media') === 'video')).toBe(true);
      });
    });

    it('keeps photos visible without a hidden-photo notice when only the folder filter is active', async () => {
      const folderId = '99999999-9999-4999-8999-999999999999';
      stubCollection([
        videoItem({
          fingerprint: 'fp-folder',
          folder: { folderId, currentPath: '/shared', displayName: 'Shared', online: true, offlineReason: null },
        }),
        photoItem({ fingerprint: 'ph_0000000000000001', currentPath: '/shared/photo.jpg' }),
        photoItem({ fingerprint: 'ph_0000000000000002', currentPath: '/other/photo.jpg' }),
      ]);
      stubFacets({
        folders: [{ folderId, displayName: 'Shared', currentPath: '/shared', online: true, count: 1 }],
      });

      renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
      await screen.findAllByTestId('library-tile');

      const folderInput = screen.getByTestId('library-filter-folder').querySelector('input');
      if (folderInput === null) throw new Error('missing folder filter input');
      fireEvent.mouseDown(folderInput);
      fireEvent.click(await screen.findByText('Shared (1)'));

      await waitFor(() => {
        const tiles = screen.getAllByTestId('library-tile');
        expect(tiles.map((tile) => tile.getAttribute('data-fingerprint')).sort()).toEqual(['fp-folder', 'ph_0000000000000001']);
      });
      expect(screen.queryByTestId('library-video-only-filter-notice')).toBeNull();
    });

    it('disables folder grouping once photos are mixed into the Kolekcja results', async () => {
      stubCollection([videoItem({ fingerprint: 'fp-v1' }), photoItem({ fingerprint: 'ph_0000000000000001' })]);

      renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
      await screen.findAllByTestId('library-tile');

      expect(screen.getByTestId('library-group-by-folder')).toHaveProperty('disabled', true);
    });

    it('hides the relevance sort option while media is set to all, even with an active query', async () => {
      stubCollection([videoItem({ fingerprint: 'fp-v1', fileName: 'drone-1.mp4' }), photoItem({ fingerprint: 'ph_0000000000000001' })]);

      renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
      await screen.findAllByTestId('library-tile');

      fireEvent.change(screen.getByTestId('library-search-input').querySelector('input') ?? screen.getByTestId('library-search-input'), { target: { value: 'drone' } });
      await waitFor(() => expect(collectionRequests[collectionRequests.length - 1]?.get('query')).toBe('drone'));

      const sortDisplay = screen.getByTestId('library-sort').querySelector('[role="combobox"]');
      if (sortDisplay === null) throw new Error('missing sort combobox');
      fireEvent.mouseDown(sortDisplay);

      expect(screen.queryByRole('option', { name: en.library.sortRelevance })).toBeNull();
    });

    it('offers the relevance sort option once media is narrowed to a single medium with a query', async () => {
      stubCollection([videoItem({ fingerprint: 'fp-v1', fileName: 'drone-1.mp4' })]);

      renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
      await screen.findAllByTestId('library-tile');

      fireEvent.click(screen.getByTestId('library-media-video'));
      fireEvent.change(screen.getByTestId('library-search-input').querySelector('input') ?? screen.getByTestId('library-search-input'), { target: { value: 'drone' } });
      await waitFor(() => expect(collectionRequests[collectionRequests.length - 1]?.get('query')).toBe('drone'));

      const sortDisplay = screen.getByTestId('library-sort').querySelector('[role="combobox"]');
      if (sortDisplay === null) throw new Error('missing sort combobox');
      fireEvent.mouseDown(sortDisplay);

      expect(screen.getByRole('option', { name: en.library.sortRelevance })).toBeDefined();
    });

    it('opens the same shared media viewer for a photo tile', async () => {
      const fingerprint = 'ph_0000000000000001';
      stubCollection([photoItem({ fingerprint, capturedAt: '2026-01-02T10:00:00.000Z' })]);
      stubPhotoDetail(fingerprint);

      renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
      fireEvent.click(await screen.findByTestId('library-tile'));

      const viewer = await screen.findByTestId('library-media-viewer');
      expect(viewer.getAttribute('data-media')).toBe('photo');
      expect(await screen.findByTestId('library-media-viewer-image')).toBeDefined();
      expect(screen.queryByTestId('library-media-viewer-player')).toBeNull();
    });

    it('walks a mixed collection with the viewer arrows, across both media types', async () => {
      stubCollection([
        videoItem({ fingerprint: 'fp-v1', capturedAt: '2026-01-03T10:00:00.000Z' }),
        photoItem({ fingerprint: 'ph_0000000000000001', capturedAt: '2026-01-02T10:00:00.000Z' }),
      ]);
      stubLibraryPreview();
      stubPhotoDetail('ph_0000000000000001');

      renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
      await waitFor(() => expect(screen.getAllByTestId('library-tile')).toHaveLength(2));
      fireEvent.click(screen.getAllByTestId('library-tile')[0] ?? screen.getByTestId('library-tile'));

      const viewer = await screen.findByTestId('library-media-viewer');
      expect(viewer.getAttribute('data-fingerprint')).toBe('fp-v1');
      expect(screen.queryByTestId('library-media-viewer-previous')).toBeNull();

      fireEvent.click(screen.getByTestId('library-media-viewer-next'));
      await waitFor(() => {
        expect(screen.getByTestId('library-media-viewer').getAttribute('data-fingerprint')).toBe('ph_0000000000000001');
      });
      expect(screen.getByTestId('library-media-viewer').getAttribute('data-media')).toBe('photo');
      expect(screen.queryByTestId('library-media-viewer-next')).toBeNull();

      fireEvent.click(screen.getByTestId('library-media-viewer-previous'));
      await waitFor(() => {
        expect(screen.getByTestId('library-media-viewer').getAttribute('data-fingerprint')).toBe('fp-v1');
      });
    });

    it('shows description, tags, transcript and analysis provenance beside a video in the shared viewer', async () => {
      stubCollection([videoItem({ fingerprint: 'fp-v1', description: 'A drone pass over the bay', tags: ['drone', 'bay'] })]);
      stubLibraryPreview({
        transcript: 'quiet audio over the bay',
        analysis: { label: 'harness / claude-code', createdAt: '2026-01-03T12:00:00.000Z' },
      });

      renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
      fireEvent.click(await screen.findByTestId('library-tile'));

      expect(await screen.findByTestId('library-media-viewer-details')).toBeDefined();
      expect(screen.getByTestId('library-media-viewer-description').textContent).toContain('A drone pass over the bay');
      expect(screen.getByTestId('library-media-viewer-tags').textContent).toContain('drone');
      await waitFor(() => {
        expect(screen.getByTestId('library-media-viewer-transcript').textContent).toContain('quiet audio over the bay');
      });
      expect(screen.getByTestId('library-media-viewer-path').textContent).toContain('/videos/fp-v1.mp4');
      expect(screen.getByText(/^harness \/ claude-code · /)).toBeDefined();
    });

    it('the tile menu opens a photo in Analysis by resolving its owning photo root', async () => {
      stubPhotoRoots([{ root: '/photos', photos: 1, missing: 0, lastScanAt: '2024-03-02T10:00:00.000Z' }]);
      stubCollection([photoItem({ fingerprint: 'ph_0000000000000001', currentPath: '/photos/2024/a.jpg' })]);
      const onOpenPhotoInAnalysis = vi.fn();

      renderThemed(<LibraryView active onOpenResult={vi.fn()} onOpenPhotoInAnalysis={onOpenPhotoInAnalysis} onGoToVideos={vi.fn()} />);
      fireEvent.contextMenu(await screen.findByTestId('library-tile'));
      fireEvent.click(await screen.findByTestId('library-tile-menu-open-analysis'));

      expect(onOpenPhotoInAnalysis).toHaveBeenCalledWith('/photos', 'ph_0000000000000001');
    });

    it('keeps the loaded tiles on screen while a media-chip change is still in flight, instead of blanking the grid', async () => {
      const release: { current: (() => void) | null } = { current: null };
      const videoGate = new Promise<void>((resolve) => { release.current = resolve; });

      server.use(
        http.get('/api/library/collection', async ({ request }) => {
          const media = new URL(request.url).searchParams.get('media') ?? 'all';
          if (media === 'video') await videoGate;
          const items: LibraryItem[] = media === 'video'
            ? [videoItem({ fingerprint: 'fp-v1' })]
            : [videoItem({ fingerprint: 'fp-v1' }), photoItem({ fingerprint: 'ph_0000000000000001' })];
          return HttpResponse.json({
            ok: true,
            data: {
              query: null,
              media,
              limit: 200,
              total: items.length,
              videoTotal: 1,
              photoTotal: media === 'video' ? 0 : 1,
              mediaTotals: { all: 2, video: 1, photo: 1 },
              count: items.length,
              items,
              nextCursor: null,
            },
          });
        }),
      );

      renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
      await waitFor(() => expect(screen.getAllByTestId('library-tile')).toHaveLength(2));

      fireEvent.click(screen.getByTestId('library-media-video'));

      expect(screen.queryAllByTestId('library-tile')).toHaveLength(2);
      expect(screen.queryByTestId('library-no-match')).toBeNull();

      release.current?.();
      await waitFor(() => expect(screen.getAllByTestId('library-tile')).toHaveLength(1));
    });

    it('keeps all media chip totals stable after selecting a single medium', async () => {
      stubCollection([
        videoItem({ fingerprint: 'fp-v1' }),
        photoItem({ fingerprint: 'ph_0000000000000001' }),
        photoItem({ fingerprint: 'ph_0000000000000002' }),
      ]);

      renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
      await screen.findAllByTestId('library-tile');

      fireEvent.click(screen.getByTestId('library-media-photo'));

      await waitFor(() => expect(screen.getAllByTestId('library-tile')).toHaveLength(2));
      expect(screen.getByTestId('library-media-photo').textContent).toContain('2');
      expect(screen.getByTestId('library-media-video').textContent).toContain('1');
      expect(screen.getByTestId('library-media-all').textContent).toContain('3');
    });

    it('drops the photo count while a video-only filter hides photos from an all-media request', async () => {
      stubCollection([videoItem({ fingerprint: 'fp-v1', gps: { lat: 1, lon: 2 } }), photoItem({ fingerprint: 'ph_0000000000000001' })]);

      renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
      await screen.findAllByTestId('library-tile');
      expect(screen.getByTestId('library-media-photo').textContent).toContain('1');

      const gpsSelect = screen.getByTestId('library-filter-has-gps').querySelector('input');
      fireEvent.change(gpsSelect ?? screen.getByTestId('library-filter-has-gps'), { target: { value: 'with' } });

      await waitFor(() => expect(screen.getByTestId('library-video-only-filter-notice')).toBeDefined());
      await waitFor(() => expect(screen.getByTestId('library-media-photo').textContent).toContain('0'));
      expect(screen.getByTestId('library-media-all').textContent).toContain('1');
      expect(screen.getByTestId('library-media-video').textContent).toContain('1');
    });

    it('shows analysis details beside the photo in the Kolekcja viewer', async () => {
      const fingerprint = 'ph_0000000000000001';
      stubCollection([photoItem({ fingerprint })]);
      stubPhotoDetail(fingerprint);

      renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
      fireEvent.click(await screen.findByTestId('library-tile'));

      expect(await screen.findByTestId('library-media-viewer-details')).toBeDefined();
      expect(await screen.findByText('Sunset over a quiet lake')).toBeDefined();
      expect(screen.getByText(en.photos.sceneLandscape)).toBeDefined();
      expect(screen.getByText(en.photos.qualityGood)).toBeDefined();
      expect(screen.getByText('sunset')).toBeDefined();
      expect(screen.getByText(/^Local · gemma3:4b · app language \(auto\) · /)).toBeDefined();
    });

    it('opens the viewed Kolekcja photo in Analysis through the registered photo root', async () => {
      const fingerprint = 'ph_0000000000000001';
      stubPhotoRoots([{ root: '/photos', photos: 1, missing: 0, lastScanAt: '2026-01-02T10:00:00.000Z' }]);
      stubCollection([photoItem({ fingerprint, currentPath: `/photos/trip/${fingerprint}.jpg` })]);
      stubPhotoDetail(fingerprint);
      const onOpenPhotoInAnalysis = vi.fn();

      renderThemed(<LibraryView active onOpenResult={vi.fn()} onOpenPhotoInAnalysis={onOpenPhotoInAnalysis} onGoToVideos={vi.fn()} />);
      fireEvent.click(await screen.findByTestId('library-tile'));
      fireEvent.click(await screen.findByTestId('library-media-viewer-open-analysis'));

      expect(onOpenPhotoInAnalysis).toHaveBeenCalledWith('/photos', fingerprint);
    });
  });
});
