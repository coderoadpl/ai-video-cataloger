import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import type { photoListItemSchema } from '@core/contract/index.js';

import { renderWithProviders } from '../../test/render.js';
import { createAppTheme } from '../../theme.js';
import type { PhotosAnalysisState } from './use-photos-analysis.js';
import { PhotosSidebar } from './PhotosSidebar.js';

type PhotoListItem = z.output<typeof photoListItemSchema>;

const theme = createAppTheme('light');
const renderThemed = (ui: Parameters<typeof renderWithProviders>[0]) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

const item = (overrides: Partial<PhotoListItem> & { fingerprint: string }): PhotoListItem => ({
  fileName: `${overrides.fingerprint}.jpg`,
  currentPath: `/media/${overrides.fingerprint}.jpg`,
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
  exifReadAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const baseState = (overrides: Partial<PhotosAnalysisState> = {}): PhotosAnalysisState => ({
  isLoading: false,
  error: null,
  roots: [{ root: '/media', photos: 1, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' }],
  scope: 'folder',
  setScope: vi.fn(),
  folder: '/media',
  folderState: 'scanned',
  selectedRoot: '/media',
  items: [],
  total: 0,
  hasMore: false,
  isLoadingMore: false,
  loadMore: vi.fn(),
  counts: null,
  selectedFingerprint: null,
  selectFingerprint: vi.fn(),
  activeJobLabel: null,
  analyzeStatusLabel: null,
  isBusy: false,
  scanFolder: vi.fn(),
  detail: null,
  isDetailLoading: false,
  variants: [],
  selectVariant: vi.fn(),
  analyzePhotos: vi.fn(),
  canAnalyze: true,
  analyzeProgress: null,
  processingFingerprints: new Set(),
  generateProxies: vi.fn(),
  isCancellable: false,
  cancelConfirmation: { open: false, isBatch: false },
  requestCancelAnalysis: vi.fn(),
  confirmCancelAnalysis: vi.fn(),
  closeCancelConfirmation: vi.fn(),
  ...overrides,
});

describe('PhotosSidebar', () => {
  it('renders a prompt to open a folder when there is no current folder', () => {
    const onOpenFolder = vi.fn();
    renderThemed(
      <PhotosSidebar
        state={baseState({ roots: [], folder: null, folderState: 'no-folder', selectedRoot: null })}
        onShowInLibrary={vi.fn()}
        onOpenFolder={onOpenFolder}
      />,
    );

    expect(screen.getByTestId('photos-sidebar-no-folder')).toBeDefined();
    fireEvent.click(screen.getByTestId('photos-open-folder-action'));
    expect(onOpenFolder).toHaveBeenCalled();
  });

  it('renders a scan-this-folder CTA when the current folder has not been scanned yet', () => {
    const scanFolder = vi.fn();
    renderThemed(
      <PhotosSidebar
        state={baseState({ roots: [], folder: '/a/b', folderState: 'unscanned', selectedRoot: null, scanFolder })}
        onShowInLibrary={vi.fn()}
        onOpenFolder={vi.fn()}
      />,
    );

    expect(screen.getByTestId('photos-sidebar-unscanned')).toBeDefined();
    expect(screen.getAllByText('b').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId('photos-scan-action'));
    expect(scanFolder).toHaveBeenCalled();
  });

  it('shows the folder header with root name and path, and calls onShowInLibrary', () => {
    const onShowInLibrary = vi.fn();
    renderThemed(<PhotosSidebar state={baseState()} onShowInLibrary={onShowInLibrary} onOpenFolder={vi.fn()} />);

    expect(screen.getAllByText('media').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId('photos-folder-show-in-library'));
    expect(onShowInLibrary).toHaveBeenCalledWith('/media');
  });

  it('row click selects the fingerprint and badges render per item state', () => {
    const selectFingerprint = vi.fn();
    const items = [
      item({ fingerprint: 'a', analysed: true }),
      item({ fingerprint: 'b', sightings: 2 }),
      item({ fingerprint: 'c', proxyState: 'failed' }),
      item({ fingerprint: 'd', exifReadAt: null }),
      item({ fingerprint: 'e', missingAt: 123 }),
      item({ fingerprint: 'f' }),
    ];
    renderThemed(<PhotosSidebar state={baseState({ items, selectFingerprint })} onShowInLibrary={vi.fn()} onOpenFolder={vi.fn()} />);

    const rows = screen.getAllByTestId('photos-sidebar-row');
    expect(rows).toHaveLength(6);
    const firstRow = rows[0];
    if (firstRow === undefined) throw new Error('missing row');
    fireEvent.click(firstRow);
    expect(selectFingerprint).toHaveBeenCalledWith('a');
  });

  it('renders the small thumbnail, not the 512px grid thumbnail, for a sidebar row', () => {
    renderThemed(
      <PhotosSidebar
        state={baseState({
          items: [
            item({
              fingerprint: 'a',
              thumbPath: '/artifacts/thumbs/a.jpg',
              gridThumbPath: '/artifacts/thumbs/a.grid.jpg',
            }),
          ],
        })}
        onShowInLibrary={vi.fn()}
        onOpenFolder={vi.fn()}
      />,
    );

    const row = screen.getAllByTestId('photos-sidebar-row')[0];
    if (row === undefined) throw new Error('missing row');
    const image = row.querySelector('img');
    expect(image?.getAttribute('src')).toContain(encodeURIComponent('/artifacts/thumbs/a.jpg'));
    expect(image?.getAttribute('src')).not.toContain('grid.jpg');
  });

  it('renders the capture date localized instead of a raw ISO timestamp', () => {
    renderThemed(<PhotosSidebar
      state={baseState({ items: [item({ fingerprint: 'a', capturedAt: '2026-08-10T17:46:06.740Z' })] })}
      onShowInLibrary={vi.fn()}
      onOpenFolder={vi.fn()}
    />);

    const row = screen.getAllByTestId('photos-sidebar-row')[0];
    if (row === undefined) throw new Error('missing row');
    expect(row.textContent).not.toContain('2026-08-10T17:46:06.740Z');
    expect(row.textContent).toContain(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date('2026-08-10T17:46:06.740Z')));
  });

  it('renders every sidebar badge through the shared status-badge component, with an icon and the video-parity label for analysed', () => {
    const items = [
      item({ fingerprint: 'a', analysed: true }),
      item({ fingerprint: 'b', sightings: 2 }),
      item({ fingerprint: 'c', proxyState: 'failed' }),
      item({ fingerprint: 'd', exifReadAt: null }),
      item({ fingerprint: 'e', missingAt: 123 }),
    ];
    renderThemed(<PhotosSidebar state={baseState({ items })} onShowInLibrary={vi.fn()} onOpenFolder={vi.fn()} />);

    const analysedBadge = screen.getByTestId('photos-sidebar-badge-analysed');
    expect(analysedBadge.hasAttribute('data-status-badge')).toBe(true);
    expect(analysedBadge.querySelector('svg')).not.toBeNull();
    expect(analysedBadge.textContent).toBe('Completed');

    for (const badge of ['duplicate', 'proxyFailed', 'exifMissing', 'missing']) {
      const chip = screen.getByTestId(`photos-sidebar-badge-${badge}`);
      expect(chip.hasAttribute('data-status-badge')).toBe(true);
      expect(chip.querySelector('svg')).not.toBeNull();
    }

    for (const badge of ['analysed', 'duplicate', 'proxyFailed', 'exifMissing', 'missing']) {
      const icon = screen.getByTestId(`photos-sidebar-badge-${badge}`).querySelector('svg');
      expect(icon?.classList.contains('MuiChip-icon')).toBe(true);
    }
  });

  it('marks only the in-flight rows whose fingerprint is currently being analyzed', () => {
    const items = [
      item({ fingerprint: 'a' }),
      item({ fingerprint: 'b' }),
      item({ fingerprint: 'c' }),
    ];
    renderThemed(
      <PhotosSidebar state={baseState({ items, processingFingerprints: new Set(['b']) })} onShowInLibrary={vi.fn()} onOpenFolder={vi.fn()} />,
    );

    const rows = screen.getAllByTestId('photos-sidebar-row');
    expect(rows.map((row) => row.getAttribute('data-processing'))).toEqual(['false', 'true', 'false']);
    expect(screen.getAllByTestId('photos-sidebar-row-inflight')).toHaveLength(1);
  });

  it('shows no in-flight rows when no analyze job is running', () => {
    const items = [item({ fingerprint: 'a' }), item({ fingerprint: 'b' })];
    renderThemed(<PhotosSidebar state={baseState({ items })} onShowInLibrary={vi.fn()} onOpenFolder={vi.fn()} />);

    expect(screen.queryByTestId('photos-sidebar-row-inflight')).toBeNull();
  });

  it('shows a load-more button when hasMore is true and calls through', () => {
    const loadMore = vi.fn();
    renderThemed(<PhotosSidebar state={baseState({ items: [item({ fingerprint: 'a' })], hasMore: true, loadMore })} onShowInLibrary={vi.fn()} onOpenFolder={vi.fn()} />);

    fireEvent.click(screen.getByTestId('photos-sidebar-load-more'));
    expect(loadMore).toHaveBeenCalled();
  });
});
