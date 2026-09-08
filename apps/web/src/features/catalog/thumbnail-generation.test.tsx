import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import type { z } from 'zod';

import { thumbnailInputSchema, type scanOutputSchema, type scanVideoSchema } from '@core/contract/index.js';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { CatalogSidebar } from './CatalogSidebar.js';
import { CatalogTree } from './CatalogTree.js';
import { type CatalogTreeNode } from './core/index.js';
import { useCatalog } from './use-catalog.js';

type ScanVideo = z.output<typeof scanVideoSchema>;
type ScanResult = z.output<typeof scanOutputSchema>;

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) => renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

const ROOT = '/drive';
const SUB_THUMB = '/drive/sub/.ai-video-cataloger/thumbnails/clip.jpg';
const ROOT_THUMB = '/drive/.ai-video-cataloger/thumbnails/clip.jpg';

const makeVideo = (path: string, overrides: Partial<ScanVideo> = {}): ScanVideo => ({
  path,
  filename: path.split('/').pop() ?? '',
  size: 1024,
  sizeFormatted: '1.0 KB',
  duration: 60,
  durationFormatted: '1:00',
  status: 'pending',
  errorMessage: null,
  contentHash: `hash:${path}`,
  duplicate: null,
  source: { width: 1920, height: 1080, rotation: 0 },
  artifacts: {
    framePaths: null,
    transcriptContent: null,
    transcriptPath: null,
    summary: null,
    summaryPath: null,
    thumbnailPath: null,
    thumbnailMtime: null,
    newFilename: null,
  },
  ...overrides,
});

const makeScan = (videos: ScanVideo[]): ScanResult => ({
  folder: ROOT,
  databasePath: null,
  videos,
  summary: { total: videos.length, tracked: 0, pending: videos.length, inProgress: 0, completed: 0, error: 0, notTracked: 0 },
});

const thumbnailResponse = (thumbnailPath: string, outcome: { generated: boolean; skipped: boolean }) =>
  http.post('/api/thumbnail', async ({ request }) => {
    const body = thumbnailInputSchema.parse(await request.json());
    return HttpResponse.json({
      ok: true,
      data: { video: body.videoPath.split('/').pop() ?? '', path: body.videoPath, thumbnailPath, ...outcome },
    });
  });

const makeNode = (node: Omit<CatalogTreeNode, 'directPendingCount' | 'directProcessedCount'>): CatalogTreeNode => ({
  directPendingCount: node.pendingCount,
  directProcessedCount: node.processedCount,
  ...node,
});

const treeRoot: CatalogTreeNode = makeNode({
  path: ROOT,
  name: 'drive',
  relativePath: '',
  depth: 0,
  videos: [],
  videoCount: 1,
  pendingCount: null,
  processedCount: null,
  children: [
    makeNode({
      path: '/drive/sub',
      name: 'sub',
      relativePath: 'sub',
      depth: 1,
      videos: [],
      directVideoCount: 1,
      videoCount: 1,
      pendingCount: null,
      processedCount: null,
      children: [],
    }),
  ],
});

const Harness = ({ folder }: { folder: string | null }) => {
  const catalog = useCatalog(folder);
  return <CatalogSidebar folder={folder} catalog={catalog} registerVideos={() => {}} />;
};

const thumbnailStateOf = (filename: string): string | null => {
  const row = screen.getAllByTestId('video-item').find((item) => item.getAttribute('data-video-filename') === filename);
  return row === undefined ? null : within(row).getByTestId('media-thumbnail').getAttribute('data-thumbnail-state');
};

describe('thumbnail generation surfacing', () => {
  it('shows the artifact of a skipped generation that found the thumbnail already on disk', async () => {
    server.use(
      http.get('/api/scan', () => HttpResponse.json({ ok: true, data: makeScan([makeVideo('/drive/clip.mp4')]) })),
      thumbnailResponse(ROOT_THUMB, { generated: false, skipped: true }),
    );

    renderThemed(<Harness folder={ROOT} />);
    await screen.findByText('clip.mp4');

    await waitFor(() => expect(thumbnailStateOf('clip.mp4')).toBe('image'));
  });

  it('keeps the placeholder and stops retrying when the generation fails', async () => {
    let calls = 0;
    server.use(
      http.get('/api/scan', () => HttpResponse.json({ ok: true, data: makeScan([makeVideo('/drive/clip.mp4')]) })),
      http.post('/api/thumbnail', () => {
        calls += 1;
        return HttpResponse.json(
          { ok: false, error: { code: 'thumbnail_error', message: 'ffmpeg failed' } },
          { status: 500 },
        );
      }),
    );

    renderThemed(<Harness folder={ROOT} />);
    await screen.findByText('clip.mp4');

    await waitFor(() => expect(calls).toBe(1));
    await waitFor(() => expect(thumbnailStateOf('clip.mp4')).toBe('placeholder'));
  });

  it('shows a sub-folder thumbnail in the row the tree fetched it into', async () => {
    server.use(
      http.get('/api/catalog-tree/folder', () =>
        HttpResponse.json({ ok: true, data: { videos: [makeVideo('/drive/sub/clip.mp4')] } })),
      thumbnailResponse(SUB_THUMB, { generated: true, skipped: false }),
    );

    renderThemed(
      <CatalogTree
        root={treeRoot}
        rootVideos={[]}
        selectedKey={null}
        analyzingPath={null}
        onSelect={vi.fn()}
        registerVideos={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId('folder-row'));
    await screen.findByText('clip.mp4');

    await waitFor(() => expect(thumbnailStateOf('clip.mp4')).toBe('image'));
  });

  it('shows a sub-folder thumbnail a skipped generation reported as already present', async () => {
    server.use(
      http.get('/api/catalog-tree/folder', () =>
        HttpResponse.json({ ok: true, data: { videos: [makeVideo('/drive/sub/clip.mp4')] } })),
      thumbnailResponse(SUB_THUMB, { generated: false, skipped: true }),
    );

    renderThemed(
      <CatalogTree
        root={treeRoot}
        rootVideos={[]}
        selectedKey={null}
        analyzingPath={null}
        onSelect={vi.fn()}
        registerVideos={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId('folder-row'));
    await screen.findByText('clip.mp4');

    await waitFor(() => expect(thumbnailStateOf('clip.mp4')).toBe('image'));
  });
});
