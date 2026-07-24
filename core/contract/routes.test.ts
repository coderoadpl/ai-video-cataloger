import { describe, expect, it } from 'vitest';

import {
  API_ROUTES,
  doctorOutputSchema,
  healthLiveOutputSchema,
  healthReadyOutputSchema,
  jobOutputSchema,
  scanOutputSchema,
  whisperModelsListOutputSchema,
  providerTestOutputSchema,
  searchOutputSchema,
} from './routes.js';

describe('route schemas', () => {
  it('retains optional folder scope on folder-backed routes', () => {
    expect(API_ROUTES.status.input.parse({ folder: '/videos' })).toEqual({ folder: '/videos' });
    expect(API_ROUTES.resetAll.input.parse({ folder: '/videos', force: true })).toEqual({
      folder: '/videos',
      force: true,
    });
    expect(API_ROUTES.resetSingle.input.parse({ folder: '/videos', filename: 'clip.mp4', force: true })).toEqual({
      folder: '/videos',
      filename: 'clip.mp4',
      force: true,
    });
    expect(API_ROUTES.configGet.input.parse({ folder: '/videos' })).toEqual({
      folder: '/videos',
      key: null,
    });
    expect(API_ROUTES.configSet.input.parse({ folder: '/videos', key: 'frames', value: '4' })).toEqual({
      folder: '/videos',
      key: 'frames',
      value: '4',
    });
  });

  it('round-trips a scan result with artifacts and summary counts', () => {
    const parsed = scanOutputSchema.parse({
      folder: '/videos',
      databasePath: '/videos/.ai-video-cataloger/catalog.db',
      videos: [
        {
          path: '/videos/clip.mp4',
          filename: 'clip.mp4',
          size: 1024,
          sizeFormatted: '1.0 KB',
          duration: 61.2,
          durationFormatted: '1:01',
          status: 'completed',
          errorMessage: null,
          contentHash: 'abc123',
          artifacts: {
            framePaths: ['/videos/frames/clip/frame-001.jpg'],
            transcriptContent: 'hello',
            transcriptPath: '/videos/transcripts/clip.txt',
            summary: {
              schemaVersion: 1,
              description: 'A clip',
              suggestedFilename: 'a-clip',
              fullAnalysis: 'DESCRIPTION: A clip\nFILENAME: a-clip',
              analyzedAt: '2026-07-12T10:00:00.000Z',
            },
            summaryPath: '/videos/summaries/clip.txt',
            thumbnailPath: '/videos/.ai-video-cataloger/thumbnails/clip.jpg',
            thumbnailMtime: 123,
            newFilename: '2026-07-12_a-clip.mp4',
          },
        },
      ],
      summary: {
        total: 1,
        tracked: 1,
        pending: 0,
        inProgress: 0,
        completed: 1,
        error: 0,
        notTracked: 0,
      },
    });
    expect(parsed.summary.completed).toBe(1);
  });

  it('round-trips doctor dependency and machine fields', () => {
    const parsed = doctorOutputSchema.parse({
      dependencies: [
        {
          name: 'ffmpeg',
          available: true,
          version: '7.0',
          source: 'bundled',
          path: '/bin/ffmpeg',
          installHint: 'reinstall',
        },
        {
          name: 'claude',
          available: false,
          version: null,
          source: null,
          path: null,
          installHint: 'install claude',
        },
      ],
      harnesses: [{
        family: 'harness',
        providerId: 'claude-code',
        available: true,
        version: '2.1.210',
        latencyMs: 4,
        message: 'Available',
      }],
      machine: {
        platform: 'darwin',
        arch: 'arm64',
        totalMemGB: 32,
        appleSilicon: true,
      },
      recommendedLocalModel: 'gemma3:12b',
      allAvailable: false,
      configured: {
        ready: false,
        analyzer: {
          kind: 'analyzer',
          family: 'harness',
          providerId: 'claude-code',
          name: 'claude-code',
          available: false,
          message: 'claude-code is unavailable',
          suggestedAction: 'Run setup',
        },
        transcriber: {
          kind: 'transcriber',
          mode: 'skip',
          model: null,
          name: 'transcription-skip',
          available: true,
          message: 'transcription-skip is available',
          suggestedAction: null,
        },
        missingPieces: [{
          kind: 'analyzer',
          name: 'claude-code',
          available: false,
          message: 'claude-code is unavailable',
          suggestedAction: 'Run setup',
        }],
        suggestedAction: 'Run setup',
      },
    });
    expect(parsed.dependencies).toHaveLength(2);
    expect(parsed.harnesses).toHaveLength(1);
  });

  it('round-trips a models list response', () => {
    const parsed = whisperModelsListOutputSchema.parse({
      models: [
        { name: 'tiny', size: '75MB', downloaded: false, active: false },
        { name: 'base', size: '142MB', downloaded: true, active: true },
      ],
    });
    expect(parsed.models[1]?.active).toBe(true);
  });

  it('round-trips a search response with folder online state', () => {
    const parsed = searchOutputSchema.parse({
      query: 'drone',
      limit: 50,
      offset: 0,
      count: 1,
      results: [{
        fingerprint: 'fp-1',
        fileName: 'clip.mp4',
        finalName: 'drone-clip.mp4',
        description: 'A drone clip',
        snippet: '<mark>drone</mark> clip',
        tags: ['aerial'],
        folder: {
          folderId: '11111111-1111-4111-8111-111111111111',
          currentPath: '/drive',
          displayName: 'drive',
          online: true,
        },
        gps: { lat: 51, lon: 17 },
        missing: false,
      }],
    });
    expect(parsed.results[0]?.folder.online).toBe(true);
  });

  it('defines family-specific cheap provider check results', () => {
    expect(providerTestOutputSchema.parse({
      family: 'api',
      providerId: 'openai',
      reachable: true,
      authenticated: false,
      latencyMs: 18,
      message: 'Credentials rejected',
    })).toMatchObject({ reachable: true, authenticated: false });
    expect(providerTestOutputSchema.parse({
      family: 'harness',
      providerId: 'codex',
      available: true,
      version: '1.2.3',
      latencyMs: 4,
      message: 'Available',
    })).toMatchObject({ available: true, version: '1.2.3' });
    expect(providerTestOutputSchema.parse({
      family: 'local',
      providerId: 'local',
      runtimeAvailable: true,
      modelAvailable: false,
      version: '0.9.0',
      latencyMs: 7,
      message: 'Model is not installed',
    })).toMatchObject({ runtimeAvailable: true, modelAvailable: false });
  });

  it('round-trips process job progress', () => {
    const parsed = jobOutputSchema.parse({
      jobId: 'job-1',
      kind: 'process',
      status: 'running',
      progress: {
        step: 'transcribing_audio',
        percentage: 60,
        current: 1,
        total: 1,
        data: {
          video: '/videos/clip.mp4',
          stepNumber: 3,
          totalSteps: 5,
        },
      },
      progressEvents: [
        { sequence: 1, progress: { step: 'extracting_frames', percentage: 20 } },
        { sequence: 2, progress: { step: 'extracting_audio', percentage: 40 } },
        { sequence: 3, progress: { step: 'transcribing_audio', percentage: 60 } },
      ],
      error: null,
      createdAt: '2026-07-12T10:00:00.000Z',
      updatedAt: '2026-07-12T10:01:00.000Z',
    });
    expect(parsed.progress?.step).toBe('transcribing_audio');
    expect(parsed.progressEvents.map((event) => event.sequence)).toEqual([1, 2, 3]);
  });

  it('splits liveness and readiness into distinct additive GET routes', () => {
    expect(API_ROUTES.healthLive).toMatchObject({ method: 'GET', path: '/api/health/live' });
    expect(API_ROUTES.healthReady).toMatchObject({ method: 'GET', path: '/api/health/ready' });
    expect(healthLiveOutputSchema.parse({ status: 'ok', version: '1.0.0' })).toEqual({ status: 'ok', version: '1.0.0' });
    expect(
      healthReadyOutputSchema.parse({
        status: 'ok',
        version: '1.0.0',
        checks: [{ name: 'catalog', ok: true, detail: 'opened' }],
      }).checks,
    ).toHaveLength(1);
  });

  it('tags reads with GET and writes with POST or DELETE', () => {
    expect(API_ROUTES.health.method).toBe('GET');
    expect(API_ROUTES.scan.method).toBe('GET');
    expect(API_ROUTES.catalogTree).toMatchObject({ method: 'GET', path: '/api/catalog-tree' });
    expect(API_ROUTES.status.method).toBe('GET');
    expect(API_ROUTES.configGet.method).toBe('GET');
    expect(API_ROUTES.providersList.method).toBe('GET');
    expect(API_ROUTES.whisperModelsList.method).toBe('GET');
    expect(API_ROUTES.localAiRequirements.method).toBe('GET');
    expect(API_ROUTES.doctor.method).toBe('GET');
    expect(API_ROUTES.readiness).toMatchObject({ method: 'GET', path: '/api/readiness' });
    expect(API_ROUTES.check.method).toBe('GET');
    expect(API_ROUTES.jobStatus.method).toBe('GET');
    expect(API_ROUTES.jobsList.method).toBe('GET');
    expect(API_ROUTES.tagsList.method).toBe('GET');
    expect(API_ROUTES.searchQuery).toMatchObject({ method: 'GET', path: '/api/search' });

    expect(API_ROUTES.process.method).toBe('POST');
    expect(API_ROUTES.thumbnail.method).toBe('POST');
    expect(API_ROUTES.resetAll.method).toBe('POST');
    expect(API_ROUTES.resetSingle.method).toBe('POST');
    expect(API_ROUTES.configSet.method).toBe('POST');
    expect(API_ROUTES.providerTest.method).toBe('POST');
    expect(API_ROUTES.whisperModelDownload.method).toBe('POST');
    expect(API_ROUTES.whisperModelUse.method).toBe('POST');
    expect(API_ROUTES.localAiPull.method).toBe('POST');
    expect(API_ROUTES.localAiDaemonStop.method).toBe('POST');
    expect(API_ROUTES.jobCancel.method).toBe('POST');
    expect(API_ROUTES.tagsAlias.method).toBe('POST');

    expect(API_ROUTES.whisperModelDelete.method).toBe('DELETE');
    expect(API_ROUTES.localAiRm.method).toBe('DELETE');
  });

  it('accepts an explicit home readiness scope without a folder', () => {
    expect(API_ROUTES.readiness.input.parse({ scope: 'home', refresh: 'true' })).toEqual({
      scope: 'home',
      refresh: true,
    });
    expect(API_ROUTES.readiness.input.safeParse({ folder: '/videos', scope: 'home' }).success).toBe(false);
  });
});
