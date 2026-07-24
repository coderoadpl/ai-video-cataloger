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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('tree absent files section', () => {
  it('fetches a single grouped query lazily on first expand and none while collapsed', async () => {
    let requestCount = 0;
    server.use(
      http.get('/api/catalog-tree/absent', ({ request }) => {
        requestCount += 1;
        expect(new URL(request.url).searchParams.get('folder')).toBe('/drive');
        return HttpResponse.json({
          ok: true,
          data: {
            groups: [
              {
                folderPath: '/drive/sub',
                entries: [
                  { fingerprint: 'fp-gone', fileName: 'gone.mp4', finalName: null, missing: true, missingAt: 1738368000000 },
                ],
              },
            ],
          },
        });
      }),
    );

    renderThemed(<TreeAbsentFilesSection root={root} />);

    const toggle = await screen.findByTestId('tree-absent-files-toggle');
    await sleep(20);
    expect(requestCount).toBe(0);

    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByTestId('tree-absent-file-item')).toBeDefined());
    expect(screen.getByText('gone.mp4')).toBeDefined();
    expect(screen.getByText('sub')).toBeDefined();
    expect(requestCount).toBe(1);
  });

  it('shows an empty note when the tree has no absent files', async () => {
    server.use(
      http.get('/api/catalog-tree/absent', () => HttpResponse.json({ ok: true, data: { groups: [] } })),
    );

    renderThemed(<TreeAbsentFilesSection root={root} />);

    fireEvent.click(await screen.findByTestId('tree-absent-files-toggle'));
    await waitFor(() => expect(screen.getByText('No absent files in this tree.')).toBeDefined());
  });
});
