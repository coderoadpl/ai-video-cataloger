import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { en } from '../../i18n/dictionary.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { BrowsePreview } from './BrowsePreview.js';
import type { PreviewMedia } from './core/index.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) => renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

const previewItem = (overrides: Partial<PreviewMedia> = {}): PreviewMedia => ({
  kind: 'video',
  fingerprint: 'fp-1',
  title: 'clip.mp4',
  path: '/videos/clip.mp4',
  folderPath: '/videos',
  online: true,
  missing: false,
  description: 'a description',
  tags: ['beach'],
  placeName: 'Fjordvik',
  capturedAt: '2026-01-02T10:00:00.000Z',
  posterPath: null,
  gps: null,
  ...overrides,
});

const stubPreviewDetail = (overrides: Record<string, unknown> = {}): void => {
  server.use(
    http.get('/api/library/preview', () => HttpResponse.json({
      ok: true,
      data: {
        fingerprint: 'fp-1',
        path: '/videos/clip.mp4',
        fileName: 'clip.mp4',
        size: 2048,
        sizeFormatted: '2.0 KB',
        durationS: 65,
        durationFormatted: '1:05',
        transcript: null,
        transcriptSegments: null,
        width: null,
        height: null,
        rotation: null,
        people: [],
        ...overrides,
      },
    })),
  );
};

describe('BrowsePreview', () => {
  it('renders nothing when there is no item', () => {
    renderThemed(<BrowsePreview item={null} onClose={vi.fn()} onOpenInAnalysis={vi.fn()} />);
    expect(screen.queryByTestId('preview-player')).toBeNull();
  });

  it('renders the player and rows for an online item', () => {
    stubPreviewDetail();
    renderThemed(<BrowsePreview item={previewItem()} onClose={vi.fn()} onOpenInAnalysis={vi.fn()} />);

    expect(screen.getByTestId('preview-player')).toBeDefined();
    expect(screen.getByText('a description')).toBeDefined();
    expect(screen.getByText('beach')).toBeDefined();
    expect(screen.getByText('Fjordvik')).toBeDefined();
  });

  it('uses the poster path as the video overlay so it never opens as a black rectangle', () => {
    stubPreviewDetail();
    renderThemed(<BrowsePreview item={previewItem({ posterPath: '/videos/.ai-video-cataloger/thumbnails/clip.grid.jpg' })} onClose={vi.fn()} onOpenInAnalysis={vi.fn()} />);

    const player = screen.getByTestId('preview-player');
    expect(player.getAttribute('poster')).toContain('clip.grid.jpg');
  });

  it('omits the poster attribute when there is no thumbnail', () => {
    stubPreviewDetail();
    renderThemed(<BrowsePreview item={previewItem({ posterPath: null })} onClose={vi.fn()} onOpenInAnalysis={vi.fn()} />);

    expect(screen.getByTestId('preview-player').hasAttribute('poster')).toBe(false);
  });

  it('shows a human-readable capture date instead of a raw ISO timestamp', () => {
    stubPreviewDetail();
    renderThemed(<BrowsePreview item={previewItem({ capturedAt: '2026-06-19T10:03:37.000Z' })} onClose={vi.fn()} onOpenInAnalysis={vi.fn()} />);

    expect(screen.queryByText('2026-06-19T10:03:37.000Z')).toBeNull();
    expect(screen.getByText(en.photos.detailCaptured).nextSibling?.textContent).not.toContain('T');
  });

  it('never renders analysis affordances, including the variant picker', () => {
    stubPreviewDetail();
    renderThemed(<BrowsePreview item={previewItem()} onClose={vi.fn()} onOpenInAnalysis={vi.fn()} />);

    expect(screen.queryByTestId('variant-switcher')).toBeNull();
    expect(screen.queryByTestId('status-actions')).toBeNull();
    expect(screen.queryByTestId('photos-analyze-strip')).toBeNull();
    expect(screen.queryByTestId('photo-variant-picker')).toBeNull();
  });

  it('shows the selected variant\'s transcript, duration and size once the preview detail loads', async () => {
    stubPreviewDetail({ transcript: 'quiet audio over the bay' });
    renderThemed(<BrowsePreview item={previewItem()} onClose={vi.fn()} onOpenInAnalysis={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('preview-transcript').textContent).toBe('quiet audio over the bay'));
    expect(screen.getByText(en.details.transcript)).toBeDefined();
    expect(screen.getByText('1:05')).toBeDefined();
    expect(screen.getByText('2.0 KB')).toBeDefined();
    expect(screen.queryByTestId('variant-switcher')).toBeNull();
  });

  it('omits the transcript section entirely when there is no transcript', async () => {
    stubPreviewDetail({ transcript: null });
    renderThemed(<BrowsePreview item={previewItem()} onClose={vi.fn()} onOpenInAnalysis={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('1:05')).toBeDefined());
    expect(screen.queryByTestId('preview-transcript')).toBeNull();
    expect(screen.queryByText(en.details.transcript)).toBeNull();
  });

  it('renders a chip per observed person once the preview detail loads', async () => {
    stubPreviewDetail({ people: [{ personId: 'person-a', displayName: 'Ada' }] });
    renderThemed(<BrowsePreview item={previewItem()} onClose={vi.fn()} onOpenInAnalysis={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('preview-person-chip').textContent).toBe('Ada'));
  });

  it('renders coordinates only when the item carries gps', async () => {
    stubPreviewDetail();
    renderThemed(<BrowsePreview item={previewItem({ gps: { lat: 51.1, lon: 17.2 } })} onClose={vi.fn()} onOpenInAnalysis={vi.fn()} />);

    expect(screen.getByTestId('preview-coordinates')).toBeDefined();
  });

  it('fires onOpenInAnalysis with folder path and file path, then closes', () => {
    stubPreviewDetail();
    const onOpenInAnalysis = vi.fn();
    const onClose = vi.fn();
    renderThemed(<BrowsePreview item={previewItem()} onClose={onClose} onOpenInAnalysis={onOpenInAnalysis} />);

    fireEvent.click(screen.getByTestId('preview-open-analysis'));

    expect(onOpenInAnalysis).toHaveBeenCalledWith('/videos', '/videos/clip.mp4');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('names the missing file instead of blaming a disconnected drive when the folder is online', () => {
    stubPreviewDetail();
    renderThemed(<BrowsePreview item={previewItem({ missing: true })} onClose={vi.fn()} onOpenInAnalysis={vi.fn()} />);

    expect(screen.queryByTestId('preview-player')).toBeNull();
    expect(screen.getByTestId('preview-unavailable').textContent).toBe(en.preview.missing);
  });

  it('renders no player and no active escape hatch link for an offline item', () => {
    stubPreviewDetail();
    renderThemed(<BrowsePreview item={previewItem({ online: false })} onClose={vi.fn()} onOpenInAnalysis={vi.fn()} />);

    expect(screen.queryByTestId('preview-player')).toBeNull();
    expect(screen.getByTestId('preview-unavailable').textContent).toBe(en.preview.offline);
    expect(screen.queryByTestId('preview-open-analysis')).toBeNull();
  });

  it('renders no subtitles track when the preview detail carries no timestamped segments', async () => {
    stubPreviewDetail({ transcript: 'quiet audio over the bay', transcriptSegments: null });
    renderThemed(<BrowsePreview item={previewItem()} onClose={vi.fn()} onOpenInAnalysis={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('preview-transcript')).toBeDefined());
    expect(screen.queryByTestId('preview-subtitles-track')).toBeNull();
  });

  it('renders a subtitles track defaulted on when timestamped segments exist, using a blob: URL never a data: URL', async () => {
    const objectUrl = 'blob:http://localhost/preview-subtitles-fixture';
    const createObjectURL = vi.fn().mockReturnValue(objectUrl);
    const revokeObjectURL = vi.fn();
    class ObjectUrlStub extends URL {
      static override createObjectURL = createObjectURL;
      static override revokeObjectURL = revokeObjectURL;
    }
    vi.stubGlobal('URL', ObjectUrlStub);

    stubPreviewDetail({
      transcript: 'quiet audio over the bay',
      transcriptSegments: [{ start: 0, end: 1, text: 'quiet audio over the bay' }],
    });
    const rendered = renderThemed(<BrowsePreview item={previewItem()} onClose={vi.fn()} onOpenInAnalysis={vi.fn()} />);

    const track = await screen.findByTestId('preview-subtitles-track');
    expect(track.getAttribute('src')).toBe(objectUrl);
    expect(track.getAttribute('src')).not.toContain('data:');
    if (!(track instanceof HTMLTrackElement)) throw new Error('expected a track element');
    expect(track.default).toBe(true);
    expect(createObjectURL).toHaveBeenCalledOnce();

    rendered.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith(objectUrl);
  });

  it('bounds the preview player to the true aspect for a portrait 9:16 source', async () => {
    stubPreviewDetail({ width: 720, height: 1280 });
    renderThemed(<BrowsePreview item={previewItem()} onClose={vi.fn()} onOpenInAnalysis={vi.fn()} />);

    const player = screen.getByTestId('preview-player');
    await waitFor(() => expect(Number(player.getAttribute('data-player-aspect'))).toBeCloseTo(720 / 1280));
  });

  it('defaults to a 16:9 aspect when the preview detail has no source dimensions yet', () => {
    stubPreviewDetail({ width: null, height: null });
    renderThemed(<BrowsePreview item={previewItem()} onClose={vi.fn()} onOpenInAnalysis={vi.fn()} />);

    const player = screen.getByTestId('preview-player');
    expect(Number(player.getAttribute('data-player-aspect'))).toBeCloseTo(16 / 9);
  });
});
