import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createAppTheme } from '../../theme.js';
import { DriveToolbar } from './DriveToolbar.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

describe('DriveToolbar', () => {
  it('renders the tree button and triggers the action when idle', async () => {
    const onAnalyzeTree = vi.fn();
    renderThemed(<DriveToolbar onAnalyzeTree={onAnalyzeTree} isBusy={false} progress={null} />);

    const button = screen.getByTestId('analyze-tree-button');
    expect(button.textContent).toContain('Analyze all including subfolders');

    await userEvent.click(button);
    expect(onAnalyzeTree).toHaveBeenCalledOnce();
  });

  it('disables the button while a run is active', () => {
    renderThemed(<DriveToolbar onAnalyzeTree={vi.fn()} isBusy progress={null} />);
    expect(screen.getByTestId('analyze-tree-button').hasAttribute('disabled')).toBe(true);
  });

  it('disables the button when analysis is unavailable', () => {
    renderThemed(
      <DriveToolbar onAnalyzeTree={vi.fn()} isBusy={false} progress={null} disabledReason="Analysis unavailable" />,
    );
    expect(screen.getByTestId('analyze-tree-button').hasAttribute('disabled')).toBe(true);
  });

  it('renders the inline drive progress from run events', () => {
    renderThemed(
      <DriveToolbar
        onAnalyzeTree={vi.fn()}
        isBusy
        progress={{ currentFolder: 2, totalFolders: 5, filesDone: 13, filesSkipped: 3 }}
      />,
    );

    const status = screen.getByTestId('drive-progress');
    expect(status.textContent).toContain('Folder 2/5');
    expect(status.textContent).toContain('13 files done');
    expect(status.textContent).toContain('3 skipped');
  });
});
