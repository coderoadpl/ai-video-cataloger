import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppShell, SIDEBAR_DEFAULT_SIZE, TERMINAL_DEFAULT_SIZE } from './AppShell.js';

type AppShellProps = Parameters<typeof AppShell>[0];

const renderShell = (overrides: Partial<AppShellProps> = {}) => {
  const props: AppShellProps = {
    header: <div>header-slot</div>,
    sidebarHeading: <h2>heading-slot</h2>,
    sidebarAction: <button type="button">hide-slot</button>,
    sidebarExpandAction: <button type="button">show-slot</button>,
    sidebar: <div>sidebar-slot</div>,
    sidebarCollapsed: false,
    sidebarWidth: SIDEBAR_DEFAULT_SIZE,
    onSidebarResize: () => undefined,
    content: <div>content-slot</div>,
    terminalTitle: <span>terminal-title-slot</span>,
    terminalActions: <button type="button">terminal-action-slot</button>,
    terminal: <div>terminal-slot</div>,
    terminalCollapsed: false,
    terminalHeight: TERMINAL_DEFAULT_SIZE,
    onTerminalResize: () => undefined,
    ...overrides,
  };
  return render(<AppShell {...props} />);
};

const separators = (orientation: 'vertical' | 'horizontal') =>
  screen
    .queryAllByRole('separator')
    .filter((element) => element.getAttribute('aria-orientation') === orientation);

describe('AppShell skeleton', () => {
  it('renders every slot it is given', () => {
    renderShell({ banner: <div>banner-slot</div> });

    for (const text of [
      'header-slot',
      'heading-slot',
      'hide-slot',
      'sidebar-slot',
      'banner-slot',
      'content-slot',
      'terminal-title-slot',
      'terminal-action-slot',
      'terminal-slot',
    ]) {
      expect(screen.getByText(text)).toBeDefined();
    }
  });

  it('renders no sidebar panel and no expand affordance when sidebar is null', () => {
    renderShell({ sidebar: null });

    expect(screen.queryByText('sidebar-slot')).toBeNull();
    expect(screen.queryByText('heading-slot')).toBeNull();
    expect(screen.queryByText('show-slot')).toBeNull();
    expect(separators('vertical')).toHaveLength(0);
    expect(screen.getByText('content-slot')).toBeDefined();
  });

  it('renders the content region without a banner when none is passed', () => {
    renderShell();

    expect(screen.queryByText('banner-slot')).toBeNull();
    expect(screen.getByText('content-slot')).toBeDefined();
  });

  it('renders the expand affordance only while the sidebar is collapsed', () => {
    const { unmount } = renderShell();
    expect(screen.queryByText('show-slot')).toBeNull();
    expect(separators('vertical')).toHaveLength(1);
    unmount();

    renderShell({ sidebarCollapsed: true });
    expect(screen.getByText('show-slot')).toBeDefined();
    expect(separators('vertical')).toHaveLength(0);
    expect(screen.getByText('content-slot')).toBeDefined();
  });

  it('drops the terminal resize handle while the terminal is collapsed', () => {
    const { unmount } = renderShell();
    expect(separators('horizontal')).toHaveLength(1);
    unmount();

    renderShell({ terminalCollapsed: true });
    expect(separators('horizontal')).toHaveLength(0);
    expect(screen.getByText('terminal-action-slot')).toBeDefined();
  });

  it('sizes the sidebar rail from the width prop', () => {
    renderShell({ sidebarWidth: 512 });

    const rail = separators('vertical')[0]?.parentElement;
    expect(rail).toBeDefined();
    expect(rail === null || rail === undefined ? '' : getComputedStyle(rail).width).toBe('512px');
  });

  it('reports sidebar drags through onSidebarResize, clamped to the layer limits', () => {
    const onSidebarResize = vi.fn();
    renderShell({ onSidebarResize });

    const handle = separators('vertical')[0];
    handle?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 400 }));
    window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 460 }));
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));

    expect(onSidebarResize).toHaveBeenCalledWith(SIDEBAR_DEFAULT_SIZE + 60);
  });
});
