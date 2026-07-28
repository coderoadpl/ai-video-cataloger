import { describe, expect, it } from 'vitest';

import {
  appError,
  defaultGeminiNativeProvider,
  geminiUsageAccounting,
  type AppError,
  type Result,
  type VideoStatus,
} from '@core/domain/index.js';

import { enqueueProcess } from './jobs.js';
import { normalizeKebabSlug, parseAnalysisResponse, parseTagsLine, processVideoPipeline, tempAudioPath, type ProcessDeps } from './process.js';
import { scanFolder } from './scan.js';
import {
  InMemoryAnalyzer,
  InMemoryCatalogs,
  InMemoryConfig,
  InMemoryFileSystem,
  InMemoryGlobalCatalogStore,
  InMemoryJobs,
  InMemoryMedia,
  InMemorySpendLedger,
  InMemoryTranscriber,
  videoFixture,
} from '../../../test/server/usecases/test-fakes.js';

const videoPath = '/work/Clip One.mp4';
const idleSignal = new AbortController().signal;
const baseInput = {
  videoPath,
  frames: 3,
  skipRename: false,
  verbose: false,
  timeout: 120,
  whisper: 'local',
  whisperModel: 'base',
} as const;

class ThirdArtifactRenameFailureFileSystem extends InMemoryFileSystem {
  private artifactRenames = 0;

  override renamePath(from: string, to: string): Promise<Result<void, AppError>> {
    if (from !== videoPath && !from.endsWith('.tmp')) {
      this.artifactRenames += 1;
      if (this.artifactRenames === 3) {
        return Promise.resolve({ ok: false, error: appError('internal', 'Third artifact rename failed') });
      }
    }
    return super.renamePath(from, to);
  }
}

const makeDeps = (status: VideoStatus = 'pending', fs = new InMemoryFileSystem('/work')): ProcessDeps & {
  fs: InMemoryFileSystem;
  catalogs: InMemoryCatalogs;
  config: InMemoryConfig;
  media: InMemoryMedia;
  transcriber: InMemoryTranscriber;
  analyzer: InMemoryAnalyzer;
  spendLedger: InMemorySpendLedger;
} => {
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
    media: new InMemoryMedia(fs),
    transcriber: new InMemoryTranscriber(fs),
    analyzer: new InMemoryAnalyzer(),
    spendLedger: new InMemorySpendLedger(),
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
FILENAME: My Nice_Clip!!!
TAGS: Red Car, City Street, Wide Shot, red-car`);

    expect(result).toEqual({
      ok: true,
      value: {
        description: 'First line second line',
        suggestedFilename: 'my-niceclip',
        fullAnalysis: 'DESCRIPTION: First line\nsecond line\nFILENAME: My Nice_Clip!!!\nTAGS: Red Car, City Street, Wide Shot, red-car',
        tags: ['red-car', 'city-street', 'wide-shot'],
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
      value: { description: 'Some long analysis\nFILENAME: !!!', suggestedFilename: 'video', tags: [] },
    });
    expect(normalizeKebabSlug('!!!')).toBe('video');
  });

  it('tolerates missing and malformed tags without failing analysis', () => {
    const missing = parseAnalysisResponse('DESCRIPTION: A clip\nFILENAME: a-clip');
    const malformed = parseAnalysisResponse('DESCRIPTION: A clip\nFILENAME: a-clip\nTAGS: !!!, Drone Shot, @@@');

    expect(missing).toMatchObject({ ok: true, value: { tags: [] } });
    expect(malformed).toMatchObject({ ok: true, value: { tags: ['drone-shot'] } });
  });

  it('normalizes, dedupes, truncates and caps parsed tags', () => {
    expect(parseTagsLine('One Tag, one-tag, TWO_TAG, tag-4, tag-5, tag-6, tag-7, tag-8, tag-9, tag-10, tag-11, tag-12, tag-13'))
      .toEqual(['one-tag', 'two-tag', 'tag-4', 'tag-5', 'tag-6', 'tag-7', 'tag-8', 'tag-9', 'tag-10', 'tag-11', 'tag-12', 'tag-13']);
    expect(parseTagsLine('abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz')).toEqual(['abcdefghijklmnopqrstuvwxyzabcdefghijklmn']);
  });
});

describe('process pipeline resume behavior', () => {
  const cases: ReadonlyArray<{ status: VideoStatus; expectedStep: string | null; seed: (fs: InMemoryFileSystem) => void }> = [
    { status: 'pending', expectedStep: 'extracting_frames', seed: () => undefined },
    { status: 'frames_extracted', expectedStep: 'extracting_audio', seed: seedFrames },
    {
      status: 'audio_extracted',
      expectedStep: 'transcribing_audio',
      seed: (fs) => {
        seedFrames(fs);
        fs.addFile(tempAudioPath(fs, videoPath), { content: 'audio' });
      },
    },
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
        signal: idleSignal,
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
      signal: idleSignal,
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

  it('passes a freshly transcribed local transcript to the analyzer', async () => {
    const deps = makeDeps('pending');

    const result = await processVideoPipeline(deps, { ...baseInput, skipRename: true, skipRenameExplicit: true });

    expect(result).toMatchObject({ ok: true });
    expect(deps.analyzer.inputs[0]?.transcript).toBe('transcript');
  });

  it('runs the native gemini path: skips frames and whisper, stores transcript and surfaces usage', async () => {
    const deps = makeDeps('pending');
    await deps.config.set(
      { kind: 'folder', folder: '/work' },
      'analyzer_provider',
      JSON.stringify(defaultGeminiNativeProvider('gemini-3.6-flash')),
    );
    deps.analyzer.rawResponse = 'DESCRIPTION: A boat museum hall.\nFILENAME: boat-museum-hall\nTAGS: boat, museum\nTRANSCRIPT:\n[00:00] czesc';
    deps.analyzer.usage = geminiUsageAccounting(
      { promptTokens: 1700, candidatesTokens: 800, thoughtsTokens: 100 },
      'gemini-3.6-flash',
    );
    deps.analyzer.transcript = { text: 'czesc', segments: [{ start: 0, end: 1, text: 'czesc' }] };

    const events: Array<{ step: string; data?: Record<string, unknown> | undefined }> = [];
    const result = await processVideoPipeline(deps, { ...baseInput, skipRename: true, skipRenameExplicit: true }, {
      signal: idleSignal,
      reportProgress: (event) => {
        events.push({ step: event.step, data: event.data });
        return Promise.resolve({ ok: true, value: undefined });
      },
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'completed',
        costEstimate: { kind: 'estimate', model: 'gemini-3.6-flash', estimatedCostUsd: 0.0093 },
      },
    });
    expect(deps.media.frameInputs).toHaveLength(0);
    expect(deps.media.audioInputs).toHaveLength(0);
    expect(deps.transcriber.inputs).toHaveLength(0);
    expect(deps.analyzer.inputs[0]?.framePaths).toEqual([]);
    expect(deps.analyzer.inputs[0]?.transcript).toBeNull();
    const usageEvent = events.find((event) => event.data?.usage !== undefined);
    expect(usageEvent?.data?.model).toBe('gemini-3.6-flash');
    const txt = await deps.fs.readTextFile('/work/transcripts/Clip One.txt');
    expect(txt.ok && txt.value).toContain('czesc');
    const json = await deps.fs.readTextFile('/work/transcripts/Clip One.json');
    expect(json.ok && json.value).toContain('"start": 0');
    expect(deps.spendLedger.entries).toHaveLength(1);
    expect(deps.spendLedger.entries[0]).toMatchObject({
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      videoPath,
      runId: null,
      estimatedCostUsd: 0.0093,
    });
    const summary = await deps.fs.readTextFile('/work/summaries/Clip One.json');
    expect(summary.ok && summary.value).toContain('"costEstimate"');
  });

  it('runs the native gemini path with rename and no transcript or usage', async () => {
    const deps = makeDeps('pending');
    await deps.config.set(
      { kind: 'folder', folder: '/work' },
      'analyzer_provider',
      JSON.stringify(defaultGeminiNativeProvider('gemini-flash-lite-latest')),
    );
    deps.analyzer.rawResponse = 'DESCRIPTION: A litter bin.\nFILENAME: litter-bin\nTAGS: bin';

    const result = await processVideoPipeline(deps, baseInput);

    expect(result).toMatchObject({ ok: true, value: { status: 'completed' } });
    expect(deps.media.frameInputs).toHaveLength(0);
    expect(deps.transcriber.inputs).toHaveLength(0);
    if (!result.ok) return;
    expect(result.value.video).toContain('litter-bin');
  });

  it('does not extract audio when whisper is skipped', async () => {
    const deps = makeDeps('pending');

    const events: string[] = [];
    const result = await processVideoPipeline(deps, { ...baseInput, whisper: 'skip', whisperExplicit: true }, {
      signal: idleSignal,
      reportProgress: (event) => {
        events.push(event.step);
        return Promise.resolve({ ok: true, value: undefined });
      },
    });

    expect(result).toMatchObject({ ok: true, value: { status: 'completed' } });
    expect(events).toEqual([
      'extracting_frames',
      'extracting_audio',
      'transcribing_audio',
      'analyzing_with_claude',
      'renaming_video',
    ]);
    expect(deps.media.audioInputs).toHaveLength(0);
    expect(deps.transcriber.inputs).toHaveLength(0);
    expect(deps.analyzer.inputs[0]?.transcript).toBeNull();
  });

  it('advances a silent video without transcription and analyzes with the no-transcript branch', async () => {
    const deps = makeDeps('pending');
    deps.media.hasAudio = false;

    const result = await processVideoPipeline(deps, { ...baseInput, skipRename: true, skipRenameExplicit: true });
    const videos = await deps.catalogs.repo('/work').listVideos();

    expect(result).toMatchObject({ ok: true, value: { status: 'completed' } });
    expect(deps.media.audioInputs).toHaveLength(1);
    expect(deps.transcriber.inputs).toHaveLength(0);
    expect(deps.analyzer.inputs[0]?.transcript).toBeNull();
    expect(videos).toMatchObject({ ok: true, value: [{ status: 'completed' }] });
  });

  it('resumes errored frame-only rows without audio extraction when whisper is skipped', async () => {
    const deps = makeDeps('error');
    seedFrames(deps.fs);

    const events: string[] = [];
    const result = await processVideoPipeline(deps, { ...baseInput, whisper: 'skip', whisperExplicit: true }, {
      signal: idleSignal,
      reportProgress: (event) => {
        events.push(event.step);
        return Promise.resolve({ ok: true, value: undefined });
      },
    });

    expect(result).toMatchObject({ ok: true, value: { status: 'completed' } });
    expect(events[0]).toBe('extracting_audio');
    expect(deps.media.frameInputs).toHaveLength(0);
    expect(deps.media.audioInputs).toHaveLength(0);
    expect(deps.transcriber.inputs).toHaveLength(0);
  });

  it('inspects error artifacts and resumes at audio when frames are complete', async () => {
    const deps = makeDeps('error');
    seedFrames(deps.fs);

    const events: string[] = [];
    await processVideoPipeline(deps, baseInput, {
      signal: idleSignal,
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
      signal: idleSignal,
      reportProgress: (event) => {
        events.push(event.step);
        return Promise.resolve({ ok: true, value: undefined });
      },
    });

    expect(events[0]).toBe('extracting_frames');
    expect(deps.media.frameInputs).toHaveLength(1);
  });

  it('updates a hash-matched stale path before pipeline steps run', async () => {
    const deps = makeDeps('pending');
    deps.catalogs.repo('/work').setVideos([
      videoFixture({
        originalPath: '/work/dead-original.mp4',
        originalName: 'dead-original.mp4',
        fileHash: 'hash-clip',
        status: 'pending',
      }),
    ]);

    const result = await processVideoPipeline(deps, {
      ...baseInput,
      whisper: 'skip',
      whisperExplicit: true,
      skipRename: true,
      skipRenameExplicit: true,
    });
    const videos = await deps.catalogs.repo('/work').listVideos();

    expect(result).toMatchObject({ ok: true, value: { path: videoPath, status: 'completed' } });
    expect(deps.media.frameInputs[0]?.videoPath).toBe(videoPath);
    expect(videos).toMatchObject({ ok: true, value: [{ originalPath: videoPath, status: 'completed' }] });
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

    const audioPath = tempAudioPath(audioDeps.fs, videoPath);
    expect(audioDeps.transcriber.inputs[0]?.audioPath).toBe(audioPath);
    await expect(audioDeps.fs.exists(audioPath)).resolves.toEqual({
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
    const audioPath = tempAudioPath(deps.fs, videoPath);
    deps.fs.addFile(audioPath, { content: 'audio' });

    await processVideoPipeline(deps, { ...baseInput, whisper: 'skip', whisperExplicit: true });

    expect(deps.transcriber.inputs).toHaveLength(0);
    await expect(deps.fs.exists(audioPath)).resolves.toEqual({
      ok: true,
      value: false,
    });
  });

  it('re-extracts a missing temp WAV when resuming from audio_extracted', async () => {
    const deps = makeDeps('audio_extracted');
    seedFrames(deps.fs);

    await processVideoPipeline(deps, baseInput);

    expect(deps.media.audioInputs).toHaveLength(1);
    expect(deps.transcriber.inputs[0]?.audioPath).toBe(tempAudioPath(deps.fs, videoPath));
  });

  it('uses distinct temp WAV paths for same-named videos in different folders', () => {
    const fs = new InMemoryFileSystem('/work');

    const first = tempAudioPath(fs, '/work/one/clip.mp4');
    const second = tempAudioPath(fs, '/work/two/clip.mp4');

    expect(first).not.toBe(second);
    expect(first).toMatch(/-clip\.wav$/);
    expect(second).toMatch(/-clip\.wav$/);
  });
});

describe('process pipeline global catalog idempotency', () => {
  const folderId = '33333333-3333-4333-8333-333333333333';

  const seedForeignDriveArtifacts = (fs: InMemoryFileSystem): void => {
    fs.addFile('/work/.ai-video-cataloger/folder-id', {
      content: JSON.stringify({ folderId, schemaVersion: 1, createdAt: '2026-01-01T00:00:00.000Z' }),
    });
    const header = JSON.stringify({
      type: 'header',
      version: 1,
      folder: {
        folderId,
        currentPath: '/work',
        displayName: 'work',
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-02T00:00:00.000Z',
      },
      exportedAt: '2026-01-02T00:00:00.000Z',
    });
    const record = JSON.stringify({
      type: 'record',
      file: {
        fingerprint: 'hash-clip',
        folderId,
        fileName: 'Clip One.mp4',
        size: 1000,
        durationS: null,
        gpsLat: null,
        gpsLon: null,
        processedAt: '2026-01-02T00:00:00.000Z',
        analyzer: 'claude',
        model: null,
      },
      analysis: {
        fingerprint: 'hash-clip',
        finalName: null,
        description: 'Done elsewhere',
        transcript: null,
        language: null,
        tags: [],
      },
    });
    fs.addFile('/work/.ai-video-cataloger/catalog.ndjson', { content: `${header}\n${record}\n` });
  };

  it('imports a legacy folder snapshot and adds the requested configuration as an unselected variant', async () => {
    const deps = makeDeps('pending');
    const globalCatalog = new InMemoryGlobalCatalogStore();
    seedForeignDriveArtifacts(deps.fs);

    const result = await processVideoPipeline({ ...deps, globalCatalog }, baseInput);

    expect(result).toMatchObject({
      ok: true,
      value: { status: 'completed', configId: expect.stringMatching(/^cfg_/), selectedConfigId: 'legacy' },
    });
    expect(deps.analyzer.inputs).toHaveLength(1);
    expect(deps.transcriber.inputs).toHaveLength(1);
    const analysis = await globalCatalog.getAnalysis('hash-clip');
    expect(analysis.ok && analysis.value?.description).toBe('Done elsewhere');
    const variants = await globalCatalog.listVariants('hash-clip');
    expect(variants.ok && variants.value).toHaveLength(2);
  });

  it('skips only an existing configuration pair and reports its configId', async () => {
    const deps = makeDeps('pending');
    const globalCatalog = new InMemoryGlobalCatalogStore();
    const input = { ...baseInput, skipRename: true, skipRenameExplicit: true };
    const first = await processVideoPipeline({ ...deps, globalCatalog }, input);
    const events: Array<{ step: string; data: Record<string, unknown> | undefined }> = [];
    const second = await processVideoPipeline({ ...deps, globalCatalog }, input, {
      signal: idleSignal,
      reportProgress: (event) => {
        events.push({ step: event.step, data: event.data });
        return Promise.resolve({ ok: true, value: undefined });
      },
    });

    expect(first).toMatchObject({
      ok: true,
      value: { configId: expect.stringMatching(/^cfg_/), selectedConfigId: expect.stringMatching(/^cfg_/) },
    });
    expect(second).toMatchObject({ ok: true, value: { configId: first.ok ? first.value.configId : '' } });
    expect(deps.analyzer.inputs).toHaveLength(1);
    const variants = await globalCatalog.listVariants('hash-clip');
    expect(variants.ok && variants.value).toHaveLength(1);
    expect(events).toContainEqual({
      step: 'catalog_index_skipped',
      data: {
        video: videoPath,
        reason: 'variant_exists',
        configId: first.ok ? first.value.configId : '',
      },
    });
  });

  it('keeps two configurations intact, reuses shared inputs, and does not select the later variant', async () => {
    const deps = makeDeps('pending');
    const globalCatalog = new InMemoryGlobalCatalogStore();
    const input = { ...baseInput, skipRename: true, skipRenameExplicit: true };
    deps.analyzer.rawResponse = 'DESCRIPTION: First variant\nFILENAME: first-variant\nTAGS: first';
    const first = await processVideoPipeline({ ...deps, globalCatalog }, input);
    deps.analyzer.rawResponse = 'DESCRIPTION: Second variant\nFILENAME: second-variant\nTAGS: second';
    const second = await processVideoPipeline({ ...deps, globalCatalog }, { ...input, provider: 'codex' });

    expect(first.ok && second.ok && first.value.configId).not.toBe(second.ok ? second.value.configId : '');
    expect(second).toMatchObject({
      ok: true,
      value: { selectedConfigId: first.ok ? first.value.configId : '' },
    });
    expect(deps.media.frameInputs).toHaveLength(1);
    expect(deps.transcriber.inputs).toHaveLength(1);
    const variants = await globalCatalog.listVariants('hash-clip');
    expect(variants.ok && variants.value.map((variant) => variant.description).sort()).toEqual([
      'First variant',
      'Second variant',
    ]);
  });

  it('reports cross-variant artifact reuse only for verbose processing', async () => {
    const deps = makeDeps('pending');
    const globalCatalog = new InMemoryGlobalCatalogStore();
    const input = { ...baseInput, skipRename: true, skipRenameExplicit: true };
    const first = await processVideoPipeline({ ...deps, globalCatalog }, input);
    const quietEvents: Array<{ step: string; data: Record<string, unknown> | undefined }> = [];
    await processVideoPipeline({ ...deps, globalCatalog }, { ...input, provider: 'codex' }, {
      signal: idleSignal,
      reportProgress: (event) => {
        quietEvents.push({ step: event.step, data: event.data });
        return Promise.resolve({ ok: true, value: undefined });
      },
    });
    const verboseEvents: Array<{ step: string; data: Record<string, unknown> | undefined }> = [];
    const third = await processVideoPipeline(
      { ...deps, globalCatalog },
      { ...input, provider: 'cursor-agent', verbose: true },
      {
        signal: idleSignal,
        reportProgress: (event) => {
          verboseEvents.push({ step: event.step, data: event.data });
          return Promise.resolve({ ok: true, value: undefined });
        },
      },
    );

    expect(quietEvents.some((event) => event.step === 'artifact_reused')).toBe(false);
    expect(verboseEvents.filter((event) => event.step === 'artifact_reused')).toEqual([
      {
        step: 'artifact_reused',
        data: {
          kind: 'frames',
          configId: third.ok ? third.value.configId : '',
          sourceConfigId: first.ok ? first.value.configId : '',
        },
      },
      {
        step: 'artifact_reused',
        data: {
          kind: 'transcript',
          configId: third.ok ? third.value.configId : '',
          sourceConfigId: first.ok ? first.value.configId : '',
        },
      },
    ]);
  });

  it('force replaces only the addressed configuration variant', async () => {
    const deps = makeDeps('pending');
    const globalCatalog = new InMemoryGlobalCatalogStore();
    const input = { ...baseInput, skipRename: true, skipRenameExplicit: true };
    deps.analyzer.rawResponse = 'DESCRIPTION: Selected bytes\nFILENAME: selected-bytes';
    const selected = await processVideoPipeline({ ...deps, globalCatalog }, input);
    deps.analyzer.rawResponse = 'DESCRIPTION: Replace me\nFILENAME: replace-me';
    const replaceable = await processVideoPipeline({ ...deps, globalCatalog }, { ...input, provider: 'codex' });
    const before = selected.ok ? await globalCatalog.getVariant('hash-clip', selected.value.configId) : null;
    deps.analyzer.rawResponse = 'DESCRIPTION: Replaced\nFILENAME: replaced';
    const forced = await processVideoPipeline(
      { ...deps, globalCatalog },
      { ...input, provider: 'codex', force: true },
    );
    const after = selected.ok ? await globalCatalog.getVariant('hash-clip', selected.value.configId) : null;
    const replaced = replaceable.ok
      ? await globalCatalog.getVariant('hash-clip', replaceable.value.configId)
      : null;

    expect(forced).toMatchObject({
      ok: true,
      value: {
        configId: replaceable.ok ? replaceable.value.configId : '',
        selectedConfigId: selected.ok ? selected.value.configId : '',
      },
    });
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(replaced !== null && replaced.ok && replaced.value?.description).toBe('Replaced');
    const variants = await globalCatalog.listVariants('hash-clip');
    expect(variants.ok && variants.value).toHaveLength(2);
  });

  it('does not resume from frames or transcripts keyed to another configuration', async () => {
    const deps = makeDeps('pending');
    const globalCatalog = new InMemoryGlobalCatalogStore();
    deps.analyzer.rawResponse = 'DESCRIPTION: missing filename';
    const failed = await processVideoPipeline(
      { ...deps, globalCatalog },
      { ...baseInput, skipRename: true, skipRenameExplicit: true },
    );
    deps.analyzer.rawResponse = 'DESCRIPTION: Clean resume\nFILENAME: clean-resume';
    deps.transcriber.transcript = 'second transcript';
    const resumed = await processVideoPipeline(
      { ...deps, globalCatalog },
      {
        ...baseInput,
        frames: 4,
        framesExplicit: true,
        whisperModel: 'small',
        whisperModelExplicit: true,
        skipRename: true,
        skipRenameExplicit: true,
      },
    );

    expect(failed).toMatchObject({ ok: false, error: { code: 'analysis_parse_failed' } });
    expect(resumed).toMatchObject({ ok: true, value: { status: 'completed' } });
    expect(deps.media.frameInputs.map((entry) => entry.frameCount)).toEqual([3, 4]);
    expect(deps.transcriber.inputs).toHaveLength(2);
    expect(deps.analyzer.inputs[1]?.framePaths).toHaveLength(4);
    expect(deps.analyzer.inputs[1]?.transcript).toBe('second transcript');
  });

  it('stores reported analyzer usage on the variant', async () => {
    const deps = makeDeps('pending');
    const globalCatalog = new InMemoryGlobalCatalogStore();
    await deps.config.set(
      { kind: 'folder', folder: '/work' },
      'analyzer_provider',
      JSON.stringify(defaultGeminiNativeProvider('gemini-3.6-flash')),
    );
    deps.analyzer.rawResponse = 'DESCRIPTION: Native usage\nFILENAME: native-usage';
    deps.analyzer.usage = geminiUsageAccounting(
      { promptTokens: 100, candidatesTokens: 20, thoughtsTokens: 5 },
      'gemini-3.6-flash',
    );
    const result = await processVideoPipeline(
      { ...deps, globalCatalog },
      { ...baseInput, skipRename: true, skipRenameExplicit: true },
    );
    const variant = result.ok ? await globalCatalog.getVariant('hash-clip', result.value.configId) : null;

    expect(result).toMatchObject({ ok: true });
    expect(variant !== null && variant.ok && variant.value?.usage).toMatchObject({
      promptTokens: 100,
      billedOutputTokens: 25,
      totalTokens: 125,
    });
  });

  it('treats output language and prompt version changes as new configurations', async () => {
    const deps = makeDeps('pending');
    const globalCatalog = new InMemoryGlobalCatalogStore();
    const input = { ...baseInput, skipRename: true, skipRenameExplicit: true };
    const first = await processVideoPipeline({ ...deps, globalCatalog }, input);
    await deps.config.set({ kind: 'folder', folder: '/work' }, 'output_language', 'pl');
    const languageChanged = await processVideoPipeline({ ...deps, globalCatalog }, input);
    deps.analyzer.analysisPromptVersion = 2;
    const promptChanged = await processVideoPipeline({ ...deps, globalCatalog }, input);
    const variants = await globalCatalog.listVariants('hash-clip');

    const ids = [first, languageChanged, promptChanged].map((result) => result.ok ? result.value.configId : '');
    expect(new Set(ids).size).toBe(3);
    expect(variants.ok && variants.value).toHaveLength(3);
    expect(deps.analyzer.inputs).toHaveLength(3);
    expect(deps.media.frameInputs).toHaveLength(1);
    expect(deps.transcriber.inputs).toHaveLength(1);
  });

  it('reprocesses an already indexed fingerprint when force is set', async () => {
    const deps = makeDeps('pending');
    const globalCatalog = new InMemoryGlobalCatalogStore();
    await globalCatalog.upsertAnalysis({
      fingerprint: 'hash-clip',
      finalName: null,
      description: 'old',
      transcript: null,
      language: null,
      tags: [],
    });

    const result = await processVideoPipeline({ ...deps, globalCatalog }, { ...baseInput, force: true });

    expect(result.ok).toBe(true);
    expect(deps.analyzer.inputs).toHaveLength(1);
  });

  it('records analyzer tags and GPS coordinates in the global catalog', async () => {
    const deps = makeDeps('pending');
    const globalCatalog = new InMemoryGlobalCatalogStore();
    deps.analyzer.rawResponse = 'DESCRIPTION: A clip.\nFILENAME: gps-clip\nTAGS: DJI Drone, Coastal Cliff, Wide Shot';
    deps.media.durations.set('/work/Clip One.mp4', 42);
    deps.media.locations.set('/work/Clip One.mp4', { gpsLat: 69.6492, gpsLon: 18.9553 });

    const result = await processVideoPipeline(
      { ...deps, globalCatalog },
      { ...baseInput, skipRename: true, skipRenameExplicit: true },
    );

    const file = await globalCatalog.getFile('hash-clip');
    const analysis = await globalCatalog.getAnalysis('hash-clip');
    expect(result.ok).toBe(true);
    expect(file.ok && file.value).toMatchObject({ durationS: 42, gpsLat: 69.6492, gpsLon: 18.9553 });
    expect(analysis.ok && analysis.value?.tags).toEqual(['dji-drone', 'coastal-cliff', 'wide-shot']);
  });

  it('flushes the global catalog to disk when a single-file job completes', async () => {
    const deps = makeDeps('pending');
    const globalCatalog = new InMemoryGlobalCatalogStore();

    const result = await processVideoPipeline(
      { ...deps, globalCatalog },
      { ...baseInput, skipRename: true, skipRenameExplicit: true },
    );

    expect(result.ok).toBe(true);
    expect(globalCatalog.flushCount).toBeGreaterThan(0);
  });

  it('emits a warning event and does not index when the fingerprint cannot be computed', async () => {
    const deps = makeDeps('pending');
    const globalCatalog = new InMemoryGlobalCatalogStore();
    deps.fs.addFile('/work/Clip One.mp4', { size: 1000, mtimeMs: new Date('2024-05-06T12:00:00.000Z').getTime() });

    const events: string[] = [];
    const result = await processVideoPipeline(
      { ...deps, globalCatalog },
      { ...baseInput, skipRename: true, skipRenameExplicit: true },
      {
        signal: idleSignal,
        reportProgress: (event) => {
          events.push(event.step);
          return Promise.resolve({ ok: true, value: undefined });
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(events).toContain('catalog_index_skipped');
    const counts = await globalCatalog.counts();
    expect(counts.ok && counts.value.files).toBe(0);
  });
});

describe('process pipeline rename and jobs', () => {
  it('rejects a concurrent process job for the same resolved video path', async () => {
    const deps = makeDeps('pending');
    const jobs = new InMemoryJobs();
    jobs.addJob({
      jobId: 'existing',
      kind: 'process',
      status: 'running',
      progress: null,
      progressEvents: [],
      error: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      resourceKey: videoPath,
    });

    const result = await enqueueProcess({ ...deps, jobs }, { ...baseInput, videoPath: './Clip One.mp4' });
    const records = await jobs.list();

    expect(result).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(records).toMatchObject({ ok: true, value: [{ jobId: 'existing' }] });
  });

  it('fails prerequisites before enqueueing or opening a catalog', async () => {
    const deps = makeDeps('pending');
    const jobs = new InMemoryJobs();
    deps.media.dependenciesValue = [
      { name: 'ffmpeg', available: false, version: null, source: null, path: null, installHint: 'Install ffmpeg' },
    ];

    const result = await enqueueProcess({ ...deps, jobs }, baseInput);
    const records = await jobs.list();

    expect(result).toMatchObject({ ok: false, error: { code: 'prerequisites_failed' } });
    expect(deps.catalogs.openInputs).toEqual([]);
    expect(records).toEqual({ ok: true, value: [] });
  });

  it('checks only the configured analyzer and skips Whisper unless local mode is selected', async () => {
    const deps = makeDeps('pending');
    const jobs = new InMemoryJobs();
    await deps.config.set({ kind: 'folder', folder: '/work' }, 'analyzer_backend', 'local');

    await enqueueProcess({ ...deps, jobs }, {
      ...baseInput,
      whisper: 'skip',
      whisperExplicit: true,
      skipRename: true,
      skipRenameExplicit: true,
    });

    expect(deps.analyzer.dependencyInputs).toEqual(['local']);
  });

  it('reports a configured missing local model with the parity error code before enqueueing', async () => {
    const deps = makeDeps('pending');
    const jobs = new InMemoryJobs();
    deps.analyzer.dependencyValue = {
      name: 'gemma3:4b',
      available: false,
      version: '0.11.0',
      source: null,
      path: null,
      installHint: 'Download the model',
    };
    await deps.config.set(
      { kind: 'folder', folder: '/work' },
      'analyzer_provider',
      JSON.stringify({ family: 'local', providerId: 'local', modelTag: 'gemma3:4b' }),
    );

    const result = await enqueueProcess({ ...deps, jobs }, {
      ...baseInput,
      whisper: 'skip',
      whisperExplicit: true,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'model_not_installed' } });
    expect(await jobs.list()).toEqual({ ok: true, value: [] });
  });

  it('preserves an analyzer error code instead of laundering it into processing_error', async () => {
    const deps = makeDeps('transcribed');
    seedFrames(deps.fs);
    seedTranscript(deps.fs);
    deps.analyzer.analyzeError = appError('model_not_installed', 'Configured model is missing');

    const result = await processVideoPipeline(deps, baseInput);

    expect(result).toMatchObject({ ok: false, error: { code: 'model_not_installed' } });
  });

  it('passes the verbose process flag to the selected analyzer', async () => {
    const deps = makeDeps('transcribed');
    seedFrames(deps.fs);
    seedTranscript(deps.fs);

    await processVideoPipeline(deps, { ...baseInput, verbose: true });

    expect(deps.analyzer.inputs[0]?.verbose).toBe(true);
  });

  it('renames with date prefix, conflict suffix, and artifact co-rename set', async () => {
    const deps = makeDeps('analyzed');
    seedSummary(deps.fs);
    deps.fs.addFile('/work/2024-05-06_existing-summary.mp4');
    deps.fs.addFile('/work/frames/Clip One/frame-001.jpg');
    deps.fs.addFile('/work/transcripts/Clip One.txt', { content: 'transcript' });
    deps.fs.addFile('/work/summaries/Clip One.txt', { content: 'summary txt' });
    deps.fs.addFile('/work/summaries/Clip One-debug.log', { content: 'debug' });
    deps.fs.addFile('/work/.ai-video-cataloger/thumbnails/Clip One.jpg');
    deps.fs.addFile('/work/.ai-video-cataloger/artifacts/frames/hash-clip/frm_key/frame-001.jpg');
    deps.fs.addFile('/work/.ai-video-cataloger/variants/hash-clip/cfg_0123456789ab/summary.json', { content: '{}' });

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
    await expect(deps.fs.exists('/work/summaries/2024-05-06_existing-summary-2-debug.log')).resolves.toEqual({ ok: true, value: true });
    await expect(deps.fs.exists('/work/.ai-video-cataloger/thumbnails/2024-05-06_existing-summary-2.jpg')).resolves.toEqual({
      ok: true,
      value: true,
    });
    await expect(deps.fs.exists('/work/.ai-video-cataloger/artifacts/frames/hash-clip/frm_key/frame-001.jpg')).resolves.toEqual({
      ok: true,
      value: true,
    });
    await expect(deps.fs.exists('/work/.ai-video-cataloger/variants/hash-clip/cfg_0123456789ab/summary.json')).resolves.toEqual({
      ok: true,
      value: true,
    });
  });

  it('rolls back the video and prior artifacts when the third artifact rename fails', async () => {
    const fs = new ThirdArtifactRenameFailureFileSystem('/work');
    const deps = makeDeps('analyzed', fs);
    seedSummary(deps.fs);
    deps.fs.addFile('/work/frames/Clip One/frame-001.jpg');
    deps.fs.addFile('/work/transcripts/Clip One.txt', { content: 'transcript' });
    deps.fs.addFile('/work/summaries/Clip One.txt', { content: 'summary txt' });
    deps.fs.addFile('/work/.ai-video-cataloger/thumbnails/Clip One.jpg');

    const result = await processVideoPipeline(deps, baseInput);
    const videos = await deps.catalogs.repo('/work').listVideos();

    expect(result).toMatchObject({ ok: false, error: { message: 'Third artifact rename failed' } });
    expect(videos).toMatchObject({
      ok: true,
      value: [{ originalPath: videoPath, newName: null, status: 'analyzed', errorMessage: null }],
    });
    await expect(deps.fs.exists(videoPath)).resolves.toEqual({ ok: true, value: true });
    await expect(deps.fs.exists('/work/frames/Clip One')).resolves.toEqual({ ok: true, value: true });
    await expect(deps.fs.exists('/work/transcripts/Clip One.txt')).resolves.toEqual({ ok: true, value: true });
    await expect(deps.fs.exists('/work/summaries/Clip One.txt')).resolves.toEqual({ ok: true, value: true });
    await expect(deps.fs.exists('/work/2024-05-06_existing-summary.mp4')).resolves.toEqual({ ok: true, value: false });
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

  it('does not mark the catalog completed when cancellation arrives during the final step', async () => {
    const deps = makeDeps('analyzed');
    seedSummary(deps.fs);
    const controller = new AbortController();

    const result = await processVideoPipeline(
      deps,
      { ...baseInput, skipRename: true, skipRenameExplicit: true },
      {
        signal: controller.signal,
        reportProgress: (event) => {
          if (event.step === 'skipping_rename') controller.abort();
          return Promise.resolve({ ok: true, value: undefined });
        },
      },
    );
    const videos = await deps.catalogs.repo('/work').listVideos();

    expect(result).toMatchObject({ ok: false, error: { message: 'Job cancelled' } });
    expect(videos).toMatchObject({ ok: true, value: [{ status: 'analyzed' }] });
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

  it('runs a harness provider selected by id over the configured provider', async () => {
    const deps = makeDeps('transcribed');
    seedFrames(deps.fs);
    seedTranscript(deps.fs);
    await deps.config.set({ kind: 'folder', folder: '/work' }, 'analyzer_provider', JSON.stringify({
      family: 'local',
      providerId: 'local',
      modelTag: 'configured:model',
    }));

    await processVideoPipeline(deps, { ...baseInput, provider: 'codex' });

    expect(deps.analyzer.inputs[0]).toMatchObject({
      backend: 'claude',
      provider: {
        family: 'harness',
        providerId: 'codex',
        command: 'codex',
        promptStyle: 'dir-access',
      },
    });
  });

  it('keeps the configured model and effort when the selected id matches the configured harness', async () => {
    const deps = makeDeps('transcribed');
    seedFrames(deps.fs);
    seedTranscript(deps.fs);
    await deps.config.set({ kind: 'folder', folder: '/work' }, 'analyzer_provider', JSON.stringify({
      family: 'harness',
      providerId: 'codex',
      command: 'codex',
      argsTemplate: ['exec', '{prompt}'],
      promptStyle: 'dir-access',
      model: 'gpt-5.5',
      reasoningEffort: 'high',
    }));

    await processVideoPipeline(deps, { ...baseInput, provider: 'codex' });

    expect(deps.analyzer.inputs[0]).toMatchObject({
      provider: { providerId: 'codex', model: 'gpt-5.5', reasoningEffort: 'high' },
    });
  });

  it('lets an explicit local model override the persisted local provider model', async () => {
    const deps = makeDeps('transcribed');
    seedFrames(deps.fs);
    seedTranscript(deps.fs);
    await deps.config.set({ kind: 'folder', folder: '/work' }, 'analyzer_provider', JSON.stringify({
      family: 'local',
      providerId: 'local',
      modelTag: 'configured:model',
    }));
    await deps.config.set({ kind: 'folder', folder: '/work' }, 'local_model', 'configured:model');

    await processVideoPipeline(deps, { ...baseInput, localModel: 'flag:model' });

    expect(deps.analyzer.inputs[0]).toMatchObject({
      backend: 'local',
      localModel: 'flag:model',
      provider: { family: 'local', modelTag: 'flag:model' },
    });
  });

  it('lets a folder local model override a home local provider model', async () => {
    const deps = makeDeps('transcribed');
    seedFrames(deps.fs);
    seedTranscript(deps.fs);
    await deps.config.set({ kind: 'home' }, 'analyzer_provider', JSON.stringify({
      family: 'local',
      providerId: 'local',
      modelTag: 'home:model',
    }));
    await deps.config.set({ kind: 'home' }, 'local_model', 'home:model');
    await deps.config.set({ kind: 'folder', folder: '/work' }, 'local_model', 'folder:model');

    await processVideoPipeline(deps, baseInput);

    expect(deps.analyzer.inputs[0]).toMatchObject({
      backend: 'local',
      localModel: 'folder:model',
      provider: { family: 'local', modelTag: 'folder:model' },
    });
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

  it('falls back to home config for every processing key when the folder is silent', async () => {
    const deps = makeDeps('pending');
    await deps.config.set({ kind: 'home' }, 'frames', '4');
    await deps.config.set({ kind: 'home' }, 'whisper_mode', 'api');
    await deps.config.set({ kind: 'home' }, 'whisper_model', 'small');
    await deps.config.set({ kind: 'home' }, 'whisper_binary_path', '/home/whisper');
    await deps.config.set({ kind: 'home' }, 'skip_rename', 'true');
    await deps.config.set({ kind: 'home' }, 'analyzer_backend', 'local');
    await deps.config.set({ kind: 'home' }, 'local_model', 'home:model');
    await deps.config.set({ kind: 'home' }, 'timeout', '180');

    await processVideoPipeline(deps, baseInput);

    expect(deps.media.frameInputs[0]?.frameCount).toBe(4);
    expect(deps.transcriber.inputs[0]).toMatchObject({
      mode: 'api',
      model: 'small',
      binaryPath: '/home/whisper',
    });
    expect(deps.analyzer.inputs[0]).toMatchObject({
      backend: 'local',
      localModel: 'home:model',
      timeoutSeconds: 180,
    });
    expect(await deps.fs.exists(videoPath)).toEqual({ ok: true, value: true });
  });

  it('lets folder config override home config for every processing key', async () => {
    const deps = makeDeps('pending');
    for (const scope of [{ kind: 'home' } as const, { kind: 'folder', folder: '/work' } as const]) {
      const folder = scope.kind === 'folder';
      await deps.config.set(scope, 'frames', folder ? '6' : '4');
      await deps.config.set(scope, 'whisper_mode', folder ? 'local' : 'api');
      await deps.config.set(scope, 'whisper_model', folder ? 'tiny' : 'small');
      await deps.config.set(scope, 'whisper_binary_path', folder ? '/folder/whisper' : '/home/whisper');
      await deps.config.set(scope, 'skip_rename', folder ? 'false' : 'true');
      await deps.config.set(scope, 'analyzer_backend', folder ? 'claude' : 'local');
      await deps.config.set(scope, 'local_model', folder ? 'folder:model' : 'home:model');
      await deps.config.set(scope, 'timeout', folder ? '210' : '180');
    }

    await processVideoPipeline(deps, baseInput);

    expect(deps.media.frameInputs[0]?.frameCount).toBe(6);
    expect(deps.transcriber.inputs[0]).toMatchObject({
      mode: 'local',
      model: 'tiny',
      binaryPath: '/folder/whisper',
    });
    expect(deps.analyzer.inputs[0]).toMatchObject({
      backend: 'claude',
      localModel: 'folder:model',
      timeoutSeconds: 210,
    });
    expect(await deps.fs.exists('/work/2024-05-06_useful-clip.mp4')).toEqual({ ok: true, value: true });
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
