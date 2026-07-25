import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AppLayout } from './AppLayout.js';
import { type ShellState } from './features/shell/use-shell.js';
import { en } from './i18n/dictionary.js';
import { renderWithProviders } from './test/render.js';

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

describe('AppLayout composition', () => {
  it('renders the header, injected slots and terminal chrome', () => {
    renderWithProviders(
      <AppLayout
        shell={stubShell}
        sidebar={<div>sidebar-slot</div>}
        content={<div>content-slot</div>}
      />,
    );

    expect(screen.getAllByText('AI Video Cataloger').length).toBeGreaterThan(0);
    expect(screen.getByText('v1.2.3')).toBeDefined();
    expect(screen.getByText('sidebar-slot')).toBeDefined();
    expect(screen.getByText('content-slot')).toBeDefined();
    expect(screen.getByText(en.appFrame.terminalTitle)).toBeDefined();
  });

  it('renders folder-open failures as an alert', () => {
    renderWithProviders(
      <AppLayout
        shell={{ ...stubShell, folderError: 'Folder no longer exists' }}
        sidebar={<div />}
        content={<div />}
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
        renderBanner={() => <div>banner-slot</div>}
      />,
    );

    const banner = screen.getByText('banner-slot');
    expect(banner.nextElementSibling?.textContent).toBe('content-slot');
  });

  it('translates the sidebar collapse affordances and reveals the rail on toggle', () => {
    renderWithProviders(
      <AppLayout shell={stubShell} sidebar={<div />} content={<div />} />,
    );
    expect(screen.queryByRole('button', { name: en.appFrame.showSidebar })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: en.appFrame.hideSidebar }));

    expect(screen.getByRole('button', { name: en.appFrame.showSidebar })).toBeDefined();
  });

  it('offers copy and clear only when a terminal panel is wired', () => {
    const { unmount } = renderWithProviders(
      <AppLayout shell={stubShell} sidebar={<div />} content={<div />} />,
    );
    expect(screen.queryByRole('button', { name: en.appFrame.terminalCopy })).toBeNull();
    unmount();

    renderWithProviders(
      <AppLayout
        shell={stubShell}
        sidebar={<div />}
        content={<div />}
        terminal={{
          lines: [],
          droppedCount: 0,
          onCopy: () => undefined,
          onClear: () => undefined,
        }}
      />,
    );

    expect(screen.getByRole('button', { name: en.appFrame.terminalCopy })).toBeDefined();
    expect(screen.getByRole('button', { name: en.appFrame.terminalClear })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: en.appFrame.terminalCollapse }));

    expect(screen.queryByRole('button', { name: en.appFrame.terminalCopy })).toBeNull();
    expect(screen.getByRole('button', { name: en.appFrame.terminalExpand })).toBeDefined();
  });
});
