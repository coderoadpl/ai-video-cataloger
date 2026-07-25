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
});
