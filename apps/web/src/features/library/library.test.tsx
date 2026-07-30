import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import type { z } from 'zod';

import type { searchResultSchema } from '@core/contract/index.js';

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

const stubSearch = (items: LibraryItem[]) => {
  server.use(
    http.get('/api/search', ({ request }) => {
      const url = new URL(request.url);
      const query = url.searchParams.get('query');
      const matched = query === null || query.length === 0 ? items : items.filter((item) => item.fileName.includes(query));
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

describe('LibraryView', () => {
  it('renders the honest empty-catalog state, not a generic no-results message', async () => {
    stubSearch([]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);

    expect(await screen.findByTestId('library-empty-catalog')).toBeDefined();
    expect(screen.queryByTestId('library-no-match')).toBeNull();
  });

  it('routes the empty-catalog action to the Videos view', async () => {
    stubSearch([]);
    const onGoToVideos = vi.fn();

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={onGoToVideos} />);
    fireEvent.click(await screen.findByTestId('library-empty-go-videos'));

    expect(onGoToVideos).toHaveBeenCalledOnce();
  });

  it('renders tiles grouped by capture day with the file count header', async () => {
    const items = [
      libraryItem({ fingerprint: 'fp-1', capturedAt: '2026-01-02T10:00:00.000Z' }),
      libraryItem({ fingerprint: 'fp-2', capturedAt: '2026-01-02T08:00:00.000Z' }),
    ];
    stubSearch(items);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);

    const tiles = await screen.findAllByTestId('library-tile');
    expect(tiles).toHaveLength(2);
    expect(await screen.findByText('2 files')).toBeDefined();
  });

  it('opens the folder context for an online tile through the existing search-result path', async () => {
    const items = [libraryItem({ fingerprint: 'fp-open' })];
    stubSearch(items);
    const onOpenResult = vi.fn();

    renderThemed(<LibraryView active onOpenResult={onOpenResult} onGoToVideos={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('library-tile'));

    expect(onOpenResult).toHaveBeenCalledWith('/videos', '/videos/fp-open.mp4');
  });

  it('does not open an offline-folder tile', async () => {
    const items = [libraryItem({ fingerprint: 'fp-offline', folder: { folderId: '22222222-2222-4222-8222-222222222222', currentPath: '/offline', displayName: 'offline', online: false } })];
    stubSearch(items);
    const onOpenResult = vi.fn();

    renderThemed(<LibraryView active onOpenResult={onOpenResult} onGoToVideos={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('library-tile'));

    expect(screen.getByTestId('library-offline-badge')).toBeDefined();
    expect(onOpenResult).not.toHaveBeenCalled();
  });

  it('surfaces a failed catalog read instead of claiming nothing has been processed', async () => {
    server.use(http.get('/api/search', () => HttpResponse.json({ ok: false, error: { code: 'read_error', message: 'catalog is locked' } }, { status: 500 })));

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);

    expect(await screen.findByTestId('library-error')).toBeDefined();
    expect(screen.queryByTestId('library-empty-catalog')).toBeNull();
  });

  it('renders the no-match state, distinct from the empty-catalog state, once a query eliminates everything', async () => {
    stubSearch([libraryItem({ fingerprint: 'fp-1' })]);

    renderThemed(<LibraryView active onOpenResult={vi.fn()} onGoToVideos={vi.fn()} />);
    await screen.findAllByTestId('library-tile');

    fireEvent.change(screen.getByTestId('library-search-input').querySelector('input') ?? screen.getByTestId('library-search-input'), {
      target: { value: 'no-such-file' },
    });

    await waitFor(() => expect(screen.getByTestId('library-no-match')).toBeDefined());
    expect(screen.queryByTestId('library-empty-catalog')).toBeNull();
  });
});
