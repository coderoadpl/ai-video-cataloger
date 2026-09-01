import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import type { photoListItemSchema } from '@core/contract/index.js';

import { renderWithProviders } from '../../test/render.js';
import { createAppTheme } from '../../theme.js';
import { PhotosWorkspace } from './PhotosWorkspace.js';
import type { PhotosAnalysisState } from './use-photos-analysis.js';

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
  thumbPath: `/artifacts/thumbs/${overrides.fingerprint}.jpg`,
  gridThumbPath: null,
  proxyPath: `/artifacts/proxies/${overrides.fingerprint}.jpg`,
  analysed: false,
  analysisError: null,
  exifReadAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const detailFor = (photoItem: PhotoListItem) => ({
  media: 'photo' as const,
  photo: {
    fingerprint: photoItem.fingerprint,
    folderId: 'folder-1',
    fileName: photoItem.fileName,
    currentPath: photoItem.currentPath,
    ext: photoItem.ext,
    size: 1024,
    width: photoItem.width,
    height: photoItem.height,
    orientation: null,
    cameraMake: null,
    cameraModel: null,
    lens: null,
    iso: null,
    fNumber: null,
    exposureTime: null,
    exifRating: null,
    capturedAt: photoItem.capturedAt,
    capturedAtSource: photoItem.capturedAtSource,
    discoveredAt: '2026-01-01T00:00:00.000Z',
    exifReadAt: '2026-01-01T00:00:00.000Z',
    proxyState: photoItem.proxyState,
    proxyWidth: null,
    proxyHeight: null,
    thumbState: photoItem.thumbState,
    missingAt: photoItem.missingAt,
  },
  sightings: [{ currentPath: photoItem.currentPath, folderId: 'folder-1', lastSeenAt: '2026-01-01T00:00:00.000Z' }],
  ownerPath: photoItem.currentPath,
  proxyPath: photoItem.proxyPath,
  thumbPath: photoItem.thumbPath,
  gridThumbPath: photoItem.gridThumbPath,
  analysis: null,
  analysisError: photoItem.analysisError,
});

const analysedVariant = {
  configId: 'cfg_ab12cd34ef56',
  label: 'harness · claude-code · en',
  description: 'a red bicycle',
  scene: 'urban' as const,
  quality: 'good' as const,
  tags: ['bicycle'],
  batchSize: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  variantCount: 2,
  explicit: false,
};

const variantRecord = {
  configId: 'cfg_ba21dc43fe65',
  label: 'harness · claude-code · pl',
  description: 'rower',
  scene: 'urban' as const,
  quality: 'good' as const,
  language: 'pl',
  analyzer: 'harness',
  model: 'claude-code',
  batchSize: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  tags: ['rower'],
  selected: false,
  explicit: false,
};

const baseState = (overrides: Partial<PhotosAnalysisState> = {}): PhotosAnalysisState => ({
  isLoading: false,
  error: null,
  roots: [{ root: '/media', photos: 1, missing: 0, lastScanAt: '2026-01-01T00:00:00.000Z' }],
  scope: 'folder',
  setScope: vi.fn(),
  folder: '/media',
  folderState: 'scanned',
  selectedRoot: '/media',
  treeRoot: null,
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

describe('PhotosWorkspace', () => {
  it('renders the shared select-a-file empty state when nothing is selected', () => {
    const items = [item({ fingerprint: 'ph_0000000000000001' })];
    renderThemed(<PhotosWorkspace active state={baseState({ items, total: 1 })} />);

    expect(screen.getByTestId('photos-workspace-empty')).toBeDefined();
    expect(screen.getByTestId('analysis-empty-state').textContent).toContain(
      'Select a photo from the list on the left to see its details.',
    );
    expect(screen.queryByTestId('photos-analysis-detail')).toBeNull();
  });

  it('renders the shared medium-empty state when the open folder has no photos', () => {
    renderThemed(<PhotosWorkspace active state={baseState({
      counts: { photos: 0, paths: 0, proxied: 0, proxyFailed: 0 },
    })} />);

    expect(screen.getByTestId('analysis-empty-state').textContent).toContain(
      'No photos were found in this folder.',
    );
  });

  it('renders the welcome screen instead of an empty-selection prompt when no folder is open', () => {
    renderThemed(<PhotosWorkspace active state={baseState({
      folder: null,
      folderState: 'no-folder',
      selectedRoot: null,
    })} />);

    expect(screen.getByText('Welcome to AI Video Cataloger')).toBeDefined();
    expect(screen.queryByTestId('analysis-empty-state')).toBeNull();
  });

  it('renders the detail with the analyze strip for an unanalyzed selected photo', () => {
    const items = [item({ fingerprint: 'ph_0000000000000001' })];
    const firstItem = items[0];
    if (firstItem === undefined) throw new Error('missing item');
    renderThemed(<PhotosWorkspace
      active
      state={baseState({ items, selectedFingerprint: 'ph_0000000000000001', detail: detailFor(firstItem) })}
    />);

    expect(screen.getByTestId('photos-analysis-detail')).toBeDefined();
    const strip = screen.getByTestId('photos-analyze-strip');
    expect(strip).toBeDefined();
    expect(strip.getAttribute('data-detail-status-card')).toBe('true');
    expect(strip.getAttribute('role')).not.toBe('alert');
    expect(screen.getByTestId('photos-analyze-action').textContent).toBe('Analyze');
    expect(screen.queryByTestId('photos-workspace-empty')).toBeNull();
  });

  it('renders a sanitized persisted analysis error card with a retry action', () => {
    const items = [item({
      fingerprint: 'ph_0000000000000001',
      analysisError: {
        code: 'processing_error',
        message: 'Command failed: secret provider response from /Users/provider/private/output.txt',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    })];
    const firstItem = items[0];
    if (firstItem === undefined) throw new Error('missing item');
    const analyzeSelectedPhoto = vi.fn();
    renderThemed(<PhotosWorkspace
      active
      state={baseState({
        items,
        selectedFingerprint: firstItem.fingerprint,
        detail: detailFor(firstItem),
        analyzeSelectedPhoto,
      })}
    />);

    const card = screen.getByTestId('photo-analysis-error-card');
    expect(card.getAttribute('data-detail-status-card')).toBe('true');
    expect(card.textContent).toContain('Analysis failed.');
    expect(card.textContent).not.toContain('secret provider response');
    expect(card.textContent).not.toContain('/Users/provider');
    expect(screen.getByTestId('photos-analyze-action').textContent).toBe('Analyze again');
    fireEvent.click(screen.getByTestId('photos-analyze-action'));
    expect(analyzeSelectedPhoto).toHaveBeenCalled();
  });

  it('renders the photo filename and path without a pending status badge in the detail header', () => {
    const items = [item({ fingerprint: 'ph_0000000000000001' })];
    const firstItem = items[0];
    if (firstItem === undefined) throw new Error('missing item');
    renderThemed(<PhotosWorkspace
      active
      state={baseState({ items, selectedFingerprint: firstItem.fingerprint, detail: detailFor(firstItem) })}
    />);

    expect(screen.getByRole('heading', { level: 1, name: firstItem.fileName })).toBeDefined();
    expect(within(screen.getByTestId('photos-detail-header')).getByTitle(firstItem.currentPath)).toBeDefined();
    expect(screen.queryByTestId('photos-detail-badge-pending')).toBeNull();
  });

  it('keeps the analyzed status badge in the photo detail header', () => {
    const items = [item({ fingerprint: 'ph_0000000000000001', analysed: true })];
    const firstItem = items[0];
    if (firstItem === undefined) throw new Error('missing item');
    renderThemed(<PhotosWorkspace
      active
      state={baseState({
        items,
        selectedFingerprint: firstItem.fingerprint,
        detail: { ...detailFor(firstItem), analysis: analysedVariant },
      })}
    />);

    expect(screen.getByTestId('photos-detail-badge-analysed').textContent).toContain('Analyzed');
  });

  it('renders photo information in an outlined metadata card with icon rows', () => {
    const items = [item({ fingerprint: 'ph_0000000000000001', width: 4032, height: 3024 })];
    const firstItem = items[0];
    if (firstItem === undefined) throw new Error('missing item');
    renderThemed(<PhotosWorkspace
      active
      state={baseState({ items, selectedFingerprint: firstItem.fingerprint, detail: detailFor(firstItem) })}
    />);

    expect(screen.getByRole('heading', { name: 'Photo Information' })).toBeDefined();
    expect(screen.getByTestId('photo-metadata-row-dimensions').textContent).toContain('4032×3024');
    expect(document.querySelectorAll('[data-detail-metadata-row="true"]')).toHaveLength(4);
  });

  it('renders the captured-at date formatted, never as a raw ISO timestamp', () => {
    const items = [item({ fingerprint: 'ph_0000000000000001', capturedAt: '2026-08-10T17:46:06.744Z' })];
    const firstItem = items[0];
    if (firstItem === undefined) throw new Error('missing item');
    renderThemed(<PhotosWorkspace
      active
      state={baseState({ items, selectedFingerprint: 'ph_0000000000000001', detail: detailFor(firstItem) })}
    />);

    const detail = screen.getByTestId('photos-analysis-detail');
    expect(detail.textContent).not.toContain('2026-08-10T17:46:06.744Z');
    expect(detail.textContent).toContain('10 Aug 2026');
  });

  it('renders the variant picker for an analyzed photo and selecting a variant calls through', async () => {
    const items = [item({ fingerprint: 'ph_0000000000000001', analysed: true })];
    const firstItem = items[0];
    if (firstItem === undefined) throw new Error('missing item');
    const selectVariant = vi.fn();
    renderThemed(<PhotosWorkspace
      active
      state={baseState({
        items,
        selectedFingerprint: 'ph_0000000000000001',
        detail: { ...detailFor(firstItem), analysis: analysedVariant },
        variants: [variantRecord],
        selectVariant,
      })}
    />);

    const picker = screen.getByTestId('photo-variant-picker');
    expect(screen.getByText('Analysis variant')).toBeDefined();
    expect(screen.queryByText('2 variants')).toBeNull();
    const control = screen.getByTestId('photo-variant-control');
    const caption = within(control).getByTestId('photo-variant-caption');
    expect(control.contains(picker)).toBe(true);
    expect(caption.textContent).toMatch(/^Agent harness · claude-code · English · /);
    expect(Array.from(control.children).indexOf(caption)).toBeGreaterThan(Array.from(control.children).indexOf(picker));
    const combobox = picker.querySelector('[role="combobox"]');
    if (combobox === null) throw new Error('missing combobox element');
    fireEvent.mouseDown(combobox);
    fireEvent.click(await screen.findByText('harness · claude-code · pl'));

    expect(selectVariant).toHaveBeenCalledWith('cfg_ba21dc43fe65');
    expect(screen.queryByTestId('photos-analyze-strip')).toBeNull();
  });

  it('renders description, scene, and quality in the shared summary-card pattern while tags stay outside', () => {
    const items = [item({ fingerprint: 'ph_0000000000000001', analysed: true })];
    const firstItem = items[0];
    if (firstItem === undefined) throw new Error('missing item');
    renderThemed(<PhotosWorkspace
      active
      state={baseState({
        items,
        selectedFingerprint: firstItem.fingerprint,
        detail: { ...detailFor(firstItem), analysis: analysedVariant },
      })}
    />);

    const card = screen.getByTestId('photo-description-card');
    expect(within(card).getByRole('heading', { name: 'Description' })).toBeDefined();
    expect(within(card).getByText('a red bicycle')).toBeDefined();
    expect(within(card).getByText('Urban')).toBeDefined();
    expect(within(card).getByText('Good')).toBeDefined();
    expect(within(card).queryByTestId('photo-tag-chip')).toBeNull();
    expect(screen.getByTestId('photo-tag-chip')).toBeDefined();
  });

  it('disables the analyze action instead of a silent no-op when canAnalyzeSelectedPhoto is false', () => {
    const items = [item({ fingerprint: 'ph_0000000000000001' })];
    const firstItem = items[0];
    if (firstItem === undefined) throw new Error('missing item');
    const analyzeSelectedPhoto = vi.fn();
    renderThemed(<PhotosWorkspace
      active
      state={baseState({
        items,
        selectedFingerprint: 'ph_0000000000000001',
        detail: detailFor(firstItem),
        canAnalyzeSelectedPhoto: false,
        analyzeSelectedPhoto,
      })}
    />);

    const button = screen.getByTestId('photos-analyze-action');
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.click(button);
    expect(analyzeSelectedPhoto).not.toHaveBeenCalled();
  });

  it('calls analyzeSelectedPhoto, not the root-wide analyzePhotos, from the detail pane analyze action', () => {
    const items = [item({ fingerprint: 'ph_0000000000000001' })];
    const firstItem = items[0];
    if (firstItem === undefined) throw new Error('missing item');
    const analyzeSelectedPhoto = vi.fn();
    const analyzePhotos = vi.fn();
    renderThemed(<PhotosWorkspace
      active
      state={baseState({
        items,
        selectedFingerprint: 'ph_0000000000000001',
        detail: detailFor(firstItem),
        analyzeSelectedPhoto,
        analyzePhotos,
      })}
    />);

    fireEvent.click(screen.getByTestId('photos-analyze-action'));

    expect(analyzeSelectedPhoto).toHaveBeenCalled();
    expect(analyzePhotos).not.toHaveBeenCalled();
  });

  it('uses a photo tag chip to request a Library tag search', () => {
    const items = [item({ fingerprint: 'ph_0000000000000001', analysed: true })];
    const firstItem = items[0];
    if (firstItem === undefined) throw new Error('missing item');
    const onSearchTag = vi.fn();
    renderThemed(<PhotosWorkspace
      active
      onSearchTag={onSearchTag}
      state={baseState({
        items,
        selectedFingerprint: 'ph_0000000000000001',
        detail: { ...detailFor(firstItem), analysis: analysedVariant },
      })}
    />);

    const chip = screen.getByTestId('photo-tag-chip');
    fireEvent.click(chip);
    expect(chip.className).toContain('clickable');
    expect(onSearchTag).toHaveBeenCalledWith('bicycle');
  });

  it('renders nothing when inactive', () => {
    renderThemed(<PhotosWorkspace active={false} state={baseState()} />);

    expect(screen.queryByTestId('photos-workspace-empty')).toBeNull();
    expect(screen.queryByTestId('photos-analysis-detail')).toBeNull();
  });
});
