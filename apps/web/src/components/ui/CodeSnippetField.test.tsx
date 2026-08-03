import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAppTheme } from '../../theme.js';
import { renderWithProviders } from '../../test/render.js';
import { CodeSnippetField } from './CodeSnippetField.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) => renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

const PATH = '/Users/example/repositories/videos/podfolder/very-long-original-filename.mp4';

afterEach(() => {
  vi.useRealTimers();
});

describe('CodeSnippetField', () => {
  it('renders the value in a monospace field with ellipsis overflow and the full value as a title', () => {
    renderThemed(<CodeSnippetField value={PATH} testId="canonical-path" />);

    const field = screen.getByTestId('canonical-path');
    expect(field.textContent).toBe(PATH);
    expect(field.getAttribute('title')).toBe(PATH);
    expect(field.tagName).toBe('CODE');
  });

  it('lays the value out as a zero-basis flex item, so a long path cannot widen the section that hosts it', () => {
    renderThemed(<CodeSnippetField value={PATH} testId="canonical-path" />);

    const style = getComputedStyle(screen.getByTestId('canonical-path'));
    expect(style.width).toBe('0px');
    expect(style.minWidth).toBe('0px');
    expect(style.overflow).toBe('hidden');
    expect(style.whiteSpace).toBe('nowrap');
    expect(style.textOverflow).toBe('ellipsis');
  });

  it('copies to the clipboard and shows copied feedback that reverts after a delay', () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderThemed(<CodeSnippetField value={PATH} testId="canonical-path" />);

    const copyButton = screen.getByTestId('canonical-path-copy');
    fireEvent.click(copyButton);

    expect(writeText).toHaveBeenCalledWith(PATH);
    expect(copyButton.getAttribute('aria-label')).toBe('Copied');

    act(() => { vi.advanceTimersByTime(2000); });
    expect(copyButton.getAttribute('aria-label')).toBe('Copy to clipboard');
  });
});
