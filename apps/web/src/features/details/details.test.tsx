import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  whisper_language: 'auto',
  frames: 2,
  output_language: 'en',
  promptVersion: 1,
} as const;
const secondDescriptor = { ...firstDescriptor, output_language: 'pl' } as const;
const thirdDescriptor = { ...firstDescriptor, modelTag: 'gemma3:27b' } as const;
const geminiDescriptor = {
  family: 'gemini-native',
  providerId: 'gemini',
  model: 'gemini-3.6-flash',
  output_language: 'pl',
  promptVersion: 3,
} as const;

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
  folderDefaultConfigId: string | null = firstConfigId,
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('details panel', () => {
  it('shows the welcome screen only when no folder is open', () => {
    renderThemed(<DetailsPanel video={null} analyzing={false} />);
    expect(screen.getByText('Welcome to AI Video Cataloger')).toBeDefined();
    expect(screen.queryByTestId('analysis-empty-state')).toBeNull();
  });

  it('shows the shared select-a-file empty state when a folder is open and no video is selected', () => {
    renderThemed(<DetailsPanel video={null} analyzing={false} folderOpen hasVideos />);
    expect(screen.queryByText('Welcome to AI Video Cataloger')).toBeNull();
    expect(screen.getByTestId('analysis-empty-state').textContent).toContain(
      'Select a video from the list on the left to see its details.',
    );
  });

  it('shows the shared medium-empty state when an open folder has no videos', () => {
    renderThemed(<DetailsPanel video={null} analyzing={false} folderOpen />);
    expect(screen.queryByText('Welcome to AI Video Cataloger')).toBeNull();
    expect(screen.getByTestId('analysis-empty-state').textContent).toContain(
      'No videos were found in this folder.',
    );
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
    expect(document.querySelectorAll('[data-detail-metadata-row="true"]')).toHaveLength(3);
    expect(screen.getByText('A cooking tutorial about pasta.')).toBeDefined();
    expect(screen.getByText('cooking-tutorial-pasta')).toBeDefined();
    expect(screen.getByText('Extracted Frames (2)')).toBeDefined();
    expect(screen.getByText('hello world transcript')).toBeDefined();
    expect(screen.getByText('Full AI Analysis')).toBeDefined();
  });

  it('shows the processing-failed message exactly once, and never leaks a raw internal command path', () => {
    const video = makeVideo({
      status: 'error',
      errorMessage: 'rate limit exceeded',
    });

    renderThemed(<DetailsPanel video={video} analyzing={false} onAnalyze={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Processing Failed' })).toBeDefined();
    expect(screen.getAllByText('rate limit exceeded')).toHaveLength(1);
    expect(screen.queryByText('An error occurred during processing.')).toBeNull();
  });

  it('shows one retry affordance, not a competing variants-load-error card, for a video that was never successfully analyzed', async () => {
    server.use(
      http.get('/api/variants', () => HttpResponse.json(
        { ok: false, error: { code: 'video_not_found', message: 'Catalog video not found: hash-a' } },
        { status: 404 },
      )),
    );
    const video = makeVideo({ status: 'error', errorMessage: 'Command failed (exit code 1).' });

    renderThemed(<DetailsPanel video={video} analyzing={false} onAnalyze={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Processing Failed' })).toBeDefined());
    await waitFor(() => expect(screen.queryByText('Loading analysis variants…')).toBeNull());
    expect(screen.queryByTestId('variant-load-error')).toBeNull();
    expect(screen.getAllByRole('button', { name: /Retry/ })).toHaveLength(1);
  });

  it('shows the full AI analysis always expanded, with no collapse affordance', () => {
    const video = makeVideo({
      artifacts: {
        ...makeVideo().artifacts,
        summary: {
          schemaVersion: 1,
          description: 'A cooking tutorial about pasta.',
          suggestedFilename: 'cooking-tutorial-pasta',
          fullAnalysis: 'The full analysis text.',
          tags: [],
          analyzedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    });

    renderThemed(<DetailsPanel video={video} analyzing={false} />);

    expect(screen.getByText('The full analysis text.')).toBeDefined();
    expect(screen.getByText('Full AI Analysis')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Full AI Analysis' })).toBeNull();
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

  it('shows the recorded coordinates and a jump-to-map action', () => {
    const onShowOnMap = vi.fn();
    const video = makeVideo();

    renderThemed(
      <DetailsPanel
        video={video}
        analyzing={false}
        location={{ lat: 50.0614, lon: 19.9366 }}
        onShowOnMap={onShowOnMap}
      />,
    );

    expect(screen.getByTestId('details-coordinates').textContent).toBe('50.0614° N, 19.9366° E');
    fireEvent.click(screen.getByTestId('details-show-on-map'));
    expect(onShowOnMap).toHaveBeenCalledTimes(1);
  });

  it('never offers a show-in-library action on the metadata card', () => {
    const video = makeVideo();

    renderThemed(<DetailsPanel video={video} analyzing={false} />);

    expect(screen.queryByTestId('details-show-in-library')).toBeNull();
  });

  it('renders no coordinates row when the video has no location', () => {
    const video = makeVideo();

    renderThemed(<DetailsPanel video={video} analyzing={false} location={null} />);

    expect(screen.queryByTestId('details-coordinates')).toBeNull();
  });

  it('badges a timeline-sourced location as approximate with its accuracy and shows the place', () => {
    const video = makeVideo();

    renderThemed(
      <DetailsPanel
        video={video}
        analyzing={false}
        location={{
          lat: 10.5,
          lon: 20.5,
          source: 'timeline',
          accuracyM: 150,
          place: { name: 'Fjordvik', region: 'Nordland', country: 'Norway' },
        }}
      />,
    );

    expect(screen.getByTestId('details-gps-source-badge').textContent).toContain('±150 m');
    expect(screen.getByTestId('details-place').textContent).toBe('Fjordvik · Nordland · Norway');
  });

  it('badges a camera-sourced location as measured, without an accuracy figure', () => {
    const video = makeVideo();

    renderThemed(
      <DetailsPanel video={video} analyzing={false} location={{ lat: 50.0614, lon: 19.9366, source: 'camera' }} />,
    );

    expect(screen.getByTestId('details-gps-source-badge').textContent).toBe('Measured (camera)');
  });

  it('renders the inline player with media source and no subtitles when segments are absent', () => {
    renderThemed(<DetailsPanel video={makeVideo({ status: 'pending' })} analyzing={false} />);

    const player = screen.getByTestId('detail-video-player');
    if (!(player instanceof HTMLVideoElement)) throw new Error('expected a video element');
    expect(player.getAttribute('src')).toBe('media://local/%2Fvideos%2Fclip.mp4');
    expect(player.autoplay).toBe(false);
    expect(screen.queryByTestId('detail-subtitles-track')).toBeNull();
  });

  it('renders a subtitles track defaulted on when timestamped transcript segments exist, using a blob: URL never a data: URL', () => {
    const objectUrl = 'blob:http://localhost/subtitles-fixture';
    const createObjectURL = vi.fn().mockReturnValue(objectUrl);
    const revokeObjectURL = vi.fn();
    class ObjectUrlStub extends URL {
      static override createObjectURL = createObjectURL;
      static override revokeObjectURL = revokeObjectURL;
    }
    vi.stubGlobal('URL', ObjectUrlStub);

    const video = makeVideo({
      artifacts: {
        ...makeVideo().artifacts,
        transcriptSegments: [{ start: 0, end: 1, text: 'hello' }],
      },
    });

    const rendered = renderThemed(<DetailsPanel video={video} analyzing={false} />);

    const track = screen.getByTestId('detail-subtitles-track');
    expect(track.getAttribute('src')).toBe(objectUrl);
    expect(track.getAttribute('src')).not.toContain('data:');
    if (!(track instanceof HTMLTrackElement)) throw new Error('expected a track element');
    expect(track.default).toBe(true);
    expect(createObjectURL).toHaveBeenCalledOnce();

    rendered.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith(objectUrl);
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
    expect(within(screen.getByTestId('media-detail-main')).getByText('Video Information')).toBeDefined();
    expect(within(screen.getByTestId('media-detail-media')).getByTestId('detail-video-player')).toBeDefined();
    expect(within(screen.getByTestId('media-detail-below')).getByText('Summary')).toBeDefined();
    expect(screen.getByText('Video Information')).toBeDefined();
  });

  it('hides the pending badge in video details while keeping the completed badge', () => {
    const pending = renderThemed(<DetailsPanel video={makeVideo({ status: 'pending' })} analyzing={false} />);
    expect(screen.queryByTestId('video-status-badge')).toBeNull();

    pending.unmount();
    renderThemed(<DetailsPanel video={makeVideo({ status: 'completed' })} analyzing={false} />);
    expect(screen.getByTestId('video-status-badge').textContent).toContain('Completed');
  });

  it('shows a duplicate video with the analyze-anyway affordance when idle', () => {
    const video = makeVideo({ status: 'pending', duplicate: { canonicalPath: '/videos/canon.mp4' } });
    renderThemed(<DetailsPanel video={video} analyzing={false} onAnalyze={vi.fn()} />);
    expect(screen.getByTestId('analyze-anyway-button')).toBeDefined();
    expect(screen.getByTestId('duplicate-badge')).toBeDefined();
    expect(screen.queryByTestId('video-status-badge')).toBeNull();
  });

  it('shows the duplicate notice as a plain section with a one-line copy field and a button to jump to the original', () => {
    const onNavigateToCanonical = vi.fn();
    const video = makeVideo({ status: 'pending', duplicate: { canonicalPath: '/videos/canon.mp4' } });
    renderThemed(
      <DetailsPanel
        video={video}
        analyzing={false}
        onAnalyze={vi.fn()}
        onNavigateToCanonical={onNavigateToCanonical}
      />,
    );

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Duplicate file' })).toBeDefined();
    const canonicalField = screen.getByTestId('duplicate-canonical-path');
    expect(canonicalField.textContent).toBe('/videos/canon.mp4');
    expect(canonicalField.tagName).toBe('CODE');
    expect(screen.queryByRole('link')).toBeNull();

    fireEvent.click(screen.getByTestId('duplicate-canonical-button'));
    expect(onNavigateToCanonical).toHaveBeenCalledWith('/videos/canon.mp4');
  });

  it('replaces the duplicate badge with Analyzing while a forced analysis runs', () => {
    const video = makeVideo({ status: 'pending', duplicate: { canonicalPath: '/videos/canon.mp4' } });
    renderThemed(<DetailsPanel video={video} analyzing onAnalyze={vi.fn()} />);
    expect(screen.getByTestId('video-status-badge').textContent).toContain('Analyzing…');
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

  it('loads the actual variants by stable fingerprint on the initial details open', async () => {
    const locators: string[] = [];
    server.use(
      http.get('/api/variants', ({ request }) => {
        const url = new URL(request.url);
        locators.push(url.search);
        return HttpResponse.json(variantsResponse([
          variant(firstConfigId, firstDescriptor, true, 'First summary'),
          variant(secondConfigId, secondDescriptor, false, 'Second summary'),
        ]));
      }),
    );

    renderThemed(<DetailsPanel video={makeVideo()} analyzing={false} />);

    await screen.findByTestId('variant-switcher');
    expect(screen.getByText('2 variants')).toBeDefined();
    expect(locators).toEqual(['?fingerprint=hash-a']);
  });

  it('offers a retry when a variant lookup fails and renders the recovered variants', async () => {
    let requests = 0;
    server.use(
      http.get('/api/variants', () => {
        requests += 1;
        if (requests === 1) {
          return HttpResponse.json(
            { ok: false, error: { code: 'internal', message: 'Catalog is catching up' } },
            { status: 503 },
          );
        }
        return HttpResponse.json(variantsResponse([
          variant(firstConfigId, firstDescriptor, true, 'Recovered summary'),
          variant(secondConfigId, secondDescriptor, false, 'Second summary'),
        ]));
      }),
    );

    renderThemed(<DetailsPanel video={makeVideo()} analyzing={false} />);

    const notice = await screen.findByTestId('variant-load-error');
    expect(notice.textContent).toContain('Could not load analysis variants.');
    fireEvent.click(within(notice).getByRole('button', { name: 'Retry' }));
    await screen.findByTestId('variant-switcher');
    expect(screen.getByText('2 variants')).toBeDefined();
    expect(requests).toBe(2);
  });

  it('keeps post-rename details and variant refreshes on the completed fingerprint', async () => {
    const locators: string[] = [];
    server.use(
      http.get('/api/variants', ({ request }) => {
        const url = new URL(request.url);
        locators.push(url.search);
        if (url.searchParams.get('fingerprint') !== 'hash-a') {
          return HttpResponse.json(
            { ok: false, error: { code: 'file_not_found', message: `File not found: ${url.searchParams.get('videoPath') ?? ''}` } },
            { status: 404 },
          );
        }
        return HttpResponse.json(variantsResponse([
          variant(firstConfigId, firstDescriptor, true, 'Fresh summary'),
        ]));
      }),
    );
    const rendered = renderThemed(<DetailsPanel video={makeVideo()} analyzing={false} />);
    await waitFor(() => expect(screen.queryByText('Loading analysis variants…')).toBeNull());
    const renamed = makeVideo({
      path: '/videos/2026-08-03_renamed.mp4',
      filename: '2026-08-03_renamed.mp4',
    });

    rendered.rerender(
      <QueryClientProvider client={rendered.queryClient}>
        <ThemeProvider theme={theme}>
          <DetailsPanel video={renamed} analyzing={false} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    await rendered.queryClient.invalidateQueries();

    expect(await screen.findByRole('heading', { name: '2026-08-03_renamed.mp4' })).toBeDefined();
    expect(screen.getByText('/videos/2026-08-03_renamed.mp4')).toBeDefined();
    expect(screen.queryByTestId('variant-switcher')).toBeNull();
    expect(screen.queryByText('Settings partly unknown')).toBeNull();
    expect(locators.every((locator) => locator === '?fingerprint=hash-a')).toBe(true);
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

  it('selects the preview once while retaining the loaded variant payload', async () => {
    let selectionWrites = 0;
    let variantReads = 0;
    server.use(
      http.get('/api/variants', () => {
        variantReads += 1;
        return HttpResponse.json(variantsResponse([
          variant(firstConfigId, firstDescriptor, true, 'First summary'),
          variant(secondConfigId, secondDescriptor, false, 'Second summary'),
        ]));
      }),
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
      ['search'],
    ]);
    expect(variantReads).toBe(1);
    expect(within(screen.getByTestId(`variant-option-${secondConfigId}`)).getByText('Selected')).toBeDefined();
    expect(within(screen.getByTestId(`variant-option-${firstConfigId}`)).queryByText('Selected')).toBeNull();
  });

  it('compares variants in parallel and selects from a comparison column', async () => {
    let selectionWrites = 0;
    let selectedConfigId = firstConfigId;
    server.use(
      http.get('/api/variants', () => HttpResponse.json(variantsResponse([
        variant(firstConfigId, firstDescriptor, selectedConfigId === firstConfigId, 'First summary'),
        {
          ...variant(secondConfigId, secondDescriptor, selectedConfigId === secondConfigId, 'Second summary'),
          estimatedCostUsd: 0.0123,
          usage: { totalTokens: 4321, estimatedCostUsd: 0.0123 },
        },
      ]))),
      http.post('/api/variants/select', () => {
        selectionWrites += 1;
        selectedConfigId = secondConfigId;
        return HttpResponse.json({ ok: true, data: { fingerprint: 'hash-a', configId: secondConfigId } });
      }),
    );
    const video = makeVideo({
      artifacts: {
        ...makeVideo().artifacts,
        framePaths: ['/selected/frame-001.jpg', '/selected/frame-002.jpg'],
      },
    });

    renderThemed(<DetailsPanel video={video} analyzing={false} />);

    await screen.findByTestId('variant-switcher');
    fireEvent.click(screen.getByTestId('compare-variants'));

    expect(screen.getByTestId('variant-compare-layout')).toBeDefined();
    expect(screen.getByTestId('variant-compare-columns').children).toHaveLength(2);
    const firstColumn = screen.getByTestId(`variant-compare-column-${firstConfigId}`);
    const secondColumn = screen.getByTestId(`variant-compare-column-${secondConfigId}`);
    expect(within(firstColumn).getByText('First summary')).toBeDefined();
    expect(within(firstColumn).getByText('First summary transcript')).toBeDefined();
    expect(within(firstColumn).getByText('First summary tag')).toBeDefined();
    expect(within(firstColumn).getByTestId('active-frame')).toBeDefined();
    expect(within(secondColumn).getByText('Second summary')).toBeDefined();
    expect(within(secondColumn).getByText('Output language: Polish')).toBeDefined();
    expect(within(secondColumn).getByText('Prompt version: 1')).toBeDefined();
    expect(within(secondColumn).getByText('Estimated cost: $0.0123 USD')).toBeDefined();
    expect(screen.getAllByText('Video duration: 1:30')).toHaveLength(2);

    const selectedAction = within(firstColumn).getByRole('button', { name: 'Use as selected' });
    if (!(selectedAction instanceof HTMLButtonElement)) throw new Error('expected a button');
    expect(selectedAction.disabled).toBe(true);
    fireEvent.click(within(secondColumn).getByRole('button', { name: 'Use as selected' }));
    await waitFor(() => expect(selectionWrites).toBe(1));
    await screen.findByTestId('detail-layout');
    expect(screen.queryByTestId('variant-compare-layout')).toBeNull();
    expect(screen.getByText('Second summary')).toBeDefined();
    await waitFor(() => expect(
      within(screen.getByTestId(`variant-option-${secondConfigId}`)).getByText('Selected'),
    ).toBeDefined());
  });

  it('keeps unrelated comparison controls usable while one selection is pending', async () => {
    let selectionCompleted = false;
    let releaseSelection: () => void = () => undefined;
    const pendingSelection = new Promise<void>((resolve) => {
      releaseSelection = () => resolve();
    });
    server.use(
      http.get('/api/variants', () => HttpResponse.json(variantsResponse([
        variant(firstConfigId, firstDescriptor, true, 'First summary'),
        variant(secondConfigId, secondDescriptor, false, 'Second summary'),
        variant(thirdConfigId, thirdDescriptor, false, 'Third summary'),
      ]))),
      http.post('/api/variants/select', async () => {
        await pendingSelection;
        selectionCompleted = true;
        return HttpResponse.json({ ok: true, data: { fingerprint: 'hash-a', configId: secondConfigId } });
      }),
    );

    renderThemed(<DetailsPanel video={makeVideo()} analyzing={false} />);

    await screen.findByTestId('variant-switcher');
    fireEvent.click(screen.getByTestId('compare-variants'));
    const pendingAction = screen.getByTestId(`compare-use-as-selected-${secondConfigId}`);
    const unrelatedAction = screen.getByTestId(`compare-use-as-selected-${thirdConfigId}`);
    const back = screen.getByRole('button', { name: 'Back to file details' });
    fireEvent.click(pendingAction);

    await waitFor(() => {
      if (!(pendingAction instanceof HTMLButtonElement)) throw new Error('expected a button');
      expect(pendingAction.disabled).toBe(true);
    });
    if (!(unrelatedAction instanceof HTMLButtonElement)) throw new Error('expected a button');
    if (!(back instanceof HTMLButtonElement)) throw new Error('expected a button');
    expect(unrelatedAction.disabled).toBe(false);
    expect(back.disabled).toBe(false);
    fireEvent.click(back);
    expect(screen.getByTestId('detail-layout')).toBeDefined();
    releaseSelection();
    await waitFor(() => expect(selectionCompleted).toBe(true));
  });

  it('formats Gemini native labels once and keeps a placeholder in the frames row', async () => {
    const geminiConfigId = 'cfg_444444444444';
    server.use(
      http.get('/api/variants', () => HttpResponse.json(variantsResponse([
        variant(firstConfigId, firstDescriptor, true, 'First summary'),
        {
          ...variant(geminiConfigId, geminiDescriptor, false, 'Gemini summary'),
          artifacts: {
            framesDirectory: null,
            transcriptPath: `/catalog/artifacts/transcripts/hash-a/${geminiConfigId}.txt`,
            summaryPath: `/catalog/variants/hash-a/${geminiConfigId}/summary.txt`,
          },
        },
      ]))),
    );
    const video = makeVideo({
      artifacts: {
        ...makeVideo().artifacts,
        framePaths: ['/selected/frame-001.jpg', '/selected/frame-002.jpg'],
      },
    });

    renderThemed(<DetailsPanel video={video} analyzing={false} />);

    await screen.findByTestId('variant-switcher');
    fireEvent.click(screen.getByTestId('compare-variants'));

    const geminiColumn = screen.getByTestId(`variant-compare-column-${geminiConfigId}`);
    expect(within(geminiColumn).getByText('gemini-3.6-flash - native transcript - no frames')).toBeDefined();
    const placeholder = within(geminiColumn).getByTestId(`variant-no-frames-${geminiConfigId}`);
    expect(placeholder.textContent).toBe('This variant does not extract frames');
  });

  it('states when analysis creates a variant and sets the current configuration as folder default', async () => {
    const onAnalyze = vi.fn();
    server.use(
      http.get('/api/variants', () => HttpResponse.json(variantsResponse(
        [variant(firstConfigId, firstDescriptor, true, 'First summary')],
        { configId: thirdConfigId, descriptor: thirdDescriptor },
      ))),
    );

    renderThemed(<DetailsPanel video={makeVideo()} analyzing={false} onAnalyze={onAnalyze} />);

    const analyze = await screen.findByTestId('analyze-button');
    expect(analyze.textContent).toContain('Analyze as new variant');
    expect(screen.getByText(/Creates a new variant/)).toBeDefined();
    fireEvent.click(analyze);
    expect(onAnalyze).toHaveBeenCalledWith(makeVideo());
  });

  it('reads just "Analyze" with no variant-creation caption for a video that has never been analyzed', async () => {
    const onAnalyze = vi.fn();
    server.use(http.get('/api/variants', () => HttpResponse.json(variantsResponse([]))));

    const video = makeVideo({ status: 'pending' });
    renderThemed(<DetailsPanel video={video} analyzing={false} onAnalyze={onAnalyze} />);

    await waitFor(() => expect(screen.getByTestId('analyze-button').textContent).toBe('Analyze'));
    expect(screen.queryByText(/Creates a new variant/)).toBeNull();
    fireEvent.click(screen.getByTestId('analyze-button'));
    expect(onAnalyze).toHaveBeenCalledWith(video);
  });

  it('hides the entire variants section when the video has just one variant — no "1 variant" line, no pro-feature affordance for a non-choice', async () => {
    server.use(
      http.get('/api/variants', () => HttpResponse.json(variantsResponse([
        variant(firstConfigId, firstDescriptor, true, 'First summary'),
      ]))),
    );

    renderThemed(<DetailsPanel video={makeVideo()} analyzing={false} />);

    await waitFor(() => expect(screen.queryByText('Loading analysis variants…')).toBeNull());
    expect(screen.queryByTestId('variant-switcher')).toBeNull();
    expect(screen.queryByText(/variant/i)).toBeNull();
  });

  it('never offers a folder-default button in the UI — the mechanism is dormant, not exposed', async () => {
    server.use(
      http.get('/api/variants', () => HttpResponse.json(variantsResponse([
        variant(firstConfigId, firstDescriptor, false, 'First summary'),
        variant(secondConfigId, secondDescriptor, true, 'Second summary'),
      ]))),
    );

    renderThemed(<DetailsPanel video={makeVideo()} analyzing={false} />);

    await screen.findByTestId('variant-switcher');
    expect(screen.queryByTestId('set-folder-default-variant')).toBeNull();
    expect(screen.queryByText('Use current configuration as folder default')).toBeNull();
  });

  it('shows the selected variant as a completed-status badge, not a plain filled chip', async () => {
    server.use(
      http.get('/api/variants', () => HttpResponse.json(variantsResponse([
        variant(firstConfigId, firstDescriptor, true, 'First summary'),
        variant(secondConfigId, secondDescriptor, false, 'Second summary'),
      ]))),
    );

    renderThemed(<DetailsPanel video={makeVideo()} analyzing={false} />);

    await screen.findByTestId('variant-switcher');
    const badge = screen.getByTestId('variant-selected-badge');
    expect(badge.getAttribute('data-status-badge')).toBe('');
    expect(badge.textContent).toContain('Selected');
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

  it('renders the interrupted-processing notice as a plain section, not an assertive alert, and the resume button as the primary filled action even while disabled', () => {
    renderThemed(
      <StatusActions video={makeVideo({ status: 'transcribed' })} analyzing onAnalyze={vi.fn()} />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Processing Incomplete' })).toBeDefined();
    const button = screen.getByTestId('analyze-button');
    if (!(button instanceof HTMLButtonElement)) throw new Error('expected a button');
    expect(button.className).toContain('MuiButton-contained');
    expect(button.disabled).toBe(true);
  });

  it('renders the failed-processing notice as a plain section, not an assertive alert', () => {
    renderThemed(
      <StatusActions
        video={makeVideo({ status: 'error', errorMessage: 'ffmpeg exploded' })}
        analyzing={false}
        onAnalyze={vi.fn()}
      />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Processing Failed' })).toBeDefined();
  });
});
