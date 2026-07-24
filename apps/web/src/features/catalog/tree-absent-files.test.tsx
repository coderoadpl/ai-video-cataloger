import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { type CatalogTreeNode } from './catalog-tree-model.js';
import { TreeAbsentFilesSection } from './TreeAbsentFilesSection.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

const leaf = (path: string): CatalogTreeNode => ({
  path,
  name: path.split('/').pop() ?? path,
  relativePath: path,
  depth: 1,
  videos: [],
  pendingCount: null,
  processedCount: null,
  directPendingCount: null,
  directProcessedCount: null,
  children: [],
});

const root: CatalogTreeNode = {
  path: '/drive',
  name: 'drive',
  relativePath: '',
  depth: 0,
  videos: [],
  pendingCount: null,
  processedCount: null,
  directPendingCount: null,
  directProcessedCount: null,
  children: [leaf('/drive/sub')],
};

describe('tree absent files section', () => {
  it('aggregates missing entries across the tree grouped by folder', async () => {
    server.use(
      http.get('/api/catalog-folder', ({ request }) => {
        const folder = new URL(request.url).searchParams.get('folder');
        if (folder === '/drive/sub') {
          return HttpResponse.json({
            ok: true,
            data: {
              records: [
                { fingerprint: 'fp-gone', fileName: 'gone.mp4', finalName: null, missing: true, missingAt: 1738368000000 },
              ],
            },
          });
        }
        return HttpResponse.json({ ok: true, data: { records: [] } });
      }),
    );

    renderThemed(<TreeAbsentFilesSection root={root} />);

    const toggle = await screen.findByTestId('tree-absent-files-toggle');
    expect(toggle.textContent).toContain('1');

    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByTestId('tree-absent-file-item')).toBeDefined());
    expect(screen.getByText('gone.mp4')).toBeDefined();
    expect(screen.getByText('sub')).toBeDefined();
  });

  it('renders nothing when no folder has missing entries', async () => {
    server.use(
      http.get('/api/catalog-folder', () => HttpResponse.json({ ok: true, data: { records: [] } })),
    );

    renderThemed(<TreeAbsentFilesSection root={root} />);

    await waitFor(() => expect(screen.queryByTestId('tree-absent-files-section')).toBeNull());
  });
});
