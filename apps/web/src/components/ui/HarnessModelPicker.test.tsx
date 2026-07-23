import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders as renderWithClient } from '../../test/render.js';
import { createAppTheme } from '../../theme.js';
import { HarnessModelPicker } from './HarnessModelPicker.js';

const CLAUDE_MODELS = ['claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-5'];

const theme = createAppTheme('light');
const renderWithProviders = (ui: ReactElement) => renderWithClient(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

describe('HarnessModelPicker', () => {
  it('lists the curated models plus a default and a custom escape hatch', () => {
    renderWithProviders(
      <HarnessModelPicker harnessId="claude-code" curatedModels={CLAUDE_MODELS} model="" onModelChange={vi.fn()} />,
    );
    fireEvent.mouseDown(screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: 'Default (CLI-configured)' })).toBeDefined();
    for (const model of CLAUDE_MODELS) {
      expect(screen.getByRole('option', { name: model })).toBeDefined();
    }
    expect(screen.getByRole('option', { name: 'Advanced: custom model id…' })).toBeDefined();
  });

  it('reveals an unvalidated custom field and reports typed ids', () => {
    const onModelChange = vi.fn();
    renderWithProviders(
      <HarnessModelPicker harnessId="codex" curatedModels={['gpt-5.5']} model="" onModelChange={onModelChange} />,
    );
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'Advanced: custom model id…' }));

    expect(screen.getByTestId('harness-model-unvalidated')).toBeDefined();
    fireEvent.change(screen.getByLabelText('Custom model id'), { target: { value: 'my-fine-tune' } });
    expect(onModelChange).toHaveBeenCalledWith('my-fine-tune');
  });

  it('selecting a curated model reports that id', () => {
    const onModelChange = vi.fn();
    renderWithProviders(
      <HarnessModelPicker harnessId="claude-code" curatedModels={CLAUDE_MODELS} model="" onModelChange={onModelChange} />,
    );
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'claude-opus-4-8' }));
    expect(onModelChange).toHaveBeenCalledWith('claude-opus-4-8');
  });
});
