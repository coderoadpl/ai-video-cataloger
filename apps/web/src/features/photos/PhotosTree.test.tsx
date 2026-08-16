import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { actions } from '../../api.js';
import { createTestQueryClient } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { buildPhotoTreeForRoot } from './core/index.js';
import { PhotosTree } from './PhotosTree.js';

const theme = createAppTheme('light');
const renderWithClient = (ui: Parameters<typeof render>[0], queryClient: QueryClient) =>
  render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
const renderThemed = (ui: Parameters<typeof render>[0]) => renderWithClient(ui, createTestQueryClient());

interface FolderFixture {
  path: string;
  name: string;
  relativePath: string;
  root: string;
  depth: number;
  photoCount: number;
  analysedCount: number;
}

const photoFixture = (fingerprint: string, fileName: string) => ({
  fingerprint,
  fileName,
  currentPath: `/media/photos/${fileName}`,
  ext: 'jpg',
  capturedAt: null,
  capturedAtSource: null,
  width: null,
  height: null,
  proxyState: 'pending',
  thumbState: 'pending',
  missingAt: null,
  sightings: 1,
  thumbPath: null,
  gridThumbPath: null,
  proxyPath: null,
  analysed: false,
  exifReadAt: null,
});

const stubFolderContents = (byPath: Record<string, ReturnType<typeof photoFixture>[]>) => {
  server.use(http.get('/api/photos/tree/folder', ({ request }) => {
    const folder = new URL(request.url).searchParams.get('folder') ?? '';
    return HttpResponse.json({ ok: true, data: { media: 'photo', items: byPath[folder] ?? [] } });
  }));
};

const treeFor = (folders: FolderFixture[], root = '/media/photos') => {
  const tree = buildPhotoTreeForRoot(folders, root);
  if (tree === null) throw new Error('missing fixture tree');
  return tree;
};

const renderTree = (folders: FolderFixture[], root = '/media/photos') =>
  renderThemed(<PhotosTree root={treeFor(folders, root)} selectedFingerprint={null} processingFingerprints={new Set()} onSelect={vi.fn()} />);

describe('PhotosTree', () => {
  it('renders only the current root expanded by default with its subfolders collapsed and exact counts', async () => {
    stubFolderContents({});
    renderTree([
      { path: '/media/photos', name: 'photos', relativePath: '', root: '/media/photos', depth: 0, photoCount: 1, analysedCount: 0 },
      { path: '/media/photos/trip', name: 'trip', relativePath: 'trip', root: '/media/photos', depth: 1, photoCount: 2, analysedCount: 1 },
      { path: '/home/Pictures', name: 'Pictures', relativePath: '', root: '/home/Pictures', depth: 0, photoCount: 20, analysedCount: 0 },
    ]);

    const rootRow = await screen.findByTestId('photos-tree-root-row');
    expect(rootRow.getAttribute('aria-expanded')).toBe('true');
    expect(rootRow.textContent).toContain('1/3');

    const folderRow = await screen.findByTestId('photos-tree-folder-row');
    expect(folderRow.getAttribute('data-folder-name')).toBe('trip');
    expect(folderRow.getAttribute('aria-expanded')).toBe('false');
    expect(folderRow.textContent).toContain('1/2');
    expect(rootRow.querySelector('[aria-label]')?.getAttribute('aria-label')).toBe('3 photos · 1 analyzed');
    expect(screen.queryByText('Pictures')).toBeNull();
  });

  it('expanding a folder with direct photos fetches and renders its photo rows', async () => {
    stubFolderContents({
      '/media/photos': [photoFixture('ph_0000000000000001', 'a.jpg')],
    });
    renderTree([
      { path: '/media/photos', name: 'photos', relativePath: '', root: '/media/photos', depth: 0, photoCount: 1, analysedCount: 0 },
    ]);
    expect(await screen.findByText('a.jpg')).toBeDefined();
  });

  it('expanding a collapsed subfolder reveals its own photo rows on click', async () => {
    stubFolderContents({
      '/media/photos/trip': [photoFixture('ph_0000000000000002', 'b.jpg')],
    });
    renderTree([
      { path: '/media/photos', name: 'photos', relativePath: '', root: '/media/photos', depth: 0, photoCount: 0, analysedCount: 0 },
      { path: '/media/photos/trip', name: 'trip', relativePath: 'trip', root: '/media/photos', depth: 1, photoCount: 1, analysedCount: 0 },
    ]);
    const folderRow = await screen.findByTestId('photos-tree-folder-row');
    expect(screen.queryByText('b.jpg')).toBeNull();

    await userEvent.click(folderRow);
    await waitFor(() => expect(folderRow.getAttribute('aria-expanded')).toBe('true'));
    expect(await screen.findByText('b.jpg')).toBeDefined();
  });

  it('calls onSelect with the fingerprint when a photo row is clicked', async () => {
    const root = treeFor([
      { path: '/media/photos', name: 'photos', relativePath: '', root: '/media/photos', depth: 0, photoCount: 1, analysedCount: 0 },
    ]);
    stubFolderContents({
      '/media/photos': [photoFixture('ph_0000000000000003', 'c.jpg')],
    });
    const onSelect = vi.fn();
    renderThemed(<PhotosTree root={root} selectedFingerprint={null} processingFingerprints={new Set()} onSelect={onSelect} />);

    const row = await screen.findByText('c.jpg');
    await userEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith('ph_0000000000000003');
  });

  it('preserves the user collapse state when refreshed tree data keeps the same current root', async () => {
    const first = treeFor([
      { path: '/media/photos', name: 'photos', relativePath: '', root: '/media/photos', depth: 0, photoCount: 1, analysedCount: 0 },
      { path: '/media/photos/trip', name: 'trip', relativePath: 'trip', root: '/media/photos', depth: 1, photoCount: 1, analysedCount: 0 },
    ]);
    stubFolderContents({ '/media/photos': [photoFixture('ph_0000000000000004', 'd.jpg')] });
    const rendered = renderThemed(
      <PhotosTree root={first} selectedFingerprint={null} processingFingerprints={new Set()} onSelect={vi.fn()} />,
    );

    const rootRow = await screen.findByTestId('photos-tree-root-row');
    await userEvent.click(rootRow);
    expect(rootRow.getAttribute('aria-expanded')).toBe('false');

    const refreshed = treeFor([
      { path: '/media/photos', name: 'photos', relativePath: '', root: '/media/photos', depth: 0, photoCount: 1, analysedCount: 1 },
      { path: '/media/photos/trip', name: 'trip', relativePath: 'trip', root: '/media/photos', depth: 1, photoCount: 1, analysedCount: 0 },
    ]);
    rendered.rerender(
      <ThemeProvider theme={theme}>
        <PhotosTree root={refreshed} selectedFingerprint="ph_0000000000000004" processingFingerprints={new Set()} onSelect={vi.fn()} />
      </ThemeProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('photos-tree-root-row').getAttribute('aria-expanded')).toBe('false'));
  });

  it('renders the root photo rows when their folder query already resolved before mount', async () => {
    stubFolderContents({ '/media/photos': [photoFixture('ph_0000000000000005', 'e.jpg')] });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await queryClient.fetchQuery(actions.photosTreeFolder({ folder: '/media/photos' }));

    renderWithClient(
      <PhotosTree
        root={treeFor([
          { path: '/media/photos', name: 'photos', relativePath: '', root: '/media/photos', depth: 0, photoCount: 1, analysedCount: 0 },
        ])}
        selectedFingerprint={null}
        processingFingerprints={new Set()}
        onSelect={vi.fn()}
      />,
      queryClient,
    );

    expect(await screen.findByText('e.jpg')).toBeDefined();
    expect(screen.queryByText('Scanning folder…')).toBeNull();
  });

  it('expands the new root by default when the current root changes', async () => {
    stubFolderContents({});
    const rendered = renderTree([
      { path: '/media/photos', name: 'photos', relativePath: '', root: '/media/photos', depth: 0, photoCount: 0, analysedCount: 0 },
      { path: '/media/photos/trip', name: 'trip', relativePath: 'trip', root: '/media/photos', depth: 1, photoCount: 0, analysedCount: 0 },
    ]);
    await screen.findByTestId('photos-tree-root-row');

    rendered.rerender(
      <ThemeProvider theme={theme}>
        <PhotosTree
          root={treeFor(
            [
              { path: '/home/Pictures', name: 'Pictures', relativePath: '', root: '/home/Pictures', depth: 0, photoCount: 0, analysedCount: 0 },
              { path: '/home/Pictures/2026', name: '2026', relativePath: '2026', root: '/home/Pictures', depth: 1, photoCount: 0, analysedCount: 0 },
            ],
            '/home/Pictures',
          )}
          selectedFingerprint={null}
          processingFingerprints={new Set()}
          onSelect={vi.fn()}
        />
      </ThemeProvider>,
    );

    const rootRow = await screen.findByTestId('photos-tree-root-row');
    expect(rootRow.getAttribute('data-folder-name')).toBe('Pictures');
    expect(rootRow.getAttribute('aria-expanded')).toBe('true');
    expect(await screen.findByTestId('photos-tree-folder-row')).toBeDefined();
  });
});
