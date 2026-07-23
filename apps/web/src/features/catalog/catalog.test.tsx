import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { z } from 'zod';

import type { scanOutputSchema, scanVideoSchema } from '@core/contract/index.js';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { CatalogSidebar } from './CatalogSidebar.js';
import { useCatalog } from './use-catalog.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

type ScanVideo = z.output<typeof scanVideoSchema>;
type ScanResult = z.output<typeof scanOutputSchema>;

const FOLDER = '/videos';
const THUMB = '/videos/.ai-video-cataloger/thumbnails/clip.jpg';

const makeVideo = (overrides: Partial<ScanVideo> & { path: string }): ScanVideo => ({
  filename: overrides.path.split('/').pop() ?? '',
  size: 1024,
  sizeFormatted: '1.0 KB',
  duration: 60,
  durationFormatted: '1:00',
  status: 'pending',
  errorMessage: null,
  contentHash: null,
  artifacts: {
    framePaths: null,
    transcriptContent: null,
    transcriptPath: null,
    summary: null,
    summaryPath: null,
    thumbnailPath: THUMB,
    thumbnailMtime: 1000,
    newFilename: null,
  },
  ...overrides,
});

const makeScan = (videos: ScanVideo[]): ScanResult => ({
  folder: FOLDER,
  databasePath: `${FOLDER}/.ai-video-cataloger/catalog.db`,
  videos,
  summary: {
    total: videos.length,
    tracked: 0,
    pending: videos.length,
    inProgress: 0,
    completed: 0,
    error: 0,
    notTracked: 0,
  },
});

const scanOk = (result: ScanResult) =>
  http.get('/api/scan', () => HttpResponse.json({ ok: true, data: result }));

const Harness = ({ folder }: { folder: string | null }) => {
  const catalog = useCatalog(folder);
  return <CatalogSidebar folder={folder} catalog={catalog} />;
};

const selectedFilename = (container: HTMLElement): string | null =>
  container.querySelector('.Mui-selected')?.getAttribute('data-video-filename') ?? null;

describe('catalog', () => {
  it('renders the scanned videos with their metadata', async () => {
    server.use(scanOk(makeScan([makeVideo({ path: '/videos/a.mp4', contentHash: 'hash-a' })])));

    renderThemed(<Harness folder={FOLDER} />);

    expect(await screen.findByText('a.mp4')).toBeDefined();
    expect(screen.getByText('1.0 KB')).toBeDefined();
  });

  it('points to the whole-tree analyze action for subfolders', async () => {
    server.use(scanOk(makeScan([makeVideo({ path: '/videos/a.mp4', contentHash: 'hash-a' })])));

    renderThemed(<Harness folder={FOLDER} />);

    expect(
      await screen.findByText(
        'Analyze All covers only this folder; use “Analyze all including subfolders” for the whole tree.',
      ),
    ).toBeDefined();
  });

  it('shows the loading state, then the empty state for a folder with no videos', async () => {
    server.use(scanOk(makeScan([])));

    renderThemed(<Harness folder={FOLDER} />);

    expect(screen.getByText('Scanning folder…')).toBeDefined();
    expect(await screen.findByText('No videos found')).toBeDefined();
  });

  it('surfaces a non-2xx scan as an inline error state', async () => {
    server.use(
      http.get('/api/scan', () =>
        HttpResponse.json(
          { ok: false, error: { code: 'read_error', message: 'Cannot read folder' } },
          { status: 500 },
        ),
      ),
    );

    renderThemed(<Harness folder={FOLDER} />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Cannot read folder');
  });

  it('keeps the selection on the same video across a rename (content-hash key)', async () => {
    server.use(
      scanOk(
        makeScan([
          makeVideo({ path: '/videos/raw-clip.mp4', contentHash: 'hash-a', status: 'completed' }),
          makeVideo({ path: '/videos/other.mp4', contentHash: 'hash-b' }),
        ]),
      ),
    );

    const { queryClient, container } = renderThemed(<Harness folder={FOLDER} />);

    fireEvent.click(await screen.findByText('raw-clip.mp4'));
    expect(selectedFilename(container)).toBe('raw-clip.mp4');

    server.use(
      scanOk(
        makeScan([
          makeVideo({
            path: '/videos/2026-01-01_cooking.mp4',
            contentHash: 'hash-a',
            status: 'completed',
          }),
          makeVideo({ path: '/videos/other.mp4', contentHash: 'hash-b' }),
        ]),
      ),
    );
    await queryClient.invalidateQueries();

    await screen.findByText('2026-01-01_cooking.mp4');
    expect(selectedFilename(container)).toBe('2026-01-01_cooking.mp4');
  });

  it('generates a missing thumbnail then invalidates so the catalog refetches it', async () => {
    let scanCalls = 0;
    server.use(
      http.get('/api/scan', () => {
        scanCalls += 1;
        const thumbnailPath = scanCalls === 1 ? null : THUMB;
        const thumbnailMtime = scanCalls === 1 ? null : 2000;
        return HttpResponse.json({
          ok: true,
          data: makeScan([
            {
              ...makeVideo({ path: '/videos/a.mp4', contentHash: 'hash-a' }),
              artifacts: {
                framePaths: null,
                transcriptContent: null,
                transcriptPath: null,
                summary: null,
                summaryPath: null,
                thumbnailPath,
                thumbnailMtime,
                newFilename: null,
              },
            },
          ]),
        });
      }),
      http.post('/api/thumbnail', () =>
        HttpResponse.json({
          ok: true,
          data: {
            video: 'a.mp4',
            path: '/videos/a.mp4',
            thumbnailPath: THUMB,
            generated: true,
            skipped: false,
          },
        }),
      ),
    );

    renderThemed(<Harness folder={FOLDER} />);

    await screen.findByText('a.mp4');
    await waitFor(() => expect(scanCalls).toBeGreaterThanOrEqual(2));
    expect(await screen.findByRole('img', { name: 'a.mp4' })).toBeDefined();
  });

  it('clears the generating indicator when a scan refetch supersedes the active thumbnail run', async () => {
    let scanCalls = 0;
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('/api/scan', () => {
        scanCalls += 1;
        return HttpResponse.json({
          ok: true,
          data: makeScan([{
            ...makeVideo({
              path: '/videos/a.mp4',
              contentHash: 'hash-a',
              status: scanCalls === 1 ? 'pending' : 'analyzed',
            }),
            artifacts: {
              ...makeVideo({ path: '/videos/a.mp4' }).artifacts,
              thumbnailPath: null,
              thumbnailMtime: null,
            },
          }]),
        });
      }),
      http.post('/api/thumbnail', async () => {
        await pending;
        return HttpResponse.json({
          ok: true,
          data: {
            video: 'a.mp4',
            path: '/videos/a.mp4',
            thumbnailPath: THUMB,
            generated: true,
            skipped: false,
          },
        });
      }),
    );

    const { queryClient } = renderThemed(<Harness folder={FOLDER} />);

    expect(await screen.findByText('Generating thumbnails…')).toBeDefined();
    await queryClient.invalidateQueries();
    await waitFor(() => expect(screen.queryByText('Generating thumbnails…')).toBeNull());
    release?.();
  });
});
