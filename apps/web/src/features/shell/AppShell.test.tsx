import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { AppShell } from './AppShell.js';
import { type ShellState } from './use-shell.js';

const stubShell: ShellState = {
  appVersion: '1.2.3',
  currentFolder: null,
  recentFolders: [],
  isCheckingFolder: false,
  openFolder: () => undefined,
  selectRecentFolder: () => undefined,
  nestedDb: { open: false, paths: [] },
  closeNestedDb: () => undefined,
};

describe('AppShell', () => {
  it('renders the header, injected slots and terminal chrome', () => {
    renderWithProviders(
      <AppShell
        shell={stubShell}
        sidebar={<div>sidebar-slot</div>}
        content={<div>content-slot</div>}
      />,
    );

    expect(screen.getAllByText('AI Video Cataloger').length).toBeGreaterThan(0);
    expect(screen.getByText('v1.2.3')).toBeDefined();
    expect(screen.getByText('sidebar-slot')).toBeDefined();
    expect(screen.getByText('content-slot')).toBeDefined();
    expect(screen.getByText('Terminal')).toBeDefined();
  });
});
