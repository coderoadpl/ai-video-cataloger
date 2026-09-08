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
  it('shows the scoped pending count on the action button and triggers analyze', async () => {
    const onAnalyze = vi.fn();
    renderThemed(
      <ScopeAnalyzeToolbar
        pendingCount={4}
        isBusy={false}
        progress={null}
        onAnalyze={onAnalyze}
        onStop={vi.fn()}
      />,
    );

    expect(screen.getByTestId('analyze-all-button').textContent).toContain(en.batchToolbar.analyzeAll(4));

    await userEvent.click(screen.getByTestId('analyze-all-button'));
    expect(onAnalyze).toHaveBeenCalledOnce();
  });

  it('renders an approximate up-to count for an unindexed tree and triggers analyze', async () => {
    const onAnalyze = vi.fn();
    renderThemed(
      <ScopeAnalyzeToolbar
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

  it('says the errored rows are not re-attempted next to the pending-only count', () => {
    renderThemed(
      <ScopeAnalyzeToolbar
        pendingCount={2}
        erroredCount={1}
        isBusy={false}
        progress={null}
        onAnalyze={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(screen.getByTestId('analyze-all-button').textContent).toContain(en.batchToolbar.analyzeAll(2));
    expect(screen.getByTestId('analyze-errored-hint').textContent).toBe(en.batchToolbar.analyzeSkipsErrored(1));
  });

  it('keeps the errored explanation when nothing is pending any more', () => {
    renderThemed(
      <ScopeAnalyzeToolbar
        pendingCount={0}
        erroredCount={3}
        isBusy={false}
        progress={null}
        onAnalyze={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('analyze-all-button')).toBeNull();
    expect(screen.getByTestId('analyze-errored-hint').textContent).toBe(en.batchToolbar.analyzeSkipsErrored(3));
  });

  it('stays silent when no row errored', () => {
    renderThemed(
      <ScopeAnalyzeToolbar
        pendingCount={2}
        isBusy={false}
        progress={null}
        onAnalyze={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('analyze-errored-hint')).toBeNull();
  });

  it('renders the batch wait state over any per-file bar and keeps Stop wired', async () => {
    const onStop = vi.fn();
    renderThemed(
      <ScopeAnalyzeToolbar
        pendingCount={0}
        isBusy
        progress={{ currentIndex: 2, totalCount: 5, currentFilename: 'clip.mp4' }}
        batchWait={{ requestCount: 7 }}
        onAnalyze={vi.fn()}
        onStop={onStop}
      />,
    );

    const wait = screen.getByTestId('batch-wait');
    expect(wait.textContent).toContain(en.processing.driveBatchWaiting(7));
    expect(wait.textContent).toContain(en.batchToolbar.batchWaitHint);
    expect(screen.queryByText(en.batchToolbar.processingCount(2, 5))).toBeNull();
    await userEvent.click(screen.getByTestId('analyze-stop-button'));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('renders live progress and wires Stop while a run is active', async () => {
    const onStop = vi.fn();
    renderThemed(
      <ScopeAnalyzeToolbar
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
