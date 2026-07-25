import { useMemo, useState } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { z } from 'zod';

import type { scanVideoSchema } from '@core/contract/index.js';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { CatalogTree } from './CatalogTree.js';
import { keyOf } from './core/index.js';
import { useCatalogTree } from './use-catalog-tree.js';
import { useCatalogVideoRegistry } from './use-catalog-video-registry.js';

type ScanVideo = z.output<typeof scanVideoSchema>;

const theme = createAppTheme('light');
const FOLDER = '/drive';
const VIDEO_PATH = '/drive/sub/inner.mp4';

const makeVideo = (overrides: Partial<ScanVideo> = {}): ScanVideo => ({
  path: VIDEO_PATH,
  filename: 'inner.mp4',
  size: 1024,
  sizeFormatted: '1.0 KB',
  duration: 60,
  durationFormatted: '1:00',
  status: 'pending',
  errorMessage: null,
  contentHash: 'hash:inner',
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

const treeResponse = {
  ok: true,
  data: {
    root: FOLDER,
    folders: [
      { path: '/drive/sub', name: 'sub', relativePath: 'sub', depth: 1, videoCount: 1, pendingCount: null, processedCount: null },
    ],
    pendingTotal: 0,
    processedTotal: 0,
    videoTotal: 1,
    hasUnknownPending: true,
  },
} as const;

const Harness = () => {
  const registry = useCatalogVideoRegistry();
  const tree = useCatalogTree(FOLDER);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = useMemo(
    () => (selectedKey === null ? null : registry.lookup(selectedKey)),
    [selectedKey, registry],
  );

  return (
    <ThemeProvider theme={theme}>
      <div data-testid="selected-status">{selected === null ? 'none' : selected.duplicate != null ? 'duplicate' : selected.status}</div>
      {tree.root === null ? null : (
        <CatalogTree
          root={tree.root}
          rootVideos={[]}
          selectedKey={selectedKey}
          analyzingPath={null}
          onSelect={(video) => setSelectedKey(keyOf(video))}
          registerVideos={registry.register}
        />
      )}
    </ThemeProvider>
  );
};

describe('lazy tree folder cache refresh', () => {
  it('refetches the affected folder on invalidation so the selected detail source updates in place', async () => {
    let folderVideo: ScanVideo = makeVideo({ status: 'pending', duplicate: { canonicalPath: '/drive/canon/final.mp4' } });
    server.use(
      http.get('/api/catalog-tree', () => HttpResponse.json(treeResponse)),
      http.get('/api/catalog-tree/folder', () => HttpResponse.json({ ok: true, data: { videos: [folderVideo] } })),
    );

    const { queryClient } = renderWithProviders(<Harness />);

    await userEvent.click(await screen.findByTestId('folder-row'));
    await userEvent.click(await screen.findByTestId('video-item'));
    await waitFor(() => {
      expect(screen.getByTestId('selected-status').textContent).toBe('duplicate');
    });

    folderVideo = makeVideo({ status: 'completed', duplicate: null });
    await act(async () => {
      await queryClient.invalidateQueries();
    });

    await waitFor(() => {
      expect(screen.getByTestId('selected-status').textContent).toBe('completed');
    });
  });
});
