import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { z } from 'zod';

import type { scanVideoSchema } from '@core/contract/index.js';

import { renderWithProviders } from '../../test/render.js';
import { createAppTheme } from '../../theme.js';
import { DetailsPanel } from './DetailsPanel.js';
import { StatusActions } from './StatusActions.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

type DetailsVideo = z.output<typeof scanVideoSchema>;

const makeVideo = (overrides: Partial<DetailsVideo> = {}): DetailsVideo => ({
  path: '/videos/clip.mp4',
  filename: 'clip.mp4',
  size: 2048,
  sizeFormatted: '2.0 KB',
  duration: 90,
  durationFormatted: '1:30',
  status: 'completed',
  errorMessage: null,
  contentHash: 'hash-a',
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

describe('details panel', () => {
  it('shows the welcome screen when no video is selected', () => {
    renderThemed(<DetailsPanel video={null} analyzing={false} />);
    expect(screen.getByText('Welcome to AI Video Cataloger')).toBeDefined();
  });

  it('renders metadata, summary, frames, transcript and full analysis for a completed video', () => {
    const video = makeVideo({
      artifacts: {
        framePaths: ['/videos/frames/clip/frame-001.jpg', '/videos/frames/clip/frame-002.jpg'],
        transcriptContent: 'hello world transcript',
        transcriptPath: '/videos/transcripts/clip.txt',
        summary: {
          schemaVersion: 1,
          description: 'A cooking tutorial about pasta.',
          suggestedFilename: 'cooking-tutorial-pasta',
          fullAnalysis: 'The full analysis text.',
          tags: [],
          analyzedAt: '2026-01-01T00:00:00.000Z',
        },
        summaryPath: '/videos/summaries/clip.json',
        thumbnailPath: null,
        thumbnailMtime: null,
        newFilename: '2026-01-01_cooking-tutorial-pasta.mp4',
      },
    });

    renderThemed(<DetailsPanel video={video} analyzing={false} />);

    expect(screen.getByText('Video Information')).toBeDefined();
    expect(screen.getByText('A cooking tutorial about pasta.')).toBeDefined();
    expect(screen.getByText('cooking-tutorial-pasta')).toBeDefined();
    expect(screen.getByText('Extracted Frames (2)')).toBeDefined();
    expect(screen.getByText('hello world transcript')).toBeDefined();
    expect(screen.getByText('Full AI Analysis')).toBeDefined();
  });

  it('renders tag chips and routes chip clicks to search', () => {
    const onTagSearch = vi.fn();
    const video = makeVideo({
      artifacts: {
        ...makeVideo().artifacts,
        summary: {
          schemaVersion: 1,
          description: 'A cooking tutorial about pasta.',
          suggestedFilename: 'cooking-tutorial-pasta',
          fullAnalysis: 'The full analysis text.',
          tags: ['cooking', 'pasta'],
          analyzedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    });

    renderThemed(<DetailsPanel video={video} analyzing={false} onTagSearch={onTagSearch} />);

    fireEvent.click(screen.getByText('pasta'));
    expect(onTagSearch).toHaveBeenCalledWith('pasta');
  });

  it('renders the inline player with media source and no subtitles when segments are absent', () => {
    renderThemed(<DetailsPanel video={makeVideo({ status: 'pending' })} analyzing={false} />);

    const player = screen.getByTestId('detail-video-player');
    if (!(player instanceof HTMLVideoElement)) throw new Error('expected a video element');
    expect(player.getAttribute('src')).toBe('media://local/%2Fvideos%2Fclip.mp4');
    expect(player.autoplay).toBe(false);
    expect(screen.queryByTestId('detail-subtitles-track')).toBeNull();
  });

  it('renders a subtitles track when timestamped transcript segments exist', () => {
    const video = makeVideo({
      artifacts: {
        ...makeVideo().artifacts,
        transcriptSegments: [{ start: 0, end: 1, text: 'hello' }],
      },
    });

    renderThemed(<DetailsPanel video={video} analyzing={false} />);

    const track = screen.getByTestId('detail-subtitles-track');
    expect(track.getAttribute('src')).toContain('WEBVTT');
  });

  it('shows the missing-summary empty state for an analyzed video without a summary', () => {
    renderThemed(<DetailsPanel video={makeVideo({ status: 'analyzed' })} analyzing={false} />);
    expect(screen.getByText(/No summary available/)).toBeDefined();
  });

  it('selects a different frame when a thumbnail is clicked', () => {
    const video = makeVideo({
      artifacts: {
        framePaths: ['/videos/frames/clip/frame-001.jpg', '/videos/frames/clip/frame-002.jpg'],
        transcriptContent: null,
        transcriptPath: null,
        summary: null,
        summaryPath: null,
        thumbnailPath: null,
        thumbnailMtime: null,
        newFilename: null,
      },
    });

    renderThemed(<DetailsPanel video={video} analyzing={false} />);

    const active = screen.getByTestId('active-frame');
    expect(active.getAttribute('src')).toContain('frame-001.jpg');
    fireEvent.click(screen.getByRole('button', { name: 'Frame 2' }));
    expect(active.getAttribute('src')).toContain('frame-002.jpg');
  });
});

describe('status actions', () => {
  it('offers Analyze for a pending video and calls back on click', () => {
    const onAnalyze = vi.fn();
    const video = makeVideo({ status: 'pending' });
    renderThemed(<StatusActions video={video} analyzing={false} onAnalyze={onAnalyze} />);

    const button = screen.getByTestId('analyze-button');
    expect(button.textContent).toContain('Analyze Video');
    fireEvent.click(button);
    expect(onAnalyze).toHaveBeenCalledWith(video);
  });

  it('offers Continue Analysis for an interrupted video', () => {
    const onAnalyze = vi.fn();
    renderThemed(
      <StatusActions video={makeVideo({ status: 'transcribed' })} analyzing={false} onAnalyze={onAnalyze} />,
    );
    expect(screen.getByText('Processing Incomplete')).toBeDefined();
    expect(screen.getByTestId('analyze-button').textContent).toContain('Continue Analysis');
  });

  it('offers Retry with the error message for a failed video', () => {
    const onAnalyze = vi.fn();
    renderThemed(
      <StatusActions
        video={makeVideo({ status: 'error', errorMessage: 'ffmpeg exploded' })}
        analyzing={false}
        onAnalyze={onAnalyze}
      />,
    );
    expect(screen.getByText('ffmpeg exploded')).toBeDefined();
    expect(screen.getByTestId('analyze-button').textContent).toContain('Retry Analysis');
  });

  it('reflects the analyzing state on the button', () => {
    renderThemed(
      <StatusActions video={makeVideo({ status: 'pending' })} analyzing onAnalyze={vi.fn()} />,
    );
    expect(screen.getByTestId('analyze-button').textContent).toContain('Analyzing…');
  });
});
