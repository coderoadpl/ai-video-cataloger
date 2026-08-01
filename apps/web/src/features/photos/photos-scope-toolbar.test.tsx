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
  selectedRoot: '/media',
  selectRoot: vi.fn(),
  items: [],
  total: 0,
  hasMore: false,
  isLoadingMore: false,
  loadMore: vi.fn(),
  counts: { photos: 1, paths: 1, proxied: 1, proxyFailed: 0 },
  selectedFingerprint: null,
  selectFingerprint: vi.fn(),
  activeJobLabel: null,
  isBusy: false,
  scanFolder: vi.fn(),
  detail: null,
  isDetailLoading: false,
  variants: [],
  selectVariant: vi.fn(),
  analyzePhotos: vi.fn(),
  canAnalyze: true,
  analyzeProgress: null,
  generateProxies: vi.fn(),
  ...overrides,
});

describe('PhotosScopeToolbar', () => {
  it('scope toggle switches between folder and all scope', () => {
    const setScope = vi.fn();
    renderThemed(<PhotosScopeToolbar state={baseState({ setScope })} />);

    fireEvent.click(screen.getByTestId('photos-scope-all'));
    expect(setScope).toHaveBeenCalledWith('all');
  });

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
});
