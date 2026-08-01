import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { z } from 'zod';

import type { libraryFacetsOutputSchema, searchResultSchema } from '@core/contract/index.js';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { LibraryView } from './LibraryView.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

type LibraryItem = z.output<typeof searchResultSchema>;

const libraryItem = (overrides: Partial<LibraryItem> & { fingerprint: string }): LibraryItem => ({
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
  },
  gps: null,
  missing: false,
  capturedAt: '2026-01-02T10:00:00.000Z',
  place: null,
  ...overrides,
});

const searchRequests: URLSearchParams[] = [];

const stubSearch = (items: LibraryItem[]) => {
  server.use(
    http.get('/api/search', ({ request }) => {
      const url = new URL(request.url);
      searchRequests.push(url.searchParams);
      const query = url.searchParams.get('query');
      const hasGps = url.searchParams.get('hasGps');
      const folderId = url.searchParams.get('folderId');
      let matched = query === null || query.length === 0 ? items : items.filter((item) => item.fileName.includes(query));
      if (hasGps === 'true') matched = matched.filter((item) => item.gps !== null);
      if (hasGps === 'false') matched = matched.filter((item) => item.gps === null);
      if (folderId !== null && folderId.length > 0) matched = matched.filter((item) => item.folder.folderId === folderId);
      return HttpResponse.json({
        ok: true,
        data: {
          query,
          limit: 200,
          offset: 0,
          count: matched.length,
          total: matched.length,
          results: matched,
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

describe('LibraryView', () => {
  beforeEach(() => {
    searchRequests.length = 0;
    window.localStorage.removeItem(RECENT_SEARCHES_KEY);
    stubFacets();
  });

  it('renders the honest empty-catalog state, not a generic no-results message', async () => {
    stubSearch([]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onPreview={vi.fn()} onGoToVideos={vi.fn()} />);

    expect(await screen.findByTestId('library-empty-catalog')).toBeDefined();
    expect(screen.queryByTestId('library-no-match')).toBeNull();
  });

  it('routes the empty-catalog action to the Videos view', async () => {
    stubSearch([]);
    const onGoToVideos = vi.fn();

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onPreview={vi.fn()} onGoToVideos={onGoToVideos} />);
    fireEvent.click(await screen.findByTestId('library-empty-go-videos'));

    expect(onGoToVideos).toHaveBeenCalledOnce();
  });

  it('renders tiles grouped by capture day with the file count header', async () => {
    const items = [
      libraryItem({ fingerprint: 'fp-1', capturedAt: '2026-01-02T10:00:00.000Z' }),
      libraryItem({ fingerprint: 'fp-2', capturedAt: '2026-01-02T08:00:00.000Z' }),
    ];
    stubSearch(items);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onPreview={vi.fn()} onGoToVideos={vi.fn()} />);

    const tiles = await screen.findAllByTestId('library-tile');
    expect(tiles).toHaveLength(2);
    expect(await screen.findByText('2 files')).toBeDefined();
  });

  it('opens the preview for an online tile, not the analysis workspace', async () => {
    const items = [libraryItem({ fingerprint: 'fp-open' })];
    stubSearch(items);
    const onPreview = vi.fn();
    const onOpenResult = vi.fn();

    renderThemed(<LibraryView active onOpenResult={onOpenResult} onPreview={onPreview} onGoToVideos={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('library-tile'));

    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ fingerprint: 'fp-open' }));
    expect(onOpenResult).not.toHaveBeenCalled();
  });

  it('does not open an offline-folder tile', async () => {
    const items = [libraryItem({ fingerprint: 'fp-offline', folder: { folderId: '22222222-2222-4222-8222-222222222222', currentPath: '/offline', displayName: 'offline', online: false } })];
    stubSearch(items);
    const onPreview = vi.fn();

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onPreview={onPreview} onGoToVideos={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('library-tile'));

    expect(screen.getByTestId('library-offline-badge')).toBeDefined();
    expect(onPreview).not.toHaveBeenCalled();
  });

  it('the tile menu opens the video in Analysis, with no folder-view item', async () => {
    const items = [libraryItem({ fingerprint: 'fp-menu' })];
    stubSearch(items);
    const onOpenResult = vi.fn();

    renderThemed(<LibraryView active onOpenResult={onOpenResult} onPreview={vi.fn()} onGoToVideos={vi.fn()} />);
    fireEvent.contextMenu(await screen.findByTestId('library-tile'));

    expect(screen.queryByTestId('library-tile-menu-open-folder')).toBeNull();
    fireEvent.click(await screen.findByTestId('library-tile-menu-open-analysis'));

    expect(onOpenResult).toHaveBeenCalledWith('/videos', '/videos/fp-menu.mp4');
  });

  it('surfaces a failed catalog read instead of claiming nothing has been processed', async () => {
    server.use(http.get('/api/search', () => HttpResponse.json({ ok: false, error: { code: 'read_error', message: 'catalog is locked' } }, { status: 500 })));

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onPreview={vi.fn()} onGoToVideos={vi.fn()} />);

    expect(await screen.findByTestId('library-error')).toBeDefined();
    expect(screen.queryByTestId('library-empty-catalog')).toBeNull();
  });

  it('renders the no-match state, distinct from the empty-catalog state, once a query eliminates everything', async () => {
    stubSearch([libraryItem({ fingerprint: 'fp-1' })]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onPreview={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findAllByTestId('library-tile');

    fireEvent.change(screen.getByTestId('library-search-input').querySelector('input') ?? screen.getByTestId('library-search-input'), {
      target: { value: 'no-such-file' },
    });

    await waitFor(() => expect(screen.getByTestId('library-no-match')).toBeDefined());
    expect(screen.queryByTestId('library-empty-catalog')).toBeNull();
  });

  it('names the active chip in the no-match copy', async () => {
    stubSearch([libraryItem({ fingerprint: 'fp-1', gps: { lat: 1, lon: 2 } })]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onPreview={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findAllByTestId('library-tile');

    const gpsSelect = screen.getByTestId('library-filter-has-gps').querySelector('input');
    fireEvent.change(gpsSelect ?? screen.getByTestId('library-filter-has-gps'), { target: { value: 'without' } });

    await waitFor(() => expect(screen.getByTestId('library-no-match')).toBeDefined());
    expect(screen.getByTestId('library-no-match-body').textContent).toContain('Without GPS');
  });

  it('a hasGps chip narrows the search request', async () => {
    stubSearch([
      libraryItem({ fingerprint: 'fp-gps', gps: { lat: 1, lon: 2 } }),
      libraryItem({ fingerprint: 'fp-no-gps' }),
    ]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onPreview={vi.fn()} onGoToVideos={vi.fn()} />);
    expect(await screen.findAllByTestId('library-tile')).toHaveLength(2);

    const gpsSelect = screen.getByTestId('library-filter-has-gps').querySelector('input');
    fireEvent.change(gpsSelect ?? screen.getByTestId('library-filter-has-gps'), { target: { value: 'with' } });

    await waitFor(async () => expect(await screen.findAllByTestId('library-tile')).toHaveLength(1));
    expect(screen.getByTestId('library-chip-hasGps')).toBeDefined();
  });

  it('seeding a folder shows a removable folder chip and scrolls to the seeded fingerprint', async () => {
    const items = [
      libraryItem({ fingerprint: 'fp-1' }),
      libraryItem({
        fingerprint: 'fp-target',
        folder: { folderId: '99999999-9999-4999-8999-999999999999', currentPath: '/other', displayName: 'Other Folder', online: true },
      }),
    ];
    stubSearch(items);

    renderThemed(
      <LibraryView
        active
        onOpenResult={vi.fn()}
        onPreview={vi.fn()}
        onGoToVideos={vi.fn()}
        seed={{ kind: 'folder', folderId: '99999999-9999-4999-8999-999999999999', folderLabel: 'Other Folder', fingerprint: 'fp-target' }}
        onSeedConsumed={vi.fn()}
      />,
    );

    expect(await screen.findByText('Folder: Other Folder')).toBeDefined();
    expect(await screen.findAllByTestId('library-tile')).toHaveLength(1);
  });

  it('keeps the chosen sort while a text query is active instead of silently falling back to relevance', async () => {
    stubSearch([libraryItem({ fingerprint: 'fp-1' })]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onPreview={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findAllByTestId('library-tile');

    const sortSelect = screen.getByTestId('library-sort').querySelector('input');
    fireEvent.change(sortSelect ?? screen.getByTestId('library-sort'), { target: { value: 'name_asc' } });
    fireEvent.change(screen.getByTestId('library-search-input').querySelector('input') ?? screen.getByTestId('library-search-input'), { target: { value: 'fp' } });

    await waitFor(() => {
      const latest = searchRequests[searchRequests.length - 1];
      expect(latest?.get('query')).toBe('fp');
      expect(latest?.get('sort')).toBe('name_asc');
    });
  });

  it('offers facet options with their whole-catalog counts', async () => {
    stubFacets({ tags: [{ name: 'beach', count: 4 }, { name: 'sunset', count: 2 }] });
    stubSearch([libraryItem({ fingerprint: 'fp-1' })]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onPreview={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findAllByTestId('library-tile');

    const tagInput = screen.getByTestId('library-filter-tags').querySelector('input');
    fireEvent.change(tagInput ?? screen.getByTestId('library-filter-tags'), { target: { value: 'bea' } });

    expect(await screen.findByText('beach (4)')).toBeDefined();
  });

  it('debounces the free-text place filter into a single search request', async () => {
    stubSearch([libraryItem({ fingerprint: 'fp-1' })]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onPreview={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findAllByTestId('library-tile');

    const placeInput = screen.getByTestId('library-filter-place').querySelector('input');
    const target = placeInput ?? screen.getByTestId('library-filter-place');
    fireEvent.change(target, { target: { value: 'W' } });
    fireEvent.change(target, { target: { value: 'Wr' } });
    fireEvent.change(target, { target: { value: 'Wro' } });

    await waitFor(() => expect(searchRequests.filter((params) => params.get('place') !== null)).toHaveLength(1));
    expect(searchRequests[searchRequests.length - 1]?.get('place')).toBe('Wro');
  });

  it('toggles grouping by folder', async () => {
    const items = [
      libraryItem({ fingerprint: 'fp-1', folder: { folderId: '11111111-1111-4111-8111-000000000001', currentPath: '/a', displayName: 'Alpha', online: true } }),
      libraryItem({ fingerprint: 'fp-2', folder: { folderId: '22222222-2222-4222-8222-000000000002', currentPath: '/b', displayName: 'Beta', online: true } }),
    ];
    stubSearch(items);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onPreview={vi.fn()} onGoToVideos={vi.fn()} />);
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
    stubSearch([libraryItem({ fingerprint: 'fp-1' })]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onPreview={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findAllByTestId('library-tile');

    const input = screen.getByTestId('library-search-input').querySelector('input') ?? screen.getByTestId('library-search-input');
    fireEvent.focus(input);

    expect(await screen.findByText('drone')).toBeDefined();
    expect(await screen.findByText('beach')).toBeDefined();
  });

  it('picking a suggestion sets the query and the grid request carries it', async () => {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(['drone']));
    stubTags([]);
    stubSearch([libraryItem({ fingerprint: 'fp-1', fileName: 'drone-clip.mp4' })]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onPreview={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findAllByTestId('library-tile');

    const input = screen.getByTestId('library-search-input').querySelector('input') ?? screen.getByTestId('library-search-input');
    fireEvent.focus(input);
    fireEvent.click(await screen.findByText('drone'));

    await waitFor(() => {
      const latest = searchRequests[searchRequests.length - 1];
      expect(latest?.get('query')).toBe('drone');
    });
  });

  it('deleting a recent entry removes it from storage', async () => {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(['drone']));
    stubTags([]);
    stubSearch([libraryItem({ fingerprint: 'fp-1' })]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onPreview={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findAllByTestId('library-tile');

    const input = screen.getByTestId('library-search-input').querySelector('input') ?? screen.getByTestId('library-search-input');
    fireEvent.focus(input);
    await screen.findByText('drone');
    fireEvent.click(screen.getByLabelText('Remove drone'));

    expect(JSON.parse(window.localStorage.getItem(RECENT_SEARCHES_KEY) ?? '[]')).toEqual([]);
  });

  it('records an Enter submit into recent searches', async () => {
    stubTags([]);
    stubSearch([libraryItem({ fingerprint: 'fp-1' })]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onPreview={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findAllByTestId('library-tile');

    const input = screen.getByTestId('library-search-input').querySelector('input') ?? screen.getByTestId('library-search-input');
    fireEvent.change(input, { target: { value: 'drone' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem(RECENT_SEARCHES_KEY) ?? '[]')).toEqual(['drone']);
    });
  });

  it('a tag seed adds a removable tag chip', async () => {
    stubSearch([libraryItem({ fingerprint: 'fp-1', tags: ['aerial'] })]);

    renderThemed(
      <LibraryView
        active
        onOpenResult={vi.fn()}
        onPreview={vi.fn()}
        onGoToVideos={vi.fn()}
        seed={{ kind: 'tag', tag: 'aerial' }}
        onSeedConsumed={vi.fn()}
      />,
    );

    expect(await screen.findByText('#aerial')).toBeDefined();
  });
});
