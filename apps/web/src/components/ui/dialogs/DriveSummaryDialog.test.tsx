import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../../test/render.js';
import { createAppTheme } from '../../../theme.js';
import { DriveSummaryDialog } from './DriveSummaryDialog.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) => renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

describe('DriveSummaryDialog', () => {
  it('renders folder-run counts when open', () => {
    renderThemed(
      <DriveSummaryDialog
        open
        counts={{
          foldersDone: 3,
          filesDone: 5,
          filesSkipped: 2,
          filesFailed: 1,
          estimatedCostUsd: 0.1234,
          costedFiles: 3,
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId('drive-folders-count').textContent).toBe('3');
    expect(screen.getByTestId('drive-analyzed-count').textContent).toBe('5');
    expect(screen.getByTestId('drive-skipped-count').textContent).toBe('2');
    expect(screen.getByTestId('drive-failed-count').textContent).toBe('1');
    expect(screen.getByTestId('drive-estimated-cost').textContent).toBe('$0.1234');
  });

  it('renders nothing when there are no counts', () => {
    renderThemed(<DriveSummaryDialog open counts={null} onClose={vi.fn()} />);
    expect(screen.queryByTestId('drive-summary-dialog')).toBeNull();
  });

  it('omits the estimate when no files have authoritative pricing', () => {
    renderThemed(
      <DriveSummaryDialog
        open
        counts={{
          foldersDone: 1,
          filesDone: 1,
          filesSkipped: 0,
          filesFailed: 0,
          estimatedCostUsd: null,
          costedFiles: 0,
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('drive-estimated-cost')).toBeNull();
  });
});
