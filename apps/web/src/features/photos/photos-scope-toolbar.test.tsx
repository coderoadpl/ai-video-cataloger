import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { en } from '../../i18n/dictionary.js';
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

describe('PhotosScopeToolbar', () => {
  it('renders the shared analyze-all action with the honest pending count', () => {
    const analyzePhotos = vi.fn();
    renderThemed(<PhotosScopeToolbar state={baseState({ analyzePhotos, pendingCount: 7 })} />);

    fireEvent.click(screen.getByTestId('photos-analyze-action'));

    expect(analyzePhotos).toHaveBeenCalled();
    expect(screen.getByTestId('photos-analyze-action').textContent).toContain(en.batchToolbar.analyzeAll(7));
    expect(screen.queryByTestId('photos-scan-action')).toBeNull();
  });

  it('hides the primary action while busy and shows progress instead', () => {
    renderThemed(<PhotosScopeToolbar state={baseState({ isBusy: true, activeJobLabel: 'Working…' })} />);

    expect(screen.queryByTestId('photos-analyze-action')).toBeNull();
    expect(screen.getByTestId('photos-analyze-status-label')).toBeDefined();
  });

  it('disables analyze when the current scope has no pending photos', () => {
    renderThemed(<PhotosScopeToolbar state={baseState({ canAnalyze: false, pendingCount: 0 })} />);

    expect(screen.getByTestId('photos-analyze-action').getAttribute('disabled')).not.toBeNull();
    expect(screen.getByTestId('photos-analyze-action').textContent).toContain(en.batchToolbar.analyzeAll(0));
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

  it('renders the proxies-pending state as a neutral Paper section, not a tinted alert', () => {
    renderThemed(<PhotosScopeToolbar state={baseState({
      counts: { photos: 3, paths: 3, proxied: 0, proxyFailed: 0 },
    })} />);

    expect(screen.getByTestId('photos-proxies-pending').getAttribute('role')).not.toBe('alert');
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
