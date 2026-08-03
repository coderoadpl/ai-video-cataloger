import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { createAppTheme } from '../../theme.js';
import { PhotosScopeToolbar } from './PhotosScopeToolbar.js';
import type { PhotosAnalysisState } from './use-photos-analysis.js';

const theme = createAppTheme('light');
const renderThemed = (ui: Parameters<typeof renderWithProviders>[0]) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

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
  counts: { photos: 1, paths: 1, proxied: 1, proxyFailed: 0 },
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

describe('PhotosScopeToolbar', () => {
  it('scan and analyze actions call through', () => {
    const scanFolder = vi.fn();
    const analyzePhotos = vi.fn();
    renderThemed(<PhotosScopeToolbar state={baseState({ scanFolder, analyzePhotos })} />);

    fireEvent.click(screen.getByTestId('photos-scan-action'));
    fireEvent.click(screen.getByTestId('photos-analyze-action'));

    expect(scanFolder).toHaveBeenCalled();
    expect(analyzePhotos).toHaveBeenCalled();
  });

  it('disables scan and analyze while busy', () => {
    renderThemed(<PhotosScopeToolbar state={baseState({ isBusy: true, activeJobLabel: 'Working…' })} />);

    expect(screen.getByTestId('photos-scan-action').getAttribute('disabled')).not.toBeNull();
    expect(screen.getByTestId('photos-analyze-action').getAttribute('disabled')).not.toBeNull();
  });

  it('disables scan while no folder is open', () => {
    renderThemed(<PhotosScopeToolbar state={baseState({ scope: 'all', folder: null, folderState: 'no-folder', selectedRoot: null })} />);

    expect(screen.getByTestId('photos-scan-action').getAttribute('disabled')).not.toBeNull();
  });

  it('disables analyze when no target folder resolves, even though a root is selected', () => {
    renderThemed(<PhotosScopeToolbar state={baseState({ scope: 'all', canAnalyze: false })} />);

    expect(screen.getByTestId('photos-analyze-action').getAttribute('disabled')).not.toBeNull();
  });

  it('shows the proxies-pending affordance when the root has photos but no proxies yet', () => {
    const generateProxies = vi.fn();
    renderThemed(<PhotosScopeToolbar state={baseState({
      counts: { photos: 3, paths: 3, proxied: 0, proxyFailed: 0 },
      generateProxies,
    })} />);

    fireEvent.click(screen.getByText('Generate proxies'));
    expect(generateProxies).toHaveBeenCalled();
  });

  it('hides the proxies-pending affordance once proxies exist', () => {
    renderThemed(<PhotosScopeToolbar state={baseState({
      counts: { photos: 3, paths: 3, proxied: 3, proxyFailed: 0 },
    })} />);

    expect(screen.queryByTestId('photos-proxies-pending')).toBeNull();
  });

  it('renders the dynamic per-photo progress count from the real job event stream, not a frozen 0-of-0 label', () => {
    renderThemed(<PhotosScopeToolbar state={baseState({
      isBusy: true,
      activeJobLabel: 'Analyzing 0 of 0…',
      analyzeStatusLabel: 'Analyzing 12 of 13…',
      analyzeProgress: { current: 12, total: 13 },
    })} />);

    expect(screen.getByTestId('photos-analyze-status-label').textContent).toBe('Analyzing 12 of 13…');
  });

  it('shows a cancel action for the running analyze job and fires requestCancelAnalysis on click', () => {
    const requestCancelAnalysis = vi.fn();
    renderThemed(<PhotosScopeToolbar state={baseState({
      isBusy: true,
      activeJobLabel: 'Analyzing 1 of 2…',
      analyzeStatusLabel: 'Analyzing 1 of 2…',
      analyzeProgress: { current: 1, total: 2 },
      isCancellable: true,
      requestCancelAnalysis,
    })} />);

    fireEvent.click(screen.getByTestId('photos-cancel-analysis-action'));
    expect(requestCancelAnalysis).toHaveBeenCalled();
  });

  it('hides the cancel action when the running job is not cancellable (e.g. scan or proxies)', () => {
    renderThemed(<PhotosScopeToolbar state={baseState({
      isBusy: true,
      activeJobLabel: 'Scanning…',
      analyzeStatusLabel: 'Scanning…',
      isCancellable: false,
    })} />);

    expect(screen.queryByTestId('photos-cancel-analysis-action')).toBeNull();
  });
});
