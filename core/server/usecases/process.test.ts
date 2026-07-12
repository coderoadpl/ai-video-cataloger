import { describe, expect, it } from 'vitest';

import type { VideoStatus } from '@core/domain/index.js';

import { enqueueProcess } from './jobs.js';
import { normalizeKebabSlug, parseAnalysisResponse, processVideoPipeline, type ProcessDeps } from './process.js';
import { scanFolder } from './scan.js';
import {
  InMemoryAnalyzer,
  InMemoryCatalogs,
  InMemoryConfig,
  InMemoryFileSystem,
  InMemoryJobs,
  InMemoryMedia,
  InMemoryTranscriber,
  videoFixture,
} from '../../../test/server/usecases/test-fakes.js';

const videoPath = '/work/Clip One.mp4';
const baseInput = {
  videoPath,
  frames: 3,
  skipRename: false,
  verbose: false,
  timeout: 120,
  whisper: 'local',
  whisperModel: 'base',
} as const;

const makeDeps = (status: VideoStatus = 'pending'): ProcessDeps & {
  fs: InMemoryFileSystem;
  catalogs: InMemoryCatalogs;
  config: InMemoryConfig;
  media: InMemoryMedia;
  transcriber: InMemoryTranscriber;
  analyzer: InMemoryAnalyzer;
} => {
  const fs = new InMemoryFileSystem('/work');
  fs.addFile(videoPath, {
    size: 1000,
    mtimeMs: new Date('2024-05-06T12:00:00.000Z').getTime(),
    hash: 'hash-clip',
  });
  const catalogs = new InMemoryCatalogs([
    {
      folder: '/work',
      videos: [videoFixture({ originalPath: videoPath, originalName: 'Clip One.mp4', fileHash: 'hash-clip', status })],
    },
  ]);
  return {
    catalogs,
    config: new InMemoryConfig(),
    fs,
    media: new InMemoryMedia(),
    transcriber: new InMemoryTranscriber(),
    analyzer: new InMemoryAnalyzer(),
  };
};

const seedFrames = (fs: InMemoryFileSystem): void => {
  fs.addFile('/work/frames/Clip One/frame-001.jpg');
  fs.addFile('/work/frames/Clip One/frame-002.jpg');
  fs.addFile('/work/frames/Clip One/frame-003.jpg');
};

const seedTranscript = (fs: InMemoryFileSystem): void => {
  fs.addFile('/work/transcripts/Clip One.txt', { content: 'existing transcript' });
};

const seedSummary = (fs: InMemoryFileSystem): void => {
  fs.addFile('/work/summaries/Clip One.json', {
    content: JSON.stringify({
      schemaVersion: 1,
      description: 'Done',
      suggestedFilename: 'existing-summary',
      fullAnalysis: 'DESCRIPTION: Done\nFILENAME: existing-summary',
      analyzedAt: '2026-01-01T00:00:00.000Z',
    }),
  });
};

describe('analysis response parser', () => {
  it('captures multi-line descriptions and normalizes filenames', () => {
    const result = parseAnalysisResponse(`DESCRIPTION: First line
second line
FILENAME: My Nice_Clip!!!`);

    expect(result).toEqual({
      ok: true,
      value: {
        description: 'First line second line',
        suggestedFilename: 'my-niceclip',
        fullAnalysis: 'DESCRIPTION: First line\nsecond line\nFILENAME: My Nice_Clip!!!',
      },
    });
  });

  it('fails on missing filename and falls back description when only filename exists', () => {
    expect(parseAnalysisResponse('DESCRIPTION: only description')).toMatchObject({
      ok: false,
      error: { code: 'analysis_parse_failed' },
    });

    const fallback = parseAnalysisResponse(`Some long analysis
FILENAME: !!!`);

    expect(fallback).toMatchObject({
      ok: true,
      value: { description: 'Some long analysis\nFILENAME: !!!', suggestedFilename: 'video' },
    });
    expect(normalizeKebabSlug('!!!')).toBe('video');
  });
});

describe('process pipeline resume behavior', () => {
  const cases: ReadonlyArray<{ status: VideoStatus; expectedStep: string | null; seed: (fs: InMemoryFileSystem) => void }> = [
    { status: 'pending', expectedStep: 'extracting_frames', seed: () => undefined },
    { status: 'frames_extracted', expectedStep: 'extracting_audio', seed: seedFrames },
    { status: 'audio_extracted', expectedStep: 'transcribing_audio', seed: seedFrames },
    {
      status: 'transcribed',
      expectedStep: 'analyzing_with_claude',
      seed: (fs) => {
        seedFrames(fs);
        seedTranscript(fs);
      },
    },
    {
      status: 'analyzed',
      expectedStep: 'renaming_video',
      seed: (fs) => {
        seedFrames(fs);
        seedSummary(fs);
      },
    },
    { status: 'completed', expectedStep: null, seed: () => undefined },
  ];

  for (const entry of cases) {
    it(`resumes from ${entry.status}`, async () => {
      const deps = makeDeps(entry.status);
      const progress: string[] = [];
      entry.seed(deps.fs);

      const result = await processVideoPipeline(deps, baseInput, {
        reportProgress: (event) => {
          progress.push(event.step);
          return Promise.resolve({ ok: true, value: undefined });
        },
      });

      expect(result).toMatchObject({ ok: true, value: { status: 'completed' } });
      expect(progress[0] ?? null).toBe(entry.expectedStep);
    });
  }

  it('inspects error artifacts and resumes at analysis when frames and transcript are present', async () => {
    const deps = makeDeps('error');
    seedFrames(deps.fs);
    seedTranscript(deps.fs);

    const events: string[] = [];
    const result = await processVideoPipeline(deps, baseInput, {
      reportProgress: (event) => {
        events.push(event.step);
        return Promise.resolve({ ok: true, value: undefined });
      },
    });

    expect(result).toMatchObject({ ok: true });
    expect(events[0]).toBe('analyzing_with_claude');
    expect(deps.media.audioInputs).toHaveLength(0);
    expect(deps.transcriber.inputs).toHaveLength(0);
    expect(deps.analyzer.inputs[0]?.transcript).toBe('existing transcript');
  });

  it('inspects error artifacts and resumes at audio when frames are complete', async () => {
    const deps = makeDeps('error');
    seedFrames(deps.fs);

    const events: string[] = [];
    await processVideoPipeline(deps, baseInput, {
      reportProgress: (event) => {
        events.push(event.step);
        return Promise.resolve({ ok: true, value: undefined });
      },
    });

    expect(events[0]).toBe('extracting_audio');
    expect(deps.media.frameInputs).toHaveLength(0);
    expect(deps.media.audioInputs).toHaveLength(1);
  });

  it('re-extracts frames when retry artifacts are partial', async () => {
    const deps = makeDeps('error');
    deps.fs.addFile('/work/frames/Clip One/frame-001.jpg');

    const events: string[] = [];
    await processVideoPipeline(deps, baseInput, {
      reportProgress: (event) => {
        events.push(event.step);
        return Promise.resolve({ ok: true, value: undefined });
      },
    });

    expect(events[0]).toBe('extracting_frames');
    expect(deps.media.frameInputs).toHaveLength(1);
  });

  it('skips existing transcripts and cleans up temp audio after transcription', async () => {
    const deps = makeDeps('frames_extracted');
    seedFrames(deps.fs);
    seedTranscript(deps.fs);

    await processVideoPipeline(deps, baseInput);

    expect(deps.media.audioInputs).toHaveLength(0);
    expect(deps.transcriber.inputs).toHaveLength(0);

    const audioDeps = makeDeps('frames_extracted');
    seedFrames(audioDeps.fs);
    await processVideoPipeline(audioDeps, baseInput);

    expect(audioDeps.transcriber.inputs[0]?.audioPath).toBe('/tmp/ai-video-cataloger/audio/Clip One.wav');
    await expect(audioDeps.fs.exists('/tmp/ai-video-cataloger/audio/Clip One.wav')).resolves.toEqual({
      ok: true,
      value: false,
    });
  });

  it('writes debug logs before parse failures and stores error status', async () => {
    const deps = makeDeps('transcribed');
    seedFrames(deps.fs);
    seedTranscript(deps.fs);
    deps.analyzer.rawResponse = 'DESCRIPTION: no filename here';

    const result = await processVideoPipeline(deps, baseInput);
    const videos = await deps.catalogs.repo('/work').listVideos();
    const debug = await deps.fs.readTextFile('/work/summaries/Clip One-debug.log');
    const summary = await deps.fs.exists('/work/summaries/Clip One.json');

    expect(result).toMatchObject({ ok: false, error: { code: 'analysis_parse_failed' } });
    expect(videos).toMatchObject({ ok: true, value: [{ status: 'error' }] });
    expect(debug).toMatchObject({ ok: true, value: expect.stringContaining('DESCRIPTION: no filename here') });
    expect(summary).toEqual({ ok: true, value: false });
  });

  it('returns analysis_parse_failed when resuming analyzed without valid summary JSON', async () => {
    const missingDeps = makeDeps('analyzed');
    const missing = await processVideoPipeline(missingDeps, baseInput);

    expect(missing).toMatchObject({ ok: false, error: { code: 'analysis_parse_failed' } });

    const invalidDeps = makeDeps('analyzed');
    invalidDeps.fs.addFile('/work/summaries/Clip One.json', { content: '{"suggestedFilename": 42}' });
    const invalid = await processVideoPipeline(invalidDeps, baseInput);

    expect(invalid).toMatchObject({ ok: false, error: { code: 'analysis_parse_failed' } });
  });

  it('deletes temp audio when whisper mode skips transcription', async () => {
    const deps = makeDeps('audio_extracted');
    seedFrames(deps.fs);
    deps.fs.addFile('/tmp/ai-video-cataloger/audio/Clip One.wav', { content: 'audio' });

    await processVideoPipeline(deps, { ...baseInput, whisper: 'skip', whisperExplicit: true });

    expect(deps.transcriber.inputs).toHaveLength(0);
    await expect(deps.fs.exists('/tmp/ai-video-cataloger/audio/Clip One.wav')).resolves.toEqual({
      ok: true,
      value: false,
    });
  });
});

describe('process pipeline rename and jobs', () => {
  it('renames with date prefix, conflict suffix, and artifact co-rename set', async () => {
    const deps = makeDeps('analyzed');
    seedSummary(deps.fs);
    deps.fs.addFile('/work/2024-05-06_existing-summary.mp4');
    deps.fs.addFile('/work/frames/Clip One/frame-001.jpg');
    deps.fs.addFile('/work/transcripts/Clip One.txt', { content: 'transcript' });
    deps.fs.addFile('/work/summaries/Clip One.txt', { content: 'summary txt' });
    deps.fs.addFile('/work/.ai-video-cataloger/thumbnails/Clip One.jpg');

    const result = await processVideoPipeline(deps, baseInput);
    const repo = deps.catalogs.repo('/work');
    const videos = await repo.listVideos();
    const scan = await scanFolder(deps, { folder: '/work' });

    expect(result).toMatchObject({
      ok: true,
      value: { video: '2024-05-06_existing-summary-2.mp4', path: '/work/2024-05-06_existing-summary-2.mp4' },
    });
    expect(videos).toMatchObject({
      ok: true,
      value: [
        {
          originalPath: '/work/2024-05-06_existing-summary-2.mp4',
          newName: '2024-05-06_existing-summary-2.mp4',
          status: 'completed',
        },
      ],
    });
    expect(scan).toMatchObject({
      ok: true,
      value: {
        videos: expect.arrayContaining([
          expect.objectContaining({
            path: '/work/2024-05-06_existing-summary-2.mp4',
            status: 'completed',
            contentHash: 'hash-clip',
          }),
        ]),
      },
    });
    await expect(deps.fs.exists('/work/frames/2024-05-06_existing-summary-2')).resolves.toEqual({ ok: true, value: true });
    await expect(deps.fs.exists('/work/transcripts/2024-05-06_existing-summary-2.txt')).resolves.toEqual({ ok: true, value: true });
    await expect(deps.fs.exists('/work/summaries/2024-05-06_existing-summary-2.txt')).resolves.toEqual({ ok: true, value: true });
    await expect(deps.fs.exists('/work/summaries/2024-05-06_existing-summary-2.json')).resolves.toEqual({ ok: true, value: true });
    await expect(deps.fs.exists('/work/.ai-video-cataloger/thumbnails/2024-05-06_existing-summary-2.jpg')).resolves.toEqual({
      ok: true,
      value: true,
    });
  });

  it('runs through JobsPort with typed progress sequence and supports skip rename', async () => {
    const deps = makeDeps('pending');
    const jobs = new InMemoryJobs();
    const result = await enqueueProcess({ ...deps, jobs }, { ...baseInput, skipRename: true, skipRenameExplicit: true });
    const record = await jobs.get('job-1');

    expect(result).toEqual({ ok: true, value: { jobId: 'job-1' } });
    expect(jobs.progressEvents.map((event) => event.step)).toEqual([
      'extracting_frames',
      'extracting_audio',
      'transcribing_audio',
      'analyzing_with_claude',
      'skipping_rename',
    ]);
    expect(jobs.progressEvents.map((event) => event.percentage)).toEqual([20, 40, 60, 80, 100]);
    expect(jobs.progressEvents[0]).toMatchObject({
      current: 1,
      total: 1,
      stepNumber: 1,
      totalSteps: 5,
      data: { video: videoPath, stepNumber: 1, totalSteps: 5 },
    });
    expect(record).toMatchObject({ ok: true, value: { status: 'completed', progress: { step: 'skipping_rename' } } });
  });

  it('honors analyzer flag over config and bumps local timeout only when not explicit', async () => {
    const deps = makeDeps('transcribed');
    seedFrames(deps.fs);
    seedTranscript(deps.fs);
    await deps.config.set({ kind: 'folder', folder: '/work' }, 'analyzer_backend', 'local');
    await deps.config.set({ kind: 'folder', folder: '/work' }, 'local_model', 'configured:model');

    await processVideoPipeline(deps, { ...baseInput, analyzer: 'claude', localModel: 'flag:model' });

    expect(deps.analyzer.inputs[0]).toMatchObject({
      backend: 'claude',
      localModel: 'flag:model',
      timeoutSeconds: 120,
    });

    const localDeps = makeDeps('transcribed');
    seedFrames(localDeps.fs);
    seedTranscript(localDeps.fs);
    await localDeps.config.set({ kind: 'folder', folder: '/work' }, 'analyzer_backend', 'local');
    await processVideoPipeline(localDeps, { ...baseInput });

    expect(localDeps.analyzer.inputs[0]?.timeoutSeconds).toBe(300);

    const explicitDeps = makeDeps('transcribed');
    seedFrames(explicitDeps.fs);
    seedTranscript(explicitDeps.fs);
    await explicitDeps.config.set({ kind: 'folder', folder: '/work' }, 'analyzer_backend', 'local');
    await processVideoPipeline(explicitDeps, { ...baseInput, timeout: 180, timeoutExplicit: true });

    expect(explicitDeps.analyzer.inputs[0]?.timeoutSeconds).toBe(180);
  });

  it('resolves process keys from folder config when flags are absent', async () => {
    const deps = makeDeps('pending');
    await deps.config.set({ kind: 'folder', folder: '/work' }, 'frames', '5');
    await deps.config.set({ kind: 'folder', folder: '/work' }, 'whisper_mode', 'api');
    await deps.config.set({ kind: 'folder', folder: '/work' }, 'whisper_model', 'small');
    await deps.config.set({ kind: 'folder', folder: '/work' }, 'skip_rename', 'true');

    await processVideoPipeline(deps, baseInput);

    expect(deps.media.frameInputs[0]?.frameCount).toBe(5);
    expect(deps.transcriber.inputs[0]).toMatchObject({ mode: 'api', model: 'small' });
    expect(await deps.fs.exists('/work/Clip One.mp4')).toEqual({ ok: true, value: true });
  });

  it('lets explicit process flags override folder config', async () => {
    const deps = makeDeps('pending');
    await deps.config.set({ kind: 'folder', folder: '/work' }, 'frames', '5');
    await deps.config.set({ kind: 'folder', folder: '/work' }, 'whisper_mode', 'api');
    await deps.config.set({ kind: 'folder', folder: '/work' }, 'whisper_model', 'small');
    await deps.config.set({ kind: 'folder', folder: '/work' }, 'skip_rename', 'true');

    await processVideoPipeline(deps, {
      ...baseInput,
      frames: 2,
      framesExplicit: true,
      skipRename: false,
      skipRenameExplicit: true,
      whisper: 'local',
      whisperExplicit: true,
      whisperModel: 'base',
      whisperModelExplicit: true,
    });

    expect(deps.media.frameInputs[0]?.frameCount).toBe(2);
    expect(deps.transcriber.inputs[0]).toMatchObject({ mode: 'local', model: 'base' });
    expect(await deps.fs.exists('/work/2024-05-06_useful-clip.mp4')).toEqual({ ok: true, value: true });
  });
});
