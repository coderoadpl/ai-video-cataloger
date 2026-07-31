import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { en } from '../../i18n/dictionary.js';
import { renderWithProviders } from '../../test/render.js';
import { createAppTheme } from '../../theme.js';
import { BrowsePreview } from './BrowsePreview.js';
import type { PreviewMedia } from './core/index.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) => renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

const previewItem = (overrides: Partial<PreviewMedia> = {}): PreviewMedia => ({
  kind: 'video',
  fingerprint: 'fp-1',
  title: 'clip.mp4',
  path: '/videos/clip.mp4',
  folderPath: '/videos',
  online: true,
  missing: false,
  description: 'a description',
  tags: ['beach'],
  placeName: 'Fjordvik',
  capturedAt: '2026-01-02T10:00:00.000Z',
  ...overrides,
});

describe('BrowsePreview', () => {
  it('renders nothing when there is no item', () => {
    renderThemed(<BrowsePreview item={null} onClose={vi.fn()} onOpenInAnalysis={vi.fn()} />);
    expect(screen.queryByTestId('preview-player')).toBeNull();
  });

  it('renders the player and rows for an online item', () => {
    renderThemed(<BrowsePreview item={previewItem()} onClose={vi.fn()} onOpenInAnalysis={vi.fn()} />);

    expect(screen.getByTestId('preview-player')).toBeDefined();
    expect(screen.getByText('a description')).toBeDefined();
    expect(screen.getByText('beach')).toBeDefined();
    expect(screen.getByText('Fjordvik')).toBeDefined();
  });

  it('never renders analysis affordances', () => {
    renderThemed(<BrowsePreview item={previewItem()} onClose={vi.fn()} onOpenInAnalysis={vi.fn()} />);

    expect(screen.queryByTestId('variant-switcher')).toBeNull();
    expect(screen.queryByTestId('status-actions')).toBeNull();
    expect(screen.queryByTestId('photos-analyze-strip')).toBeNull();
    expect(screen.queryByTestId('photo-variant-picker')).toBeNull();
  });

  it('fires onOpenInAnalysis with folder path and file path, then closes', () => {
    const onOpenInAnalysis = vi.fn();
    const onClose = vi.fn();
    renderThemed(<BrowsePreview item={previewItem()} onClose={onClose} onOpenInAnalysis={onOpenInAnalysis} />);

    fireEvent.click(screen.getByTestId('preview-open-analysis'));

    expect(onOpenInAnalysis).toHaveBeenCalledWith('/videos', '/videos/clip.mp4');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('names the missing file instead of blaming a disconnected drive when the folder is online', () => {
    renderThemed(<BrowsePreview item={previewItem({ missing: true })} onClose={vi.fn()} onOpenInAnalysis={vi.fn()} />);

    expect(screen.queryByTestId('preview-player')).toBeNull();
    expect(screen.getByTestId('preview-unavailable').textContent).toBe(en.preview.missing);
  });

  it('renders no player and no active escape hatch link for an offline item', () => {
    renderThemed(<BrowsePreview item={previewItem({ online: false })} onClose={vi.fn()} onOpenInAnalysis={vi.fn()} />);

    expect(screen.queryByTestId('preview-player')).toBeNull();
    expect(screen.getByTestId('preview-unavailable').textContent).toBe(en.preview.offline);
    expect(screen.queryByTestId('preview-open-analysis')).toBeNull();
  });
});
