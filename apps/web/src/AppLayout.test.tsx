import { useState } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { AppLayout, type TerminalPanelState } from './AppLayout.js';
import { type LogLine } from './components/ui/use-terminal-log.js';
import { type ShellState } from './features/shell/use-shell.js';
import { en } from './i18n/dictionary.js';
import { renderWithProviders } from './test/render.js';
import { createAppTheme } from './theme.js';

const stubShell: ShellState = {
  appVersion: '1.2.3',
  currentFolder: null,
  recentFolders: [],
  isCheckingFolder: false,
  folderError: null,
  openFolder: () => undefined,
  selectRecentFolder: () => undefined,
  nestedDb: { open: false, paths: [] },
  closeNestedDb: () => undefined,
  closeFolderError: () => undefined,
};

const terminalPanel: TerminalPanelState = {
  lines: [],
  droppedCount: 0,
  onCopy: () => undefined,
  onClear: () => undefined,
};

const logLine: LogLine = {
  id: 'line-1',
  at: 1,
  content: 'scan started',
  type: 'info',
  raw: JSON.stringify({ step: 'scan' }, null, 2),
};

const apiLine: LogLine = {
  id: 'api-1-req',
  at: 0,
  content: '→ POST /api/v1/scan',
  type: 'stdout',
  raw: '→ POST /api/v1/scan\n{"root":"/clips"}',
};

const EMIT_LABEL = 'emit-line';
const RAW_MODE_KEY = 'avc.terminalRawMode';

interface TerminalHarnessProps {
  initialLines?: readonly LogLine[];
  apiLines?: readonly LogLine[];
  onCopy?: (text: string) => void;
}

const TerminalHarness = ({ initialLines = [], apiLines = [], onCopy }: TerminalHarnessProps) => {
  const [lines, setLines] = useState<readonly LogLine[]>(initialLines);
  return (
    <ThemeProvider theme={createAppTheme('light')}>
      <button type="button" onClick={() => setLines([logLine])}>
        {EMIT_LABEL}
      </button>
      <AppLayout
        shell={stubShell}
        sidebar={<div />}
        content={<div />}
        mode="analysis"
        onModeChange={() => undefined}
        analysisMedia="videos"
        onAnalysisMediaChange={() => undefined}
        terminal={{ ...terminalPanel, lines, apiLines, onCopy: onCopy ?? terminalPanel.onCopy }}
      />
    </ThemeProvider>
  );
};

const expandTerminal = () => {
  fireEvent.click(screen.getByRole('button', { name: en.appFrame.terminalExpand }));
};

describe('AppLayout composition', () => {
  beforeEach(() => {
    window.localStorage.removeItem(RAW_MODE_KEY);
  });

  it('renders the header, injected slots and terminal chrome', () => {
    renderWithProviders(
      <AppLayout
        shell={stubShell}
        sidebar={<div>sidebar-slot</div>}
        content={<div>content-slot</div>}
        mode="analysis"
        onModeChange={() => undefined}
        analysisMedia="videos"
        onAnalysisMediaChange={() => undefined}
      />,
    );

    expect(screen.getAllByText('AI Video Cataloger').length).toBeGreaterThan(0);
    expect(screen.getByText('v1.2.3')).toBeDefined();
    expect(screen.getByText('sidebar-slot')).toBeDefined();
    expect(screen.getByText('content-slot')).toBeDefined();
    expect(screen.getByText(en.appFrame.terminalTitle)).toBeDefined();
  });

  it('renders no terminal strip and no FolderBar in library mode', () => {
    renderWithProviders(
      <AppLayout
        shell={stubShell}
        sidebar={null}
        content={<div>content-slot</div>}
        mode="library"
        onModeChange={() => undefined}
        analysisMedia="videos"
        onAnalysisMediaChange={() => undefined}
      />,
    );

    expect(screen.queryByText(en.appFrame.terminalTitle)).toBeNull();
    expect(screen.queryByRole('button', { name: en.folderBar.openFolder })).toBeNull();
  });

  it('renders the terminal strip and the FolderBar in analysis mode', () => {
    renderWithProviders(
      <AppLayout
        shell={stubShell}
        sidebar={null}
        content={<div>content-slot</div>}
        mode="analysis"
        onModeChange={() => undefined}
        analysisMedia="videos"
        onAnalysisMediaChange={() => undefined}
      />,
    );

    expect(screen.getByText(en.appFrame.terminalTitle)).toBeDefined();
    expect(screen.getByRole('button', { name: en.folderBar.openFolder })).toBeDefined();
  });

  it('threads the analysis media toggle through to the header', () => {
    const onAnalysisMediaChange = () => undefined;
    renderWithProviders(
      <AppLayout
        shell={stubShell}
        sidebar={<div />}
        content={<div />}
        mode="analysis"
        onModeChange={() => undefined}
        analysisMedia="photos"
        onAnalysisMediaChange={onAnalysisMediaChange}
      />,
    );

    expect(screen.getByTestId('analysis-media-photos').getAttribute('aria-pressed')).toBe('true');
  });

  it('renders folder-open failures as an alert', () => {
    renderWithProviders(
      <AppLayout
        shell={{ ...stubShell, folderError: 'Folder no longer exists' }}
        sidebar={<div />}
        content={<div />}
        mode="analysis"
        onModeChange={() => undefined}
        analysisMedia="videos"
        onAnalysisMediaChange={() => undefined}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain('Folder no longer exists');
  });

  it('fills the banner slot above the content region', () => {
    renderWithProviders(
      <AppLayout
        shell={stubShell}
        sidebar={<div />}
        content={<div>content-slot</div>}
        mode="analysis"
        onModeChange={() => undefined}
        analysisMedia="videos"
        onAnalysisMediaChange={() => undefined}
        renderBanner={() => <div>banner-slot</div>}
      />,
    );

    const banner = screen.getByText('banner-slot');
    expect(banner.nextElementSibling?.textContent).toBe('content-slot');
  });

  it('translates the sidebar collapse affordances and reveals the rail on toggle', () => {
    renderWithProviders(
      <AppLayout shell={stubShell} sidebar={<div />} content={<div />} mode="analysis" onModeChange={() => undefined} analysisMedia="videos" onAnalysisMediaChange={() => undefined} />,
    );
    expect(screen.queryByRole('button', { name: en.appFrame.showSidebar })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: en.appFrame.hideSidebar }));

    expect(screen.getByRole('button', { name: en.appFrame.showSidebar })).toBeDefined();
  });

  it('offers copy and clear only when a terminal panel is wired', () => {
    const { unmount } = renderWithProviders(
      <AppLayout shell={stubShell} sidebar={<div />} content={<div />} mode="analysis" onModeChange={() => undefined} analysisMedia="videos" onAnalysisMediaChange={() => undefined} />,
    );
    expect(screen.queryByRole('button', { name: en.appFrame.terminalCopy })).toBeNull();
    unmount();

    const harness = renderWithProviders(<TerminalHarness initialLines={[logLine]} />);
    fireEvent.click(screen.getByRole('button', { name: en.appFrame.terminalExpand }));

    expect(screen.getByRole('button', { name: en.appFrame.terminalCopy })).toBeDefined();
    expect(screen.getByRole('button', { name: en.appFrame.terminalClear })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: en.appFrame.terminalCollapse }));

    expect(screen.queryByRole('button', { name: en.appFrame.terminalCopy })).toBeNull();
    expect(screen.getByRole('button', { name: en.appFrame.terminalExpand })).toBeDefined();
    harness.unmount();
  });

  it('starts the terminal panel collapsed regardless of buffered output', () => {
    renderWithProviders(<TerminalHarness initialLines={[logLine]} />);

    expect(screen.getByRole('button', { name: en.appFrame.terminalExpand })).toBeDefined();
    expect(screen.queryByRole('button', { name: en.appFrame.terminalCollapse })).toBeNull();
  });

  it('never auto-expands the terminal panel when output arrives after mount', () => {
    renderWithProviders(<TerminalHarness />);

    expect(screen.getByRole('button', { name: en.appFrame.terminalExpand })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: EMIT_LABEL }));

    expect(screen.getByRole('button', { name: en.appFrame.terminalExpand })).toBeDefined();
    expect(screen.queryByRole('button', { name: en.appFrame.terminalCollapse })).toBeNull();
  });

  it('toggles raw mode and renders the raw payload of a line once expanded', () => {
    renderWithProviders(<TerminalHarness initialLines={[logLine]} />);

    fireEvent.click(screen.getByRole('button', { name: en.appFrame.terminalExpand }));
    expect(screen.getByText('scan started')).toBeDefined();
    expect(screen.queryByText(logLine.raw ?? '')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: en.appFrame.terminalRaw }));

    expect(document.body.textContent).toContain(logLine.raw ?? '__missing__');
  });

  it('persists the raw-mode choice so a fresh mount starts in raw mode', () => {
    const first = renderWithProviders(<TerminalHarness initialLines={[logLine]} />);
    expandTerminal();
    fireEvent.click(screen.getByRole('button', { name: en.appFrame.terminalRaw }));

    expect(window.localStorage.getItem(RAW_MODE_KEY)).toBe('1');
    first.unmount();

    const second = renderWithProviders(<TerminalHarness initialLines={[logLine]} />);
    expandTerminal();

    expect(document.body.textContent).toContain(logLine.raw ?? '__missing__');
    expect(screen.queryByText('scan started')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: en.appFrame.terminalRaw }));
    expect(window.localStorage.getItem(RAW_MODE_KEY)).toBe('0');
    second.unmount();
  });

  it('copies the merged raw text that raw mode puts on screen', () => {
    const copied: string[] = [];
    renderWithProviders(
      <TerminalHarness initialLines={[logLine]} apiLines={[apiLine]} onCopy={(text) => copied.push(text)} />,
    );
    expandTerminal();

    fireEvent.click(screen.getByRole('button', { name: en.appFrame.terminalCopy }));
    expect(copied).toEqual(['scan started']);

    fireEvent.click(screen.getByRole('button', { name: en.appFrame.terminalRaw }));
    fireEvent.click(screen.getByRole('button', { name: en.appFrame.terminalCopy }));

    expect(copied.at(-1)).toBe(`${apiLine.raw ?? ''}\n${logLine.raw ?? ''}`);
  });
});
