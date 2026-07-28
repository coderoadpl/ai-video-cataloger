import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { z } from 'zod';

import type { scanVideoSchema } from '@core/contract/index.js';
import type { ConfigDescriptor } from '@core/domain/index.js';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { DetailsPanel } from './DetailsPanel.js';
import type { VariantData, VariantsData } from './index.web.js';
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

const firstConfigId = 'cfg_111111111111';
const secondConfigId = 'cfg_222222222222';
const thirdConfigId = 'cfg_333333333333';
const firstDescriptor = {
  family: 'local',
  providerId: 'local',
  modelTag: 'gemma3:12b',
  whisper_mode: 'local',
  whisper_model: 'base',
  frames: 2,
  output_language: 'en',
  promptVersion: 1,
} as const;
const secondDescriptor = { ...firstDescriptor, output_language: 'pl' } as const;
const thirdDescriptor = { ...firstDescriptor, modelTag: 'gemma3:27b' } as const;

const variant = (
  configId: string,
  descriptor: ConfigDescriptor,
  selected: boolean,
  description: string,
): VariantData => ({
  configId,
  descriptor,
  label: descriptor.modelTag ?? descriptor.model ?? descriptor.providerId,
  createdAt: selected ? '2026-08-01T00:00:00.000Z' : '2026-08-02T00:00:00.000Z',
  analyzer: descriptor.providerId,
  model: descriptor.modelTag ?? descriptor.model ?? null,
  usage: null,
  estimatedCostUsd: null,
  artifacts: {
    framesDirectory: `/catalog/artifacts/frames/hash-a/${configId}`,
    transcriptPath: `/catalog/artifacts/transcripts/hash-a/${configId}.txt`,
    summaryPath: `/catalog/variants/hash-a/${configId}/summary.txt`,
  },
  selected,
  finalName: `${configId}.mp4`,
  description,
  transcript: `${description} transcript`,
  language: descriptor.output_language,
  tags: [`${description} tag`],
});

const variantsResponse = (
  variants: readonly VariantData[],
  currentConfig: VariantsData['currentConfig'] = { configId: firstConfigId, descriptor: firstDescriptor },
  folderDefaultConfigId = firstConfigId,
) => ({
  ok: true,
  data: {
    fingerprint: 'hash-a',
    videoPath: '/videos/clip.mp4',
    folderPath: '/videos',
    folderDefaultConfigId,
    currentConfig,
    variants,
  },
});

beforeEach(() => {
  server.use(
    http.get('/api/variants', () => HttpResponse.json(variantsResponse([]))),
  );
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

  it('renders a subtitles track defaulted on when timestamped transcript segments exist', () => {
    const video = makeVideo({
      artifacts: {
        ...makeVideo().artifacts,
        transcriptSegments: [{ start: 0, end: 1, text: 'hello' }],
      },
    });

    renderThemed(<DetailsPanel video={video} analyzing={false} />);

    const track = screen.getByTestId('detail-subtitles-track');
    expect(track.getAttribute('src')).toContain('WEBVTT');
    if (!(track instanceof HTMLTrackElement)) throw new Error('expected a track element');
    expect(track.default).toBe(true);
  });

  it('bounds the player to the true aspect for portrait sources', () => {
    const video = makeVideo({ source: { width: 720, height: 1280, rotation: 0 } });
    renderThemed(<DetailsPanel video={video} analyzing={false} />);
    const player = screen.getByTestId('detail-video-player');
    expect(Number(player.getAttribute('data-player-aspect'))).toBeCloseTo(720 / 1280);
  });

  it('lays out the info column and player together in the detail layout', () => {
    renderThemed(<DetailsPanel video={makeVideo()} analyzing={false} />);
    const layout = screen.getByTestId('detail-layout');
    expect(layout.contains(screen.getByTestId('detail-video-player'))).toBe(true);
    expect(screen.getByText('Video Information')).toBeDefined();
  });

  it('shows a duplicate video with the analyze-anyway affordance when idle', () => {
    const video = makeVideo({ status: 'pending', duplicate: { canonicalPath: '/videos/canon.mp4' } });
    renderThemed(<DetailsPanel video={video} analyzing={false} onAnalyze={vi.fn()} />);
    expect(screen.getByTestId('analyze-anyway-button')).toBeDefined();
    expect(screen.getByTestId('duplicate-badge')).toBeDefined();
    expect(screen.queryByTestId('video-status-badge')).toBeNull();
  });

  it('replaces the duplicate badge with Processing while a forced analysis runs', () => {
    const video = makeVideo({ status: 'pending', duplicate: { canonicalPath: '/videos/canon.mp4' } });
    renderThemed(<DetailsPanel video={video} analyzing onAnalyze={vi.fn()} />);
    expect(screen.getByTestId('video-status-badge').textContent).toContain('Processing');
    expect(screen.queryByTestId('duplicate-badge')).toBeNull();
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

  it('renders every variant and previews frames, transcript, summary and tags without mutating', async () => {
    let selectionWrites = 0;
    const onAnalyze = vi.fn();
    server.use(
      http.get('/api/variants', () => HttpResponse.json(variantsResponse([
        variant(firstConfigId, firstDescriptor, true, 'First summary'),
        variant(secondConfigId, secondDescriptor, false, 'Second summary'),
        {
          ...variant(thirdConfigId, thirdDescriptor, false, 'Legacy summary'),
          configId: 'legacy',
          descriptor: null,
          label: 'settings partly unknown',
        },
      ]))),
      http.post('/api/variants/select', () => {
        selectionWrites += 1;
        return HttpResponse.json({ ok: true, data: { fingerprint: 'hash-a', configId: secondConfigId } });
      }),
    );
    const video = makeVideo({
      artifacts: {
        ...makeVideo().artifacts,
        framePaths: ['/selected/frame-001.jpg', '/selected/frame-002.jpg'],
        transcriptContent: 'First summary transcript',
        summary: {
          schemaVersion: 1,
          description: 'First summary',
          suggestedFilename: 'first.mp4',
          fullAnalysis: 'First full analysis',
          tags: ['First summary tag'],
          analyzedAt: '2026-08-01T00:00:00.000Z',
        },
      },
    });

    renderThemed(<DetailsPanel video={video} analyzing={false} onAnalyze={onAnalyze} />);

    await screen.findByTestId('variant-switcher');
    expect(screen.getAllByTestId(/^variant-option-/)).toHaveLength(3);
    expect(screen.getByText('Selected')).toBeDefined();
    expect(screen.getByText('Settings partly unknown')).toBeDefined();
    const analyze = screen.getByTestId('analyze-button');
    expect(analyze.textContent).toContain('Re-run existing variant');
    fireEvent.click(analyze);
    expect(onAnalyze).toHaveBeenCalledWith(video, { force: true });
    fireEvent.click(screen.getByTestId(`variant-option-${secondConfigId}`));

    expect(screen.getByText('Second summary')).toBeDefined();
    expect(screen.getByText('Second summary transcript')).toBeDefined();
    expect(screen.getByText('Second summary tag')).toBeDefined();
    expect(screen.getByTestId('active-frame').getAttribute('src')).toContain(
      `${secondConfigId}%2Fframe-001.jpg`,
    );
    expect(selectionWrites).toBe(0);
  });

  it('selects the preview once and invalidates scan, catalog, search and variant reads', async () => {
    let selectionWrites = 0;
    server.use(
      http.get('/api/variants', () => HttpResponse.json(variantsResponse([
        variant(firstConfigId, firstDescriptor, true, 'First summary'),
        variant(secondConfigId, secondDescriptor, false, 'Second summary'),
      ]))),
      http.post('/api/variants/select', () => {
        selectionWrites += 1;
        return HttpResponse.json({ ok: true, data: { fingerprint: 'hash-a', configId: secondConfigId } });
      }),
    );
    const rendered = renderThemed(<DetailsPanel video={makeVideo()} analyzing={false} onAnalyze={vi.fn()} />);
    const invalidate = vi.spyOn(rendered.queryClient, 'invalidateQueries');

    await screen.findByTestId('variant-switcher');
    fireEvent.click(screen.getByTestId(`variant-option-${secondConfigId}`));
    fireEvent.click(screen.getByTestId('use-preview-as-selected'));

    await waitFor(() => expect(selectionWrites).toBe(1));
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      ['scan'],
      ['catalog-folder'],
      ['search'],
      ['variants'],
    ]);
  });

  it('states when analysis creates a variant and sets the current configuration as folder default', async () => {
    const onAnalyze = vi.fn();
    const defaultWrites: unknown[] = [];
    server.use(
      http.get('/api/variants', () => HttpResponse.json(variantsResponse(
        [variant(firstConfigId, firstDescriptor, true, 'First summary')],
        { configId: thirdConfigId, descriptor: thirdDescriptor },
      ))),
      http.post('/api/variants/folder-default', async ({ request }) => {
        defaultWrites.push(await request.json());
        return HttpResponse.json({
          ok: true,
          data: {
            folderId: '11111111-1111-4111-8111-111111111111',
            defaultConfigId: thirdConfigId,
            resolvedConfigId: thirdConfigId,
          },
        });
      }),
    );

    renderThemed(<DetailsPanel video={makeVideo()} analyzing={false} onAnalyze={onAnalyze} />);

    const analyze = await screen.findByTestId('analyze-button');
    expect(analyze.textContent).toContain('Analyze as new variant');
    expect(screen.getByText(/Creates a new variant/)).toBeDefined();
    fireEvent.click(analyze);
    expect(onAnalyze).toHaveBeenCalledWith(makeVideo());

    fireEvent.click(screen.getByTestId('set-folder-default-variant'));
    await waitFor(() => expect(defaultWrites).toEqual([
      { folderPath: '/videos', configId: thirdConfigId },
    ]));
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
