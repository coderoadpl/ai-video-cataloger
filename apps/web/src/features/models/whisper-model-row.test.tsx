import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { createAppTheme } from '../../theme.js';
import { WhisperModelRow } from './WhisperModelRow.js';
import { type WhisperModelEntry } from './models-model.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) => renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

const model: WhisperModelEntry = { name: 'small', size: '466 MB', downloaded: true, active: false };

const renderRow = (onActivate: () => void) =>
  renderThemed(
    <WhisperModelRow
      model={model}
      activating={false}
      deleting={false}
      downloadPercentage={null}
      disabled={false}
      onActivate={onActivate}
      onDownload={vi.fn()}
      onDelete={vi.fn()}
    />,
  );

describe('WhisperModelRow keyboard activation', () => {
  it('activates a downloaded inactive model with Enter and Space', () => {
    const onActivate = vi.fn();
    renderRow(onActivate);
    const row = screen.getByTestId('whisper-model-row');

    expect(row.getAttribute('role')).toBe('button');
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });

    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('ignores other keys', () => {
    const onActivate = vi.fn();
    renderRow(onActivate);

    fireEvent.keyDown(screen.getByTestId('whisper-model-row'), { key: 'a' });

    expect(onActivate).not.toHaveBeenCalled();
  });
});
