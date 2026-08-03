import { ThemeProvider } from '@mui/material/styles';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { PhotosTree } from './PhotosTree.js';

const theme = createAppTheme('light');
const renderThemed = (ui: Parameters<typeof renderWithProviders>[0]) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

interface FolderFixture {
  path: string;
  name: string;
  relativePath: string;
  root: string;
  depth: number;
  photoCount: number;
  analysedCount: number;
}

const stubFolderTree = (folders: FolderFixture[]) => {
  server.use(http.get('/api/photos/tree/folders', () => HttpResponse.json({
    ok: true,
    data: {
      media: 'photo',
      folders,
      photoTotal: folders.reduce((sum, folder) => sum + folder.photoCount, 0),
      analysedTotal: folders.reduce((sum, folder) => sum + folder.analysedCount, 0),
    },
  })));
};

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

const renderTree = () =>
  renderThemed(<PhotosTree selectedFingerprint={null} processingFingerprints={new Set()} onSelect={vi.fn()} />);

describe('PhotosTree', () => {
  it('shows a loading indicator before the folder tree resolves', () => {
    server.use(http.get('/api/photos/tree/folders', () => new Promise(() => undefined)));
    renderTree();
    expect(screen.getByTestId('photos-tree-loading')).toBeDefined();
  });

  it('shows an honest empty state when the catalog has no folders', async () => {
    stubFolderTree([]);
    renderTree();
    expect(await screen.findByTestId('photos-tree-empty')).toBeDefined();
  });

  it('renders each root expanded by default with its subfolders collapsed, showing exact counts', async () => {
    stubFolderTree([
      { path: '/media/photos', name: 'photos', relativePath: '', root: '/media/photos', depth: 0, photoCount: 1, analysedCount: 0 },
      { path: '/media/photos/trip', name: 'trip', relativePath: 'trip', root: '/media/photos', depth: 1, photoCount: 2, analysedCount: 1 },
    ]);
    stubFolderContents({});
    renderTree();

    const rootRow = await screen.findByTestId('photos-tree-root-row');
    expect(rootRow.getAttribute('aria-expanded')).toBe('true');
    expect(rootRow.textContent).toContain('1/3');

    const folderRow = await screen.findByTestId('photos-tree-folder-row');
    expect(folderRow.getAttribute('data-folder-name')).toBe('trip');
    expect(folderRow.getAttribute('aria-expanded')).toBe('false');
    expect(folderRow.textContent).toContain('1/2');
    expect(rootRow.querySelector('[aria-label]')?.getAttribute('aria-label')).toBe('3 photos · 1 analysed');
  });

  it('expanding a folder with direct photos fetches and renders its photo rows', async () => {
    stubFolderTree([
      { path: '/media/photos', name: 'photos', relativePath: '', root: '/media/photos', depth: 0, photoCount: 1, analysedCount: 0 },
    ]);
    stubFolderContents({
      '/media/photos': [photoFixture('ph_0000000000000001', 'a.jpg')],
    });
    renderTree();

    expect(await screen.findByText('a.jpg')).toBeDefined();
  });

  it('expanding a collapsed subfolder reveals its own photo rows on click', async () => {
    stubFolderTree([
      { path: '/media/photos', name: 'photos', relativePath: '', root: '/media/photos', depth: 0, photoCount: 0, analysedCount: 0 },
      { path: '/media/photos/trip', name: 'trip', relativePath: 'trip', root: '/media/photos', depth: 1, photoCount: 1, analysedCount: 0 },
    ]);
    stubFolderContents({
      '/media/photos/trip': [photoFixture('ph_0000000000000002', 'b.jpg')],
    });
    renderTree();

    const folderRow = await screen.findByTestId('photos-tree-folder-row');
    expect(screen.queryByText('b.jpg')).toBeNull();

    await userEvent.click(folderRow);
    await waitFor(() => expect(folderRow.getAttribute('aria-expanded')).toBe('true'));
    expect(await screen.findByText('b.jpg')).toBeDefined();
  });

  it('calls onSelect with the fingerprint when a photo row is clicked', async () => {
    stubFolderTree([
      { path: '/media/photos', name: 'photos', relativePath: '', root: '/media/photos', depth: 0, photoCount: 1, analysedCount: 0 },
    ]);
    stubFolderContents({
      '/media/photos': [photoFixture('ph_0000000000000003', 'c.jpg')],
    });
    const onSelect = vi.fn();
    renderThemed(<PhotosTree selectedFingerprint={null} processingFingerprints={new Set()} onSelect={onSelect} />);

    const row = await screen.findByText('c.jpg');
    await userEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith('ph_0000000000000003');
  });
});
