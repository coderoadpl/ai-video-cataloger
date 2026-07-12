import { describe, expect, it } from 'vitest';

import {
  API_ROUTES,
  doctorOutputSchema,
  jobOutputSchema,
  scanOutputSchema,
  whisperModelsListOutputSchema,
} from './routes.js';

describe('route schemas', () => {
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
      machine: {
        platform: 'darwin',
        arch: 'arm64',
        totalMemGB: 32,
        appleSilicon: true,
      },
      recommendedLocalModel: 'gemma3:12b',
      allAvailable: false,
    });
    expect(parsed.dependencies).toHaveLength(2);
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

  it('round-trips process job progress', () => {
    const parsed = jobOutputSchema.parse({
      jobId: 'job-1',
      kind: 'process',
      status: 'running',
      progress: {
        step: 'transcribing_audio',
        percentage: 60,
        current: 3,
        total: 5,
        data: {
          video: '/videos/clip.mp4',
          stepNumber: 3,
          totalSteps: 5,
        },
      },
      error: null,
      createdAt: '2026-07-12T10:00:00.000Z',
      updatedAt: '2026-07-12T10:01:00.000Z',
    });
    expect(parsed.progress?.step).toBe('transcribing_audio');
  });

  it('tags reads with GET and writes with POST or DELETE', () => {
    expect(API_ROUTES.health.method).toBe('GET');
    expect(API_ROUTES.scan.method).toBe('GET');
    expect(API_ROUTES.status.method).toBe('GET');
    expect(API_ROUTES.configGet.method).toBe('GET');
    expect(API_ROUTES.whisperModelsList.method).toBe('GET');
    expect(API_ROUTES.localAiRequirements.method).toBe('GET');
    expect(API_ROUTES.doctor.method).toBe('GET');
    expect(API_ROUTES.check.method).toBe('GET');
    expect(API_ROUTES.jobStatus.method).toBe('GET');
    expect(API_ROUTES.jobsList.method).toBe('GET');

    expect(API_ROUTES.process.method).toBe('POST');
    expect(API_ROUTES.thumbnail.method).toBe('POST');
    expect(API_ROUTES.resetAll.method).toBe('POST');
    expect(API_ROUTES.resetSingle.method).toBe('POST');
    expect(API_ROUTES.configSet.method).toBe('POST');
    expect(API_ROUTES.whisperModelDownload.method).toBe('POST');
    expect(API_ROUTES.whisperModelUse.method).toBe('POST');
    expect(API_ROUTES.localAiPull.method).toBe('POST');
    expect(API_ROUTES.localAiDaemonStop.method).toBe('POST');
    expect(API_ROUTES.jobCancel.method).toBe('POST');

    expect(API_ROUTES.whisperModelDelete.method).toBe('DELETE');
    expect(API_ROUTES.localAiRm.method).toBe('DELETE');
  });
});
