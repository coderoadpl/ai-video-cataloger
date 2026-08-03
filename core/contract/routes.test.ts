import { describe, expect, it } from 'vitest';

import { buildConfigDescriptor, configId } from '@core/domain/index.js';

import {
  API_ROUTES,
  doctorOutputSchema,
  driveRunFacesSchema,
  facesIndexOutputSchema,
  gpsBackfillSummarySchema,
  healthLiveOutputSchema,
  healthReadyOutputSchema,
  jobKindSchema,
  jobOutputSchema,
  jobProgressSchema,
  jobProgressStepSchema,
  jobResultSchema,
  materializeSummarySchema,
  photoGpsBackfillSummarySchema,
  photoImportLibraSummarySchema,
  photoProxiesSummarySchema,
  scanOutputSchema,
  whisperModelsListOutputSchema,
  providerTestOutputSchema,
  photosSearchOutputSchema,
  photosVariantsDeleteOutputSchema,
  photosVariantsFolderDefaultOutputSchema,
  photosVariantsListOutputSchema,
  collectionInputSchema,
  collectionItemSchema,
  collectionOutputSchema,
  libraryPreviewInputSchema,
  libraryPreviewOutputSchema,
  libraryPreviewPersonSchema,
  searchInputSchema,
  searchOutputSchema,
  tagsSuggestAliasesOutputSchema,
  variantsListOutputSchema,
  catalogLocationsOutputSchema,
  libraryFacetsOutputSchema,
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
      credentials: { backend: 'keychain', reason: 'ok' },
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
      total: 1,
      results: [{
        fingerprint: 'fp-1',
        variantCount: 2,
        fileName: 'clip.mp4',
        finalName: 'drone-clip.mp4',
        description: 'A drone clip',
        snippet: '<mark>drone</mark> clip',
        thumbnailPath: '/drive/.ai-video-cataloger/thumbnails/drone-clip.jpg',
        tags: ['aerial'],
        folder: {
          folderId: '11111111-1111-4111-8111-111111111111',
          currentPath: '/drive',
          displayName: 'drive',
          online: true,
        },
        gps: { lat: 51, lon: 17 },
        missing: false,
        capturedAt: '2026-01-01T00:00:00.000Z',
        place: null,
        width: null,
        height: null,
      }],
    });
    expect(parsed.results[0]?.folder.online).toBe(true);
  });

  it('defines closed variant locators and a comparison-ready response', () => {
    const descriptor = buildConfigDescriptor({ output_language: 'pl' }, 3);
    const resolvedConfigId = configId(descriptor);

    expect(API_ROUTES.variantsList.input.parse({ videoPath: '/videos/clip.mp4' })).toEqual({
      videoPath: '/videos/clip.mp4',
    });
    expect(API_ROUTES.variantsList.input.parse({ fingerprint: 'fp-1' })).toEqual({ fingerprint: 'fp-1' });
    expect(API_ROUTES.variantsList.input.safeParse({}).success).toBe(false);
    expect(API_ROUTES.variantsList.input.safeParse({ videoPath: '/videos/clip.mp4', fingerprint: 'fp-1' }).success)
      .toBe(false);
    expect(API_ROUTES.variantsSelect.input.safeParse({
      fingerprint: 'fp-1',
      configId: resolvedConfigId,
      unexpected: true,
    }).success).toBe(false);
    expect(API_ROUTES.variantsSelect.input.parse({
      fingerprint: 'fp-1',
      configId: resolvedConfigId,
      deferProjection: true,
    })).toEqual({ fingerprint: 'fp-1', configId: resolvedConfigId, deferProjection: true });

    const parsed = variantsListOutputSchema.parse({
      fingerprint: 'fp-1',
      videoPath: '/videos/clip.mp4',
      folderPath: '/videos',
      folderDefaultConfigId: resolvedConfigId,
      currentConfig: {
        configId: resolvedConfigId,
        descriptor,
      },
      variants: [{
        configId: resolvedConfigId,
        descriptor,
        label: 'claude-code',
        createdAt: '2026-08-02T10:00:00.000Z',
        analyzer: 'claude-code',
        model: null,
        usage: { inputTokens: 12, estimatedCostUsd: 0.01 },
        estimatedCostUsd: 0.01,
        artifacts: {
          framesDirectory: '/videos/.ai-video-cataloger/artifacts/frames/fp-1/frm_1',
          transcriptPath: '/videos/.ai-video-cataloger/artifacts/transcripts/fp-1/trx_1.txt',
          summaryPath: `/videos/.ai-video-cataloger/variants/fp-1/${resolvedConfigId}/summary.txt`,
        },
        selected: true,
        finalName: 'named.mp4',
        description: 'A description',
        transcript: 'A transcript',
        language: 'pl',
        tags: ['example'],
      }],
    });

    expect(parsed.variants[0]).toMatchObject({
      configId: resolvedConfigId,
      descriptor: { output_language: 'pl', promptVersion: 3 },
      selected: true,
    });
  });

  it('accepts the derived path folder id a read-only folder produces', () => {
    const parsed = searchOutputSchema.parse({
      query: 'drone',
      limit: 50,
      offset: 0,
      count: 1,
      total: 1,
      results: [{
        fingerprint: 'fp-ro',
        variantCount: 1,
        fileName: 'clip.mp4',
        finalName: null,
        description: null,
        snippet: '<mark>drone</mark> clip',
        thumbnailPath: null,
        tags: [],
        folder: {
          folderId: 'path-1a2b3c4d',
          currentPath: '/read-only-drive',
          displayName: 'read-only-drive',
          online: true,
        },
        gps: null,
        missing: false,
        capturedAt: null,
        place: null,
        width: null,
        height: null,
      }],
    });
    expect(parsed.results[0]?.folder.folderId).toBe('path-1a2b3c4d');
  });

  it('still parses the pre-Library search input shape (query, limit, offset only)', () => {
    const parsed = searchInputSchema.parse({ query: 'drone', limit: 50, offset: 0 });
    expect(parsed).toMatchObject({
      query: 'drone',
      tags: [],
      people: [],
      thumbnails: 'ensure',
      limit: 50,
      offset: 0,
    });
    expect(parsed.sort).toBeUndefined();
    expect(parsed.hasGps).toBeUndefined();
  });

  it('round-trips a Library filter request with a comma-separated query-string shape', () => {
    const parsed = searchInputSchema.parse({
      tags: 'beach,sunset',
      people: 'p1,p2',
      place: 'wroc',
      from: '2026-01-01',
      to: '2026-01-31T00:00:00.000Z',
      hasGps: 'true',
      folderId: '11111111-1111-4111-8111-111111111111',
      sort: 'captured_desc',
      thumbnails: 'existing',
      limit: '25',
      offset: '10',
    });
    expect(parsed).toEqual({
      query: undefined,
      tags: ['beach', 'sunset'],
      people: ['p1', 'p2'],
      place: 'wroc',
      from: '2026-01-01',
      to: '2026-01-31T00:00:00.000Z',
      hasGps: true,
      folderId: '11111111-1111-4111-8111-111111111111',
      sort: 'captured_desc',
      thumbnails: 'existing',
      limit: 25,
      offset: 10,
    });
  });

  it('treats hasGps=false as a distinct explicit filter from an absent hasGps', () => {
    expect(searchInputSchema.parse({ tags: 'beach', hasGps: 'false' }).hasGps).toBe(false);
    expect(searchInputSchema.parse({ tags: 'beach' }).hasGps).toBeUndefined();
  });

  it('requires a non-empty fingerprint for the library preview route, and validates its output shape', () => {
    expect(libraryPreviewInputSchema.safeParse({ fingerprint: '' }).success).toBe(false);
    expect(libraryPreviewInputSchema.parse({ fingerprint: 'fp-1' })).toEqual({ fingerprint: 'fp-1' });
    expect(libraryPreviewPersonSchema.parse({ personId: 'person-a', displayName: null })).toEqual({
      personId: 'person-a',
      displayName: null,
    });
    const output = libraryPreviewOutputSchema.parse({
      fingerprint: 'fp-1',
      path: '/videos/clip.mp4',
      fileName: 'clip.mp4',
      size: 2048,
      sizeFormatted: '2.0 KB',
      durationS: 65,
      durationFormatted: '1:05',
      transcript: 'hello',
      transcriptSegments: [{ start: 0, end: 1, text: 'hello' }],
      width: 1920,
      height: 1080,
      rotation: 0,
      people: [{ personId: 'person-a', displayName: 'Ada' }],
    });
    expect(output.people).toEqual([{ personId: 'person-a', displayName: 'Ada' }]);
    expect(output.transcriptSegments).toEqual([{ start: 0, end: 1, text: 'hello' }]);
    expect(output.width).toBe(1920);
  });

  it('parses a bare browse-everything collection input with defaults, cursor optional', () => {
    const parsed = collectionInputSchema.parse({});
    expect(parsed).toMatchObject({ tags: [], people: [], media: 'all', limit: 50 });
    expect(parsed.cursor).toBeUndefined();
    expect(parsed.sort).toBeUndefined();
  });

  it('round-trips a media-scoped collection request with a cursor', () => {
    const parsed = collectionInputSchema.parse({
      query: 'drone',
      media: 'photo',
      limit: '25',
      cursor: 'eyJ2IjoxfQ',
    });
    expect(parsed).toMatchObject({ query: 'drone', media: 'photo', limit: 25, cursor: 'eyJ2IjoxfQ' });
  });

  it('discriminates video and photo collection items by the media literal', () => {
    const video = collectionItemSchema.parse({
      media: 'video',
      fingerprint: 'fp-1',
      variantCount: 0,
      fileName: 'clip.mp4',
      finalName: null,
      description: null,
      snippet: '',
      thumbnailPath: null,
      tags: [],
      folder: { folderId: '11111111-1111-4111-8111-111111111111', currentPath: '/videos', displayName: 'videos', online: true },
      gps: null,
      missing: false,
      capturedAt: null,
      place: null,
      width: null,
      height: null,
    });
    expect(video.media).toBe('video');

    const photo = collectionItemSchema.parse({
      media: 'photo',
      fingerprint: 'ph_0000000000000001',
      fileName: 'a.jpg',
      currentPath: '/photos/a.jpg',
      ext: 'jpg',
      capturedAt: null,
      description: null,
      snippet: '',
      tags: [],
      variantCount: 0,
      missingAt: null,
      thumbPath: null,
      gridThumbPath: null,
      proxyPath: null,
    });
    expect(photo.media).toBe('photo');
  });

  it('parses a collection output envelope with per-media totals and a nullable next cursor', () => {
    const parsed = collectionOutputSchema.parse({
      query: null,
      media: 'all',
      limit: 50,
      total: 3,
      videoTotal: 2,
      photoTotal: 1,
      count: 3,
      items: [],
      nextCursor: null,
    });
    expect(parsed.nextCursor).toBeNull();
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

  it('keeps variant identity on completed and catalog skip job payloads', () => {
    const configId = 'cfg_0123456789ab';
    const parsed = jobOutputSchema.parse({
      jobId: 'job-variant',
      kind: 'process',
      status: 'completed',
      progress: {
        step: 'catalog_index_skipped',
        data: { video: '/videos/clip.mp4', reason: 'variant_exists', configId },
      },
      progressEvents: [{
        sequence: 1,
        progress: {
          step: 'catalog_index_skipped',
          data: { video: '/videos/clip.mp4', reason: 'variant_exists', configId },
        },
      }],
      result: {
        video: 'clip.mp4',
        path: '/videos/clip.mp4',
        status: 'completed',
        configId,
        selectedConfigId: 'legacy',
      },
      error: null,
      createdAt: '2026-08-02T10:00:00.000Z',
      updatedAt: '2026-08-02T10:00:01.000Z',
    });

    expect(parsed.result).toMatchObject({ configId, selectedConfigId: 'legacy' });
    expect(parsed.progress?.data).toEqual({
      video: '/videos/clip.mp4',
      reason: 'variant_exists',
      configId,
    });
  });

  it('carries snapshotSkipped on a completed drive-run job payload', () => {
    const parsed = jobOutputSchema.parse({
      jobId: 'job-drive-1',
      kind: 'process_drive',
      status: 'completed',
      progress: null,
      progressEvents: [],
      result: {
        runId: 'run-1',
        root: '/videos',
        startedAt: '2026-07-29T10:00:00.000Z',
        finishedAt: '2026-07-29T10:01:00.000Z',
        foldersTotal: 1,
        foldersDone: 1,
        filesTotal: 1,
        filesDone: 1,
        filesSkipped: 0,
        filesDuplicateSkipped: 0,
        filesFailed: 0,
        snapshotSkipped: 1,
        elapsedMs: 60000,
        failures: [],
      },
      error: null,
      createdAt: '2026-07-29T10:00:00.000Z',
      updatedAt: '2026-07-29T10:01:00.000Z',
    });

    expect(parsed.result).toMatchObject({ snapshotSkipped: 1 });
  });

  it('accepts the additive artifact reuse progress step', () => {
    const parsed = jobProgressSchema.parse({
      step: 'artifact_reused',
      data: {
        kind: 'frames',
        configId: 'cfg_0123456789ab',
        sourceConfigId: 'cfg_abcdef012345',
      },
    });

    expect(parsed).toEqual({
      step: 'artifact_reused',
      data: {
        kind: 'frames',
        configId: 'cfg_0123456789ab',
        sourceConfigId: 'cfg_abcdef012345',
      },
    });
  });

  it('exposes the faces recluster route with a defaulted dryRun input', () => {
    expect(API_ROUTES.facesRecluster).toMatchObject({ method: 'POST', path: '/api/faces/recluster' });
    expect(API_ROUTES.facesRecluster.input.parse({})).toEqual({ dryRun: false });
    expect(API_ROUTES.facesRecluster.input.parse({ dryRun: true })).toEqual({ dryRun: true });
    expect(jobKindSchema.parse('faces_recluster')).toBe('faces_recluster');
  });

  it('exposes the faces exemplars route with defaulted dryRun and limit inputs', () => {
    expect(API_ROUTES.facesExemplars).toMatchObject({ method: 'POST', path: '/api/faces/exemplars' });
    expect(API_ROUTES.facesExemplars.input.parse({})).toEqual({ dryRun: false, limit: null });
    expect(API_ROUTES.facesExemplars.input.parse({ dryRun: true, limit: 5 })).toEqual({ dryRun: true, limit: 5 });
    expect(jobKindSchema.parse('faces_exemplars')).toBe('faces_exemplars');
  });

  it('exposes the materialize route and round-trips its summary and progress step', () => {
    expect(API_ROUTES.materialize).toMatchObject({ method: 'POST', path: '/api/materialize' });
    expect(API_ROUTES.materialize.input.parse({ root: '/videos' })).toEqual({ root: '/videos', dryRun: false });

    const summary = materializeSummarySchema.parse({
      root: '/videos',
      dryRun: false,
      startedAt: '2026-08-04T00:00:00.000Z',
      finishedAt: '2026-08-04T00:00:05.000Z',
      foldersTotal: 1,
      foldersDone: 1,
      foldersNotWritable: 0,
      filesTotal: 1,
      filesMaterialized: 1,
      filesUnchanged: 0,
      filesSkipped: 0,
      filesFailed: 0,
      collisions: 0,
      skipped: {
        notInCatalog: 0,
        noVariant: 0,
        noFinalName: 0,
        fingerprintUnavailable: 0,
        duplicate: 0,
      },
      elapsedMs: 5000,
      failures: [],
    });
    expect(summary.filesMaterialized).toBe(1);

    const parsed = jobProgressSchema.parse({
      step: 'materialize_file',
      current: 1,
      total: 1,
      data: {
        video: '/videos/clip.mp4',
        fingerprint: 'fp1',
        configId: 'cfg_0123456789ab',
        finalName: '2026-01-02_beach-walk.mp4',
        appliedName: '2026-01-02_beach-walk.mp4',
        collision: false,
        changed: true,
        dryRun: false,
        operations: ['artifact_store', 'catalog_final_name', 'rename_video', 'catalog_relocate', 'project_selected'],
      },
    });
    expect(parsed.step).toBe('materialize_file');
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
    expect(API_ROUTES.tagsSuggestAliases).toMatchObject({ method: 'GET', path: '/api/tags/suggest-aliases' });
    expect(API_ROUTES.searchQuery).toMatchObject({ method: 'GET', path: '/api/search' });
    expect(API_ROUTES.libraryPreview).toMatchObject({ method: 'GET', path: '/api/library/preview' });
    expect(API_ROUTES.variantsList).toMatchObject({ method: 'GET', path: '/api/variants' });

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
    expect(API_ROUTES.variantsSelect).toMatchObject({ method: 'POST', path: '/api/variants/select' });
    expect(API_ROUTES.variantsDelete).toMatchObject({ method: 'POST', path: '/api/variants/delete' });
    expect(API_ROUTES.variantsFolderDefault).toMatchObject({
      method: 'POST',
      path: '/api/variants/folder-default',
    });

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

  it('accepts every analyzer family in the readiness output, gemini-native included', () => {
    const parsed = API_ROUTES.readiness.output.safeParse({
      ready: true,
      analyzer: {
        kind: 'analyzer',
        name: 'gemini',
        available: true,
        message: 'gemini is available',
        suggestedAction: null,
        family: 'gemini-native',
        providerId: 'gemini',
        model: 'gemini-3.6-flash',
      },
      transcriber: {
        kind: 'transcriber',
        name: 'transcription-skip',
        available: true,
        message: 'transcription-skip is available',
        suggestedAction: null,
        mode: 'skip',
        model: null,
      },
      missingPieces: [],
      suggestedAction: null,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.transcriber).toMatchObject({ engine: null, binaryPath: null, warning: null });
  });

  it('canonicalizes every path-shaped input field to NFC', () => {
    const nfd = '/w/Å-ring';
    const nfc = '/w/Å-ring';
    expect(nfd).not.toBe(nfc);

    expect(API_ROUTES.status.input.parse({ folder: nfd })).toEqual({ folder: nfc });
    expect(API_ROUTES.resetAll.input.parse({ folder: nfd, force: false })).toMatchObject({ folder: nfc });
    expect(API_ROUTES.catalogTree.input.parse({ folder: nfd })).toEqual({ folder: nfc });
    expect(API_ROUTES.process.input.parse({ videoPath: `${nfd}/a.mp4` })).toMatchObject({ videoPath: `${nfc}/a.mp4` });
    expect(API_ROUTES.processDrive.input.parse({ root: nfd })).toMatchObject({ root: nfc });
    expect(API_ROUTES.materialize.input.parse({ root: nfd })).toMatchObject({ root: nfc });
    expect(API_ROUTES.thumbnails.input.parse({ root: nfd })).toMatchObject({ root: nfc });
    expect(API_ROUTES.resetSingle.input.parse({ folder: nfd, filename: 'clip.mp4' })).toMatchObject({ folder: nfc });
    expect(API_ROUTES.configGet.input.parse({ folder: nfd })).toMatchObject({ folder: nfc });
    expect(API_ROUTES.configSet.input.parse({ folder: nfd, key: 'frames', value: '3' })).toMatchObject({ folder: nfc });
    expect(API_ROUTES.readiness.input.parse({ folder: nfd })).toMatchObject({ folder: nfc });
    expect(API_ROUTES.variantsList.input.parse({ videoPath: `${nfd}/a.mp4` })).toMatchObject({ videoPath: `${nfc}/a.mp4` });
    expect(API_ROUTES.variantsFolderDefault.input.parse({ folderPath: nfd, configId: null })).toMatchObject({ folderPath: nfc });
    expect(API_ROUTES.facesIndex.input.parse({ root: nfd })).toEqual({ root: nfc });
  });

  it('rejects an unknown rule in a tag alias proposal', () => {
    const proposal = {
      from: 'kampery', to: 'kamper', fromCount: 63, toCount: 373, rule: 'unknown-rule', canonicalLocked: false,
    };

    expect(tagsSuggestAliasesOutputSchema.safeParse({ proposals: [proposal] }).success).toBe(false);
    expect(
      tagsSuggestAliasesOutputSchema.safeParse({
        proposals: [{ ...proposal, rule: 'pl-plural' }],
      }).success,
    ).toBe(true);
  });

  describe('catalog locations', () => {
    it('exposes a catalog locations route', () => {
      expect(API_ROUTES.catalogLocations.path).toBe('/api/catalog/locations');
      expect(API_ROUTES.catalogLocations.method).toBe('GET');
    });

    const validLocation = {
      fingerprint: 'fp-1',
      fileName: 'clip.mp4',
      finalName: 'drone-clip.mp4',
      lat: 50.0614,
      lon: 19.9366,
      missing: false,
      folder: {
        folderId: '11111111-1111-4111-8111-111111111111',
        currentPath: '/drive',
        displayName: 'drive',
        online: true,
      },
      source: 'camera',
      accuracyM: null,
      intervalKind: null,
      place: null,
    };

    it('round-trips a located file with an online folder', () => {
      const parsed = catalogLocationsOutputSchema.parse({
        totalFiles: 3752,
        locatedFiles: 1,
        locations: [validLocation],
      });
      expect(parsed.locations[0]?.missing).toBe(false);
    });

    it('rejects an out-of-range latitude or longitude', () => {
      expect(catalogLocationsOutputSchema.safeParse({
        totalFiles: 1,
        locatedFiles: 1,
        locations: [{ ...validLocation, lat: 91 }],
      }).success).toBe(false);
      expect(catalogLocationsOutputSchema.safeParse({
        totalFiles: 1,
        locatedFiles: 1,
        locations: [{ ...validLocation, lon: -181 }],
      }).success).toBe(false);
    });

    it('rejects an unknown key on a location row', () => {
      expect(catalogLocationsOutputSchema.safeParse({
        totalFiles: 1,
        locatedFiles: 1,
        locations: [{ ...validLocation, unexpected: true }],
      }).success).toBe(false);
    });

    it('does not couple locatedFiles to locations.length', () => {
      expect(catalogLocationsOutputSchema.safeParse({
        totalFiles: 10,
        locatedFiles: 5,
        locations: [validLocation],
      }).success).toBe(true);
    });

    it('parses an old envelope with no media/photo totals, defaulting media to video and totals to 0 (compatibility pin)', () => {
      const parsed = catalogLocationsOutputSchema.parse({
        totalFiles: 3752,
        locatedFiles: 1,
        locations: [validLocation],
      });
      expect(parsed.totalPhotos).toBe(0);
      expect(parsed.locatedPhotos).toBe(0);
      expect(parsed.locations[0]?.media).toBe('video');
    });

    it('round-trips a photo location row alongside a video one', () => {
      const parsed = catalogLocationsOutputSchema.parse({
        totalFiles: 1,
        locatedFiles: 1,
        totalPhotos: 1,
        locatedPhotos: 1,
        locations: [validLocation, {
          fingerprint: 'ph_0000000000000001',
          media: 'photo',
          fileName: 'a.jpg',
          finalName: null,
          lat: 1,
          lon: 1,
          missing: false,
          folder: { folderId: 'path-aaaaaaaa', currentPath: '/media/photos', displayName: 'photos', online: true },
          source: null,
          accuracyM: null,
          intervalKind: null,
          place: null,
        }],
      });
      expect(parsed.locations.map((location) => location.media)).toEqual(['video', 'photo']);
    });
  });

  describe('library facets route', () => {
    it('exposes a library facets route', () => {
      expect(API_ROUTES.libraryFacets.path).toBe('/api/library/facets');
      expect(API_ROUTES.libraryFacets.method).toBe('GET');
    });

    it('round-trips a populated facets response', () => {
      const parsed = libraryFacetsOutputSchema.parse({
        tags: [{ name: 'beach', count: 4 }],
        people: [{ personId: 'person-1', displayName: 'Ada', count: 2 }],
        places: [{ name: 'Wrocław', country: 'Poland', countryCode: 'PL', count: 1 }],
        years: [{ year: '2026', count: 3 }],
        folders: [{ folderId: 'path-deadbeef', displayName: 'Kamper', currentPath: '/media/kamper', online: false, count: 3 }],
        counts: { total: 10, withGps: 3, withoutCaptureDate: 2, missing: 1, offlineFolders: 1 },
      });
      expect(parsed.tags[0]?.name).toBe('beach');
    });

    it('accepts an empty facets response for an empty catalog', () => {
      expect(libraryFacetsOutputSchema.safeParse({
        tags: [],
        people: [],
        places: [],
        years: [],
        folders: [],
        counts: { total: 0, withGps: 0, withoutCaptureDate: 0, missing: 0, offlineFolders: 0 },
      }).success).toBe(true);
    });

    it('rejects an unknown key on the counts object', () => {
      expect(libraryFacetsOutputSchema.safeParse({
        tags: [],
        people: [],
        places: [],
        years: [],
        folders: [],
        counts: { total: 0, withGps: 0, withoutCaptureDate: 0, missing: 0, offlineFolders: 0, unexpected: true },
      }).success).toBe(false);
    });
  });

  it('accepts faces_file_failed as a job progress step', () => {
    expect(jobProgressStepSchema.safeParse('faces_file_failed').success).toBe(true);
  });

  it('defaults the driveRunFacesSchema tolerance fields when a run predates them', () => {
    const parsed = driveRunFacesSchema.parse({
      ran: true,
      skippedReason: null,
      filesIndexed: 3,
      observationsAdded: 12,
      peopleCreated: 2,
      error: null,
    });

    expect(parsed).toMatchObject({ filesFailed: 0, failureCodes: [], aborted: false });
  });

  it('round-trips filesFailed, failureCodes and aborted on driveRunFacesSchema', () => {
    const parsed = driveRunFacesSchema.parse({
      ran: true,
      skippedReason: null,
      filesIndexed: 3,
      observationsAdded: 12,
      peopleCreated: 2,
      filesFailed: 1,
      failureCodes: [{ code: 'processing_error', count: 1 }],
      aborted: false,
      error: null,
    });

    expect(parsed.filesFailed).toBe(1);
    expect(parsed.failureCodes).toEqual([{ code: 'processing_error', count: 1 }]);
  });

  it('keeps filesFailed, failures and aborted on facesIndexOutputSchema through jobResultSchema', () => {
    const output = {
      root: '/videos',
      foldersMatched: 1,
      filesInScope: 3,
      filesScanned: 3,
      filesIndexed: 2,
      observationsAdded: 4,
      peopleCreated: 1,
      filesFailed: 1,
      failures: [{ path: '/videos/bad.mp4', fingerprint: 'fp-bad', code: 'processing_error', message: 'boom' }],
      aborted: false,
    };

    expect(facesIndexOutputSchema.parse(output)).toMatchObject(output);
    const viaUnion = jobResultSchema.parse(output);
    expect(viaUnion).toMatchObject({ filesFailed: 1, failures: output.failures, aborted: false });
  });

  it('round-trips photoScanSummarySchema through jobResultSchema with the media discriminator, and every other member rejects it', () => {
    const sample = {
      media: 'photo' as const,
      root: '/photos',
      runId: 'photo-run-1',
      filesTotal: 10,
      photosNew: 8,
      photosUpdated: 2,
      pathsSeen: 10,
      skippedUnchanged: 0,
      readFailed: 0,
      exifRead: 6,
      exifFailed: 4,
      missingMarked: 1,
      folderReadErrors: 0,
      proxies: {
        ran: true,
        generated: 8,
        skippedExisting: 2,
        failed: 0,
        skippedReason: null,
      },
    };

    const viaUnion = jobResultSchema.parse(sample);
    expect(viaUnion).toEqual(sample);

    const acceptingCount = jobResultSchema.options.filter((option) => option.safeParse(sample).success).length;
    expect(acceptingCount).toBe(1);
  });

  it('round-trips photoProxiesSummarySchema through jobResultSchema with the media discriminator, and every other member rejects it', () => {
    const sample = {
      media: 'photo' as const,
      root: '/photos',
      force: false,
      candidates: 10,
      generated: 8,
      skippedExisting: 2,
      failed: 0,
      thumbFailed: 0,
      gridFailed: 0,
    };

    const viaUnion = jobResultSchema.parse(sample);
    expect(viaUnion).toEqual(sample);

    const acceptingCount = jobResultSchema.options.filter((option) => option.safeParse(sample).success).length;
    expect(acceptingCount).toBe(1);
  });

  it('defaults photoProxiesSummarySchema.gridFailed for old NDJSON payloads without the field', () => {
    const legacy = {
      media: 'photo' as const,
      root: '/photos',
      force: false,
      candidates: 10,
      generated: 8,
      skippedExisting: 2,
      failed: 0,
      thumbFailed: 0,
    };

    const parsed = photoProxiesSummarySchema.parse(legacy);

    expect(parsed.gridFailed).toBe(0);
  });

  it('round-trips photoProcessSummarySchema through jobResultSchema with the media discriminator, and every other member rejects it (P2)', () => {
    const sample = {
      media: 'photo' as const,
      root: '/photos',
      force: false,
      configId: 'cfg_ab12cd34ef56',
      batchSize: 12,
      candidates: 10,
      analysed: 8,
      failed: 1,
      skippedExisting: 1,
      splitRetries: 2,
    };

    const viaUnion = jobResultSchema.parse(sample);
    expect(viaUnion).toEqual(sample);

    const acceptingCount = jobResultSchema.options.filter((option) => option.safeParse(sample).success).length;
    expect(acceptingCount).toBe(1);
  });

  it('round-trips photoGpsBackfillSummarySchema through jobResultSchema, pins gpsBackfillSummarySchema shape unchanged, and each rejects the other', () => {
    const photoSample = {
      media: 'photo' as const,
      timelinePath: '/timeline.json',
      dryRun: false,
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:01:00.000Z',
      timeline: { entries: 1, entriesSkipped: 0, entriesIgnored: 0, intervals: 1, firstStart: null, lastEnd: null },
      photosTotal: 1,
      photosConsidered: 1,
      matched: { visit: 1, activity: 0, path: 0 },
      matchedWithinTolerance: 0,
      assumedWidened: 0,
      written: 1,
      unchanged: 0,
      unmatched: 0,
      skipped: { cameraGps: 0, manualGps: 0, noCapturedAt: 0 },
      accuracy: { buckets: [{ upToM: 200, files: 1 }], medianM: 50, p90M: 50 },
      places: { datasetId: null, resolved: 0, unresolved: 0, skippedNoDataset: 1 },
      elapsedMs: 5,
    };

    const viaUnion = jobResultSchema.parse(photoSample);
    expect(viaUnion).toEqual(photoSample);
    const acceptingCount = jobResultSchema.options.filter((option) => option.safeParse(photoSample).success).length;
    expect(acceptingCount).toBe(1);
    expect(gpsBackfillSummarySchema.safeParse(photoSample).success).toBe(false);

    const videoSample = {
      timelinePath: '/timeline.json',
      dryRun: false,
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:01:00.000Z',
      timeline: { entries: 1, entriesSkipped: 0, entriesIgnored: 0, intervals: 1, firstStart: null, lastEnd: null },
      filesTotal: 1,
      filesConsidered: 1,
      capturedAtProbed: 0,
      matched: { visit: 1, activity: 0, path: 0 },
      matchedWithinTolerance: 0,
      written: 1,
      unchanged: 0,
      unmatched: 0,
      skipped: { cameraGps: 0, manualGps: 0, noCapturedAt: 0, offline: 0 },
      skewSuspicious: 0,
      skewSamples: [],
      accuracy: { buckets: [{ upToM: 200, files: 1 }], medianM: 50, p90M: 50 },
      places: { datasetId: null, resolved: 0, unresolved: 0, skippedNoDataset: 1 },
      failures: [],
      elapsedMs: 5,
    };

    const videoViaUnion = jobResultSchema.parse(videoSample);
    expect(videoViaUnion).toEqual(videoSample);
    const videoAcceptingCount = jobResultSchema.options.filter((option) => option.safeParse(videoSample).success).length;
    expect(videoAcceptingCount).toBe(1);
    expect(photoGpsBackfillSummarySchema.safeParse(videoSample).success).toBe(false);
  });

  it('round-trips photoImportLibraSummarySchema through jobResultSchema, and every other member rejects it', () => {
    const sample = {
      media: 'photo' as const,
      artifactsDir: '/artifacts',
      manifestPath: '/manifest.ndjson',
      dryRun: false,
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:01:00.000Z',
      roots: 1,
      manifest: { entries: 1, invalidLines: 0, matched: 1, unmatched: 0 },
      descriptions: { entries: 1, invalidLines: 0, imported: 1, unmatched: 0 },
      faces: { entries: 1, invalidLines: 0, imported: 1, skippedIncomplete: 0, unmatched: 0, photosCompleted: 1 },
      geo: { entries: 1, invalidLines: 0, written: 1, unchanged: 0, skippedPrecedence: 0, skippedUnsupportedSource: 0, unmatched: 0 },
      elapsedMs: 5,
    };

    const viaUnion = jobResultSchema.parse(sample);
    expect(viaUnion).toEqual(sample);
    const acceptingCount = jobResultSchema.options.filter((option) => option.safeParse(sample).success).length;
    expect(acceptingCount).toBe(1);
    expect(photoImportLibraSummarySchema.parse(sample)).toEqual(sample);
  });

  it('round-trips photosSearch, photosVariants* routes, and photosDetailOutputSchema.analysis both null and non-null (P6)', () => {
    expect(API_ROUTES.photosSearch.input.safeParse({ query: '', limit: 50, offset: 0 }).success).toBe(false);
    expect(API_ROUTES.photosSearch.input.parse({ query: 'bicycle' })).toEqual({ query: 'bicycle', limit: 50, offset: 0 });

    const searched = photosSearchOutputSchema.parse({
      media: 'photo',
      query: 'bicycle',
      limit: 50,
      offset: 0,
      count: 1,
      results: [{
        fingerprint: 'ph_0000000000000001',
        fileName: 'a.jpg',
        currentPath: '/photos/a.jpg',
        ext: 'jpg',
        capturedAt: '2026-01-01T00:00:00.000Z',
        description: 'a red bicycle',
        snippet: 'a red <mark>bicycle</mark>',
        tags: ['bicycle'],
        variantCount: 1,
        thumbState: 'done',
        proxyState: 'done',
        missingAt: null,
        thumbPath: '/artifacts/thumbs/ph_0000000000000001.jpg',
        proxyPath: '/artifacts/proxies/ph_0000000000000001.jpg',
      }],
    });
    expect(searched.results[0]?.fingerprint).toBe('ph_0000000000000001');

    expect(API_ROUTES.photosVariantsSelect.input.parse({
      fingerprint: 'ph_0000000000000001',
      configId: null,
    })).toEqual({ fingerprint: 'ph_0000000000000001', configId: null });
    expect(API_ROUTES.photosVariantsFolderDefault.input.safeParse({ folderId: 'path-aaaaaaaa', configId: 'not-a-config-id' }).success)
      .toBe(false);

    const variantRecord = {
      configId: 'cfg_ab12cd34ef56',
      label: 'harness · claude-code · en',
      description: 'a red bicycle',
      scene: 'urban',
      quality: 'good',
      language: 'en',
      analyzer: 'harness',
      model: 'claude-code',
      batchSize: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      tags: ['bicycle'],
      selected: true,
      explicit: false,
    };
    const listedVariants = photosVariantsListOutputSchema.parse({
      media: 'photo',
      fingerprint: 'ph_0000000000000001',
      selectedConfigId: 'cfg_ab12cd34ef56',
      variants: [variantRecord],
    });
    expect(listedVariants.variants[0]).toEqual(variantRecord);

    const deleted = photosVariantsDeleteOutputSchema.parse({
      media: 'photo',
      fingerprint: 'ph_0000000000000001',
      configId: 'cfg_ab12cd34ef56',
      selectedConfigId: null,
    });
    expect(deleted.selectedConfigId).toBeNull();

    const folderDefaulted = photosVariantsFolderDefaultOutputSchema.parse({
      media: 'photo',
      folderId: 'path-aaaaaaaa',
      defaultConfigId: null,
    });
    expect(folderDefaulted.defaultConfigId).toBeNull();

    const detailBase = {
      media: 'photo' as const,
      photo: {
        fingerprint: 'ph_0000000000000001',
        folderId: 'path-aaaaaaaa',
        fileName: 'a.jpg',
        currentPath: '/photos/a.jpg',
        ext: 'jpg' as const,
        size: 1024,
        width: 100,
        height: 100,
        orientation: 1,
        cameraMake: null,
        cameraModel: null,
        lens: null,
        iso: null,
        fNumber: null,
        exposureTime: null,
        exifRating: null,
        capturedAt: '2026-01-01T00:00:00.000Z',
        capturedAtSource: 'file_mtime' as const,
        discoveredAt: '2026-01-01T00:00:00.000Z',
        exifReadAt: null,
        proxyState: 'done' as const,
        proxyWidth: 1280,
        proxyHeight: 960,
        thumbState: 'done' as const,
        missingAt: null,
      },
      sightings: [],
      ownerPath: '/photos/a.jpg',
      proxyPath: '/artifacts/proxies/ph_0000000000000001.jpg',
      thumbPath: '/artifacts/thumbs/ph_0000000000000001.jpg',
    };

    const detailWithoutAnalysis = API_ROUTES.photosDetail.output.parse({ ...detailBase, analysis: null });
    expect(detailWithoutAnalysis.analysis).toBeNull();

    const analysisSample = {
      configId: 'cfg_ab12cd34ef56',
      label: 'harness · claude-code · en',
      description: 'a red bicycle',
      scene: 'urban',
      quality: 'good',
      tags: ['bicycle'],
      batchSize: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      variantCount: 1,
      explicit: false,
    };
    const detailWithAnalysis = API_ROUTES.photosDetail.output.parse({ ...detailBase, analysis: analysisSample });
    expect(detailWithAnalysis.analysis).toMatchObject({ configId: 'cfg_ab12cd34ef56', explicit: false });
  });
});
