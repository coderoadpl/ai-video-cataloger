import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { bridge } from '../../api.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { useShell } from './use-shell.js';

describe('useShell', () => {
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

  it('opens a root whose nested catalogs are the ones this app wrote', async () => {
    server.use(http.get('/api/check', () => HttpResponse.json({
      ok: true,
      data: {
        hasNestedDatabases: false,
        nestedPaths: [],
        ownNestedPaths: ['/tree/clips/.ai-video-cataloger'],
        basePath: '/tree',
        scannedDirectories: 3,
      },
    })));
    const setCurrent = vi.spyOn(bridge.folder, 'setCurrent');
    renderWithProviders(<NestedProbe folder="/tree" />);

    fireEvent.click(screen.getByRole('button', { name: 'Open recent' }));

    await waitFor(() => expect(setCurrent).toHaveBeenCalledWith('/tree'));
    expect(screen.getByTestId('nested-open').textContent).toBe('closed');
    setCurrent.mockRestore();
  });

  it('keeps blocking a root that holds a foreign nested catalog', async () => {
    server.use(http.get('/api/check', () => HttpResponse.json({
      ok: true,
      data: {
        hasNestedDatabases: true,
        nestedPaths: ['/tree/foreign/.ai-video-cataloger'],
        ownNestedPaths: [],
        basePath: '/tree',
        scannedDirectories: 3,
      },
    })));
    const setCurrent = vi.spyOn(bridge.folder, 'setCurrent');
    renderWithProviders(<NestedProbe folder="/tree" />);

    fireEvent.click(screen.getByRole('button', { name: 'Open recent' }));

    await waitFor(() => expect(screen.getByTestId('nested-open').textContent).toBe('open'));
    expect(screen.getByText('/tree/foreign/.ai-video-cataloger')).toBeDefined();
    expect(setCurrent).not.toHaveBeenCalled();
    setCurrent.mockRestore();
  });

  it('surfaces a folderError when the bridge rejects setting the current folder', async () => {
    server.use(http.get('/api/check', () => HttpResponse.json({
      ok: true,
      data: {
        hasNestedDatabases: false,
        nestedPaths: [],
        ownNestedPaths: [],
        basePath: '/tree',
        scannedDirectories: 3,
      },
    })));
    const setCurrent = vi.spyOn(bridge.folder, 'setCurrent').mockRejectedValue(new Error('Not a valid folder'));
    const Probe = () => {
      const shell = useShell();
      return (
        <>
          <button type="button" onClick={() => shell.selectRecentFolder('/tree')}>Open recent</button>
          <span>{shell.folderError}</span>
        </>
      );
    };
    renderWithProviders(<Probe />);

    fireEvent.click(screen.getByRole('button', { name: 'Open recent' }));

    await waitFor(() => expect(screen.getByText('Not a valid folder')).toBeDefined());
    setCurrent.mockRestore();
  });

  it('surfaces a folderError when the folder picker itself rejects', async () => {
    const showPicker = vi.spyOn(bridge.folder, 'showPicker').mockRejectedValue(new Error('Picker unavailable'));
    const Probe = () => {
      const shell = useShell();
      return (
        <>
          <button type="button" onClick={shell.openFolder}>Open folder</button>
          <span>{shell.folderError}</span>
        </>
      );
    };
    renderWithProviders(<Probe />);

    fireEvent.click(screen.getByRole('button', { name: 'Open folder' }));

    await waitFor(() => expect(screen.getByText('Picker unavailable')).toBeDefined());
    showPicker.mockRestore();
  });

  it('surfaces a folderError instead of an unhandled rejection when clearing recent folders fails', async () => {
    const clearRecent = vi.spyOn(bridge.folder, 'clearRecent').mockRejectedValue(new Error('Clear failed'));
    const Probe = () => {
      const shell = useShell();
      return (
        <>
          <button type="button" onClick={shell.clearRecentFolders}>Clear recent</button>
          <span>{shell.folderError}</span>
        </>
      );
    };
    renderWithProviders(<Probe />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear recent' }));

    await waitFor(() => expect(screen.getByText('Clear failed')).toBeDefined());
    clearRecent.mockRestore();
  });
});

const NestedProbe = ({ folder }: { folder: string }) => {
  const shell = useShell();
  return (
    <>
      <button type="button" onClick={() => shell.selectRecentFolder(folder)}>Open recent</button>
      <span data-testid="nested-open">{shell.nestedDb.open ? 'open' : 'closed'}</span>
      {shell.nestedDb.paths.map((path) => <span key={path}>{path}</span>)}
    </>
  );
};
