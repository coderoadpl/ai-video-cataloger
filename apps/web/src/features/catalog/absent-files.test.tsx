import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { en } from '../../i18n/dictionary.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { AbsentFilesSection } from './AbsentFilesSection.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

const FOLDER = '/videos';

interface CatalogFolderRecord {
  fingerprint: string;
  fileName: string;
  finalName: string | null;
  missing: boolean;
  missingAt: number | null;
}

const catalogFolderOk = (records: CatalogFolderRecord[]) =>
  http.get('/api/catalog-folder', () => HttpResponse.json({ ok: true, data: { records } }));

describe('absent files section', () => {
  it('lists absent catalog entries and forgets one after confirmation', async () => {
    const forgetBodies: unknown[] = [];
    server.use(
      catalogFolderOk([
        { fingerprint: 'fp-missing', fileName: 'gone.mp4', finalName: null, missing: true, missingAt: 1738368000000 },
        { fingerprint: 'fp-present', fileName: 'here.mp4', finalName: null, missing: false, missingAt: null },
      ]),
      http.post('/api/index/forget', async ({ request }) => {
        forgetBodies.push(await request.json());
        return HttpResponse.json({ ok: true, data: { fingerprint: 'fp-missing', deleted: true, folderId: null } });
      }),
    );

    renderThemed(<AbsentFilesSection folder={FOLDER} />);

    const toggle = await screen.findByTestId('absent-files-toggle');
    expect(toggle.textContent).toContain(en.catalog.absentSectionTitle);
    fireEvent.click(toggle);

    expect(await screen.findByText('gone.mp4')).toBeDefined();
    expect(screen.queryByText('here.mp4')).toBeNull();

    fireEvent.click(screen.getByTestId('absent-file-forget'));
    expect(await screen.findByText(en.catalog.forgetEntryConfirmTitle)).toBeDefined();
    fireEvent.click(screen.getByTestId('absent-file-forget-confirm'));

    await waitFor(() => expect(forgetBodies).toEqual([{ fingerprint: 'fp-missing' }]));
  });

  it('renders nothing when no catalog entries are absent', async () => {
    server.use(
      catalogFolderOk([
        { fingerprint: 'fp-present', fileName: 'here.mp4', finalName: null, missing: false, missingAt: null },
      ]),
    );

    renderThemed(<AbsentFilesSection folder={FOLDER} />);

    await waitFor(() => expect(screen.queryByTestId('absent-files-section')).toBeNull());
  });
});
