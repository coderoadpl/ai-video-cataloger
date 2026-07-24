import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { en } from '../../i18n/dictionary.js';
import { renderWithProviders } from '../../test/render.js';
import { createAppTheme } from '../../theme.js';
import { ScopeAnalyzeToolbar } from './ScopeAnalyzeToolbar.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) => renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

describe('ScopeAnalyzeToolbar', () => {
  it('switches scope and shows the scoped pending count on the action button', async () => {
    const onScopeChange = vi.fn();
    const onAnalyze = vi.fn();
    renderThemed(
      <ScopeAnalyzeToolbar
        scope="folder"
        onScopeChange={onScopeChange}
        pendingCount={4}
        isBusy={false}
        progress={null}
        onAnalyze={onAnalyze}
        onStop={vi.fn()}
      />,
    );

    expect(screen.getByTestId('analyze-all-button').textContent).toContain(en.batchToolbar.analyzeAll(4));

    await userEvent.click(screen.getByTestId('scope-tree'));
    expect(onScopeChange).toHaveBeenCalledWith('tree');

    await userEvent.click(screen.getByTestId('analyze-all-button'));
    expect(onAnalyze).toHaveBeenCalledOnce();
  });

  it('renders an approximate up-to count for an unindexed tree and triggers analyze', async () => {
    const onAnalyze = vi.fn();
    renderThemed(
      <ScopeAnalyzeToolbar
        scope="tree"
        onScopeChange={vi.fn()}
        pendingCount={200}
        isBusy={false}
        progress={null}
        onAnalyze={onAnalyze}
        onStop={vi.fn()}
        approximateCount
        canAnalyze
      />,
    );

    const button = screen.getByTestId('analyze-all-button');
    expect(button.textContent).toContain(en.batchToolbar.analyzeUpTo(200));
    await userEvent.click(button);
    expect(onAnalyze).toHaveBeenCalledOnce();
  });

  it('shows the analyze button when only unknown pending is present at a zero count', () => {
    renderThemed(
      <ScopeAnalyzeToolbar
        scope="tree"
        onScopeChange={vi.fn()}
        pendingCount={0}
        isBusy={false}
        progress={null}
        onAnalyze={vi.fn()}
        onStop={vi.fn()}
        approximateCount
        canAnalyze
      />,
    );

    expect(screen.getByTestId('analyze-all-button')).toBeDefined();
  });

  it('renders live progress and wires Stop while a run is active', async () => {
    const onStop = vi.fn();
    renderThemed(
      <ScopeAnalyzeToolbar
        scope="tree"
        onScopeChange={vi.fn()}
        pendingCount={0}
        isBusy
        progress={{ currentIndex: 2, totalCount: 5, currentFilename: 'clip.mp4' }}
        onAnalyze={vi.fn()}
        onStop={onStop}
      />,
    );

    expect(screen.getByText(en.batchToolbar.processingCount(2, 5))).toBeDefined();
    await userEvent.click(screen.getByTestId('analyze-stop-button'));
    expect(onStop).toHaveBeenCalledOnce();
  });
});
