import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import type { photoListItemSchema } from '@core/contract/index.js';

import { en } from '../../i18n/dictionary.js';
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
  treeRoot: {
    path: '/media', name: 'media', relativePath: '', root: '/media', depth: 0,
    directPhotoCount: 1, directAnalysedCount: 0, photoCount: 1, analysedCount: 0, children: [],
  },
  treeScopeAvailable: false,
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
  pendingCount: 1,
  analyzeSelectedPhoto: vi.fn(),
  canAnalyzeSelectedPhoto: true,
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
        onOpenFolder={onOpenFolder}
      />,
    );

    expect(screen.getByTestId('photos-sidebar-no-folder')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: en.folderBar.openFolder }));
    expect(onOpenFolder).toHaveBeenCalled();
  });

  it('renders an honest auto-scanning state for a folder that has not been scanned yet, with no CTA to click', () => {
    renderThemed(
      <PhotosSidebar
        state={baseState({ roots: [], folder: '/a/b', folderState: 'unscanned', selectedRoot: null })}
        onOpenFolder={vi.fn()}
      />,
    );

    expect(screen.getByTestId('photos-sidebar-unscanned')).toBeDefined();
    expect(screen.getAllByText('b').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('photos-folder-show-in-library')).toBeNull();
    expect(screen.queryByTestId('photos-scan-action')).toBeNull();
  });

  it('moves manual scan retry into the open-folder dropdown after auto-scan fails', () => {
    const scanFolder = vi.fn();
    renderThemed(
      <PhotosSidebar
        state={baseState({
          roots: [],
          folder: '/a/b',
          folderState: 'unscanned',
          selectedRoot: null,
          isBusy: false,
          error: 'Root not found: /a/b',
          scanFolder,
        })}
        onOpenFolder={vi.fn()}
      />,
    );

    expect(screen.getByTestId('photos-job-error').textContent).toContain('Root not found: /a/b');
    expect(screen.queryByTestId('photos-sidebar-scanning')).toBeNull();
    expect(screen.queryByTestId('photos-scan-action')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en.folderBar.folderActions }));
    fireEvent.click(screen.getByText(en.photosSidebar.scanCurrentFolderAction));
    expect(scanFolder).toHaveBeenCalled();
  });

  it('keeps the indexing caption while the auto-fired scan is still running despite an earlier error', () => {
    renderThemed(
      <PhotosSidebar
        state={baseState({
          roots: [],
          folder: '/a/b',
          folderState: 'unscanned',
          selectedRoot: null,
          isBusy: true,
          error: 'Root not found: /a/b',
        })}
        onOpenFolder={vi.fn()}
      />,
    );

    expect(screen.getByTestId('photos-sidebar-scanning')).toBeDefined();
    expect(screen.queryByTestId('photos-scan-action')).toBeNull();
  });

  it('shows the scan progress bar while the auto-fired scan job is running', () => {
    renderThemed(
      <PhotosSidebar
        state={baseState({ roots: [], folder: '/a/b', folderState: 'unscanned', selectedRoot: null, isBusy: true, activeJobLabel: 'Photos' })}
        onOpenFolder={vi.fn()}
      />,
    );

    expect(screen.getByTestId('photos-sidebar-scan-progress')).toBeDefined();
  });

  it('hides the scan progress bar once the auto-fired scan is not busy yet', () => {
    renderThemed(
      <PhotosSidebar
        state={baseState({ roots: [], folder: '/a/b', folderState: 'unscanned', selectedRoot: null, isBusy: false })}
        onOpenFolder={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('photos-sidebar-scan-progress')).toBeNull();
  });

  it('stacks the folder block above the medium toggle above the scoped content', () => {
    const onAnalysisMediaChange = vi.fn();
    const { container } = renderThemed(
      <PhotosSidebar
        state={baseState({ items: [item({ fingerprint: 'a' })], total: 1 })}
        onOpenFolder={vi.fn()}
        onAnalysisMediaChange={onAnalysisMediaChange}
        toolbar={<div data-testid="photos-scope-toolbar" />}
        scopeToggle={<div data-testid="photos-scope-toggle" />}
      />,
    );

    const order = Array.from(container.querySelectorAll('[data-testid]'))
      .map((element) => element.getAttribute('data-testid') ?? '');
    expect(order.indexOf('sidebar-folder-panel')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('sidebar-folder-panel')).toBeLessThan(order.indexOf('analysis-media-photos'));
    expect(order.indexOf('analysis-media-photos')).toBeLessThan(order.indexOf('photos-scope-toolbar'));

    const mediaToggle = screen.getByTestId('analysis-media-photos');
    const scopeToggle = screen.getByTestId('photos-scope-toggle');
    const mediaWrapper = mediaToggle.closest('.MuiBox-root');
    const scopeWrapper = scopeToggle.parentElement;
    expect(mediaWrapper?.parentElement).toBe(scopeWrapper?.parentElement);
    expect(mediaWrapper === null ? null : getComputedStyle(mediaWrapper).flexGrow).toBe('1');
    expect(scopeWrapper === null ? null : getComputedStyle(scopeWrapper).flexGrow).toBe('1');

    fireEvent.click(screen.getByTestId('analysis-media-videos'));
    expect(onAnalysisMediaChange).toHaveBeenCalledWith('videos');
  });

  it('shows the folder header with root name and path, and renders no show-in-library action', () => {
    renderThemed(<PhotosSidebar state={baseState()} onOpenFolder={vi.fn()} />);

    expect(screen.getAllByText('media').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('photos-folder-show-in-library')).toBeNull();
  });

  it('shows an honest empty state for a scanned folder with zero photos, not a bare section header', () => {
    renderThemed(<PhotosSidebar state={baseState()} onOpenFolder={vi.fn()} />);

    expect(screen.queryByTestId('photos-sidebar-section-header')).toBeNull();
    expect(screen.getByText(en.photos.emptyNoPhotos)).toBeDefined();
  });

  it('renders a scan/analyze/proxy job failure as an inline error strip, not just the terminal', () => {
    renderThemed(
      <PhotosSidebar
        state={baseState({ error: 'Analyze failed: ffmpeg exploded' })}
        onOpenFolder={vi.fn()}
      />,
    );

    expect(screen.getByTestId('photos-job-error').textContent).toContain('Analyze failed: ffmpeg exploded');
  });

  it('renders a failed scan of an unscanned folder as an inline error strip', () => {
    renderThemed(
      <PhotosSidebar
        state={baseState({
          roots: [],
          folder: '/a/b',
          folderState: 'unscanned',
          selectedRoot: null,
          error: 'Scan failed: permission denied',
        })}
        onOpenFolder={vi.fn()}
      />,
    );

    expect(screen.getByTestId('photos-job-error').textContent).toContain('Scan failed: permission denied');
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
    renderThemed(<PhotosSidebar state={baseState({ items, selectFingerprint })} onOpenFolder={vi.fn()} />);

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
      onOpenFolder={vi.fn()}
    />);

    const row = screen.getAllByTestId('photos-sidebar-row')[0];
    if (row === undefined) throw new Error('missing row');
    expect(row.textContent).not.toContain('2026-08-10T17:46:06.740Z');
    expect(row.textContent).toContain(new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date('2026-08-10T17:46:06.740Z')));
  });

  it('renders every sidebar badge through the shared status-badge component, with an icon and the video-parity label for analysed', () => {
    const items = [
      item({ fingerprint: 'a', analysed: true }),
      item({ fingerprint: 'b', sightings: 2 }),
      item({ fingerprint: 'c', proxyState: 'failed' }),
      item({ fingerprint: 'd', exifReadAt: null }),
      item({ fingerprint: 'e', missingAt: 123 }),
    ];
    renderThemed(<PhotosSidebar state={baseState({ items })} onOpenFolder={vi.fn()} />);

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

  it('nests the proxyFailed badge inside its own row so a row-scoped filter can skip it', () => {
    const items = [
      item({ fingerprint: 'broken', proxyState: 'failed' }),
      item({ fingerprint: 'usable' }),
    ];
    renderThemed(<PhotosSidebar state={baseState({ items })} onOpenFolder={vi.fn()} />);

    const rows = screen.getAllByTestId('photos-sidebar-row');
    expect(rows.map((row) => within(row).queryByTestId('photos-sidebar-badge-proxyFailed') !== null)).toEqual([true, false]);
  });

  it('marks only the in-flight rows whose fingerprint is currently being analyzed', () => {
    const items = [
      item({ fingerprint: 'a' }),
      item({ fingerprint: 'b' }),
      item({ fingerprint: 'c' }),
    ];
    renderThemed(
      <PhotosSidebar state={baseState({ items, processingFingerprints: new Set(['b']) })} onOpenFolder={vi.fn()} />,
    );

    const rows = screen.getAllByTestId('photos-sidebar-row');
    expect(rows.map((row) => row.getAttribute('data-processing'))).toEqual(['false', 'true', 'false']);
    expect(screen.getAllByTestId('photos-sidebar-row-inflight')).toHaveLength(1);
  });

  it('shows no in-flight rows when no analyze job is running', () => {
    const items = [item({ fingerprint: 'a' }), item({ fingerprint: 'b' })];
    renderThemed(<PhotosSidebar state={baseState({ items })} onOpenFolder={vi.fn()} />);

    expect(screen.queryByTestId('photos-sidebar-row-inflight')).toBeNull();
  });

  it('shows a load-more button when hasMore is true and calls through', () => {
    const loadMore = vi.fn();
    renderThemed(<PhotosSidebar state={baseState({ items: [item({ fingerprint: 'a' })], hasMore: true, loadMore })} onOpenFolder={vi.fn()} />);

    fireEvent.click(screen.getByTestId('photos-sidebar-load-more'));
    expect(loadMore).toHaveBeenCalled();
  });
});
