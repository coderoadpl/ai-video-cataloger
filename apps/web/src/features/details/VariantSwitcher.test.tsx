import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { createAppTheme } from '../../theme.js';
import { VariantSwitcher } from './VariantSwitcher.js';
import type { VariantsState } from './use-variants.js';

const theme = createAppTheme('light');
const renderThemed = (ui: Parameters<typeof renderWithProviders>[0]) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

const baseState = (overrides: Partial<VariantsState> = {}): VariantsState => ({
  data: null,
  previewVariant: null,
  preview: null,
  plan: null,
  loading: false,
  loadError: null,
  actionError: null,
  selectingConfigId: null,
  settingFolderDefault: false,
  comparing: false,
  retryLoad: vi.fn(),
  previewConfig: vi.fn(),
  showComparison: vi.fn(),
  hideComparison: vi.fn(),
  useAsSelected: vi.fn(),
  usePreviewAsSelected: vi.fn(),
  useCurrentAsFolderDefault: vi.fn(),
  ...overrides,
});

describe('VariantSwitcher', () => {
  it('renders a persistent load-error state as a neutral Paper section, not a tinted alert', () => {
    const retryLoad = vi.fn();
    renderThemed(<VariantSwitcher state={baseState({ loadError: new Error('boom'), retryLoad })} />);

    const notice = screen.getByText('Could not load analysis variants.').closest('[data-testid="variant-load-error"]');
    expect(notice).not.toBeNull();
    expect(notice?.getAttribute('role')).not.toBe('alert');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retryLoad).toHaveBeenCalled();
  });
});
