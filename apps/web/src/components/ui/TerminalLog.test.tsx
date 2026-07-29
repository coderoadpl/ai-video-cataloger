import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { en } from '../../i18n/dictionary.js';
import { renderWithProviders } from '../../test/render.js';
import { createAppTheme } from '../../theme.js';
import { TerminalLog } from './TerminalLog.js';
import type { LogLine } from './use-terminal-log.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) => renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

const jobLine: LogLine = {
  id: 'job-1',
  at: 100,
  content: 'progress 10% — transcribing',
  type: 'info',
  raw: JSON.stringify({ step: 'transcribe', percentage: 10 }, null, 2),
};

const apiLine: LogLine = {
  id: 'api-1',
  at: 200,
  content: '→ POST /api/v1/process',
  type: 'stdout',
  raw: '→ POST /api/v1/process\n{"videoPath":"a.mp4"}',
};

describe('TerminalLog', () => {
  it('renders the friendly content by default and hides api lines', () => {
    renderThemed(<TerminalLog lines={[jobLine]} apiLines={[apiLine]} />);

    expect(screen.getByText('progress 10% — transcribing')).toBeDefined();
    expect(screen.queryByText('→ POST /api/v1/process')).toBeNull();
  });

  it('renders raw payloads and interleaves api lines in raw mode', () => {
    renderThemed(<TerminalLog lines={[jobLine]} apiLines={[apiLine]} mode="raw" />);

    expect(document.body.textContent).toContain(JSON.stringify({ step: 'transcribe', percentage: 10 }, null, 2));
    expect(screen.getByText(/POST \/api\/v1\/process/)).toBeDefined();
  });

  it('renders the dropped-lines notice from the dictionary', () => {
    renderThemed(<TerminalLog lines={[jobLine]} droppedCount={7} />);

    expect(screen.getByText(en.appFrame.terminalDropped(7))).toBeDefined();
  });

  it('falls back to content in raw mode when a line has no raw payload', () => {
    const plain: LogLine = { id: 'p1', at: 1, content: 'plain', type: 'info', raw: null };
    renderThemed(<TerminalLog lines={[plain]} mode="raw" />);

    expect(screen.getByText('plain')).toBeDefined();
  });
});
