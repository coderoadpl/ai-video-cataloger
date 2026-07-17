import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { bridge } from '../../api.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { AppShell } from './AppShell.js';
import { type ShellState, useShell } from './use-shell.js';

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

  it('renders folder-open failures as an alert', () => {
    renderWithProviders(
      <AppShell
        shell={{ ...stubShell, folderError: 'Folder no longer exists' }}
        sidebar={<div />}
        content={<div />}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain('Folder no longer exists');
  });

  it('does not select a folder when its safety check fails', async () => {
    server.use(
      http.get('/api/check', () => HttpResponse.json(
        { ok: false, error: { code: 'folder_not_found', message: 'Folder no longer exists' } },
        { status: 404 },
      )),
    );
    const setCurrent = vi.spyOn(bridge.folder, 'setCurrent');
    const Probe = () => {
      const shell = useShell();
      return (
        <>
          <button type="button" onClick={() => shell.selectRecentFolder('/deleted')}>Open recent</button>
          <span>{shell.folderError}</span>
        </>
      );
    };
    renderWithProviders(<Probe />);

    fireEvent.click(screen.getByRole('button', { name: 'Open recent' }));

    await waitFor(() => expect(screen.getByText('Folder no longer exists')).toBeDefined());
    expect(setCurrent).not.toHaveBeenCalled();
    setCurrent.mockRestore();
  });
});
