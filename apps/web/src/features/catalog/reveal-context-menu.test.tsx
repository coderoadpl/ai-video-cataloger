import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { z } from 'zod';

import type { scanVideoSchema } from '@core/contract/index.js';

import { bridge } from '../../api.js';
import { renderWithProviders } from '../../test/render.js';
import { createAppTheme } from '../../theme.js';
import { VideoList } from './VideoList.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

type ScanVideo = z.output<typeof scanVideoSchema>;

const video: ScanVideo = {
  path: '/videos/clip.mp4',
  filename: 'clip.mp4',
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
    thumbnailPath: null,
    thumbnailMtime: null,
    newFilename: null,
  },
};

describe('reveal in finder context menu', () => {
  it('reveals a right-clicked video row in Finder', async () => {
    const reveal = vi.spyOn(bridge, 'revealInFinder').mockResolvedValue(true);
    renderThemed(
      <VideoList
        videos={[video]}
        selectedKey={null}
        analyzingPath={null}
        isLoading={false}
        isError={false}
        error={null}
        onSelect={() => {}}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId('video-item'));
    const item = await screen.findByTestId('reveal-in-finder-item');
    fireEvent.click(item);

    await waitFor(() => expect(reveal).toHaveBeenCalledWith('/videos/clip.mp4'));
    reveal.mockRestore();
  });

  it('shows an error toast when the reveal target is outside every known folder', async () => {
    const reveal = vi.spyOn(bridge, 'revealInFinder').mockResolvedValue(false);
    renderThemed(
      <VideoList
        videos={[video]}
        selectedKey={null}
        analyzingPath={null}
        isLoading={false}
        isError={false}
        error={null}
        onSelect={() => {}}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId('video-item'));
    fireEvent.click(await screen.findByTestId('reveal-in-finder-item'));

    expect(await screen.findByTestId('reveal-failed-toast')).toBeDefined();
    reveal.mockRestore();
  });
});
