import { describe, expect, it } from 'vitest';

import { buildConfigDescriptor, configId } from '@core/domain/index.js';

import {
  API_ROUTES,
  doctorOutputSchema,
  driveRunFacesSchema,
  facesIndexOutputSchema,
  healthLiveOutputSchema,
  healthReadyOutputSchema,
  jobKindSchema,
  jobOutputSchema,
  jobProgressSchema,
  jobProgressStepSchema,
  jobResultSchema,
  materializeSummarySchema,
  scanOutputSchema,
  whisperModelsListOutputSchema,
  providerTestOutputSchema,
  searchOutputSchema,
  tagsSuggestAliasesOutputSchema,
  variantsListOutputSchema,
  catalogLocationsOutputSchema,
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
      }],
    });
    expect(parsed.results[0]?.folder.folderId).toBe('path-1a2b3c4d');
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
});
