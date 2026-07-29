import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { NodeFileSystemPort } from '@adapters/fs/index.js';
import { API_ROUTES, looseEnvelopeSchema, processCompletedOutputSchema } from '@core/contract/index.js';
import { ok, type CatalogFile, type CatalogFolder } from '@core/domain/index.js';
import { resolveFolderIdentity, type GlobalCatalogStore } from '@core/server/index.js';

import { type AppDeps } from './composition.js';
import { createApp } from './create-app.js';
import { createInMemoryDeps } from './test-support/in-memory-deps.js';
import { scaledTimeout } from '../../../test/helpers/gate-timeout.js';

const responsePayload = async (response: Response): Promise<unknown> => {
  const envelope = looseEnvelopeSchema.parse(await response.json());
  if (!envelope.ok) throw new Error(envelope.error.message);
  return envelope.data;
};

describe('GUI process route variant identity', () => {
  it('keeps the configured variant selected and addressable by fingerprint after a rename', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'avc-gui-home-'));
    const folder = await mkdtemp(path.join(tmpdir(), 'avc-gui-folder-'));
    const originalPath = path.join(folder, 'scratch.mp4');
    await writeFile(originalPath, Buffer.alloc(2048, 1));
    const fs = new NodeFileSystemPort({ workingDirectory: folder, homeDirectory: home });
    const app = createApp(
      { dbDriver: 'memory', workingDirectory: folder, homeDirectory: home },
      (config) => {
        const deps: AppDeps = createInMemoryDeps(config);
        deps.fs = fs;
        deps.media.dependencies = () => Promise.resolve(ok([]));
        deps.media.extractFrames = async (input) => {
          const ensured = await fs.ensureDirectory(input.outputDirectory);
          if (!ensured.ok) return ensured;
          const framePath = path.join(input.outputDirectory, 'frame-001.jpg');
          await writeFile(framePath, Buffer.alloc(32, 2));
          return ok({ framePaths: [framePath] });
        };
        deps.analyzer.dependency = () => Promise.resolve(ok({
          name: 'claude',
          available: true,
          version: null,
          source: null,
          path: null,
          installHint: '',
        }));
        return deps;
      },
    );

    try {
      const acceptedResponse = await app.honoApp.request(API_ROUTES.process.path, {
        method: API_ROUTES.process.method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videoPath: originalPath, whisper: 'skip' }),
      });
      const accepted = API_ROUTES.process.output.parse(await responsePayload(acceptedResponse));

      let job = API_ROUTES.jobStatus.output.parse(
        await responsePayload(
          await app.honoApp.request(`${API_ROUTES.jobStatus.path}?jobId=${encodeURIComponent(accepted.jobId)}`),
        ),
      );
      for (let poll = 0; poll < 100 && (job.status === 'queued' || job.status === 'running'); poll += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        job = API_ROUTES.jobStatus.output.parse(
          await responsePayload(
            await app.honoApp.request(`${API_ROUTES.jobStatus.path}?jobId=${encodeURIComponent(accepted.jobId)}`),
          ),
        );
      }

      if (job.status !== 'completed') throw new Error(JSON.stringify(job.error));
      const completed = processCompletedOutputSchema.parse(job.result);
      expect(completed.path).not.toBe(originalPath);
      expect(completed.configId).toMatch(/^cfg_[0-9a-f]{12}$/);
      expect(completed.selectedConfigId).toBe(completed.configId);

      const fingerprintResult = await fs.partialContentHash(completed.path);
      if (!fingerprintResult.ok || fingerprintResult.value === null) throw new Error('Expected completed fingerprint');
      const variants = API_ROUTES.variantsList.output.parse(
        await responsePayload(
          await app.honoApp.request(
            `${API_ROUTES.variantsList.path}?fingerprint=${encodeURIComponent(fingerprintResult.value)}`,
          ),
        ),
      );

      expect(variants.videoPath).toBe(completed.path);
      expect(variants.variants).toHaveLength(1);
      expect(variants.variants[0]).toMatchObject({
        configId: completed.configId,
        selected: true,
        descriptor: expect.objectContaining({ promptVersion: 1 }),
      });
      expect(variants.variants.some((variant) => variant.configId === 'legacy')).toBe(false);

      const staleLookup = await app.honoApp.request(
        `${API_ROUTES.variantsList.path}?videoPath=${encodeURIComponent(originalPath)}`,
      );
      expect(staleLookup.status).toBe(404);
    } finally {
      await app.dispose();
      await Promise.all([
        rm(home, { recursive: true, force: true }),
        rm(folder, { recursive: true, force: true }),
      ]);
    }
  }, scaledTimeout(30_000));

  it('materializes the legacy folder layout when the file was catalogued before the variants store existed', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'avc-gui-legacy-home-'));
    const folder = await mkdtemp(path.join(tmpdir(), 'avc-gui-legacy-folder-'));
    const originalPath = path.join(folder, 'legacy.mp4');
    await writeFile(originalPath, Buffer.alloc(2048, 3));
    const fs = new NodeFileSystemPort({ workingDirectory: folder, homeDirectory: home });
    const fingerprintResult = await fs.partialContentHash(originalPath);
    if (!fingerprintResult.ok || fingerprintResult.value === null) throw new Error('Expected a fingerprint');
    const fingerprint = fingerprintResult.value;
    const identity = await resolveFolderIdentity(fs, folder);
    if (!identity.ok) throw new Error(identity.error.message);
    const nowIso = new Date().toISOString();

    let capturedGlobalCatalog: GlobalCatalogStore | null = null;
    const app = createApp(
      { dbDriver: 'memory', workingDirectory: folder, homeDirectory: home },
      (config) => {
        const deps: AppDeps = createInMemoryDeps(config);
        deps.fs = fs;
        deps.media.dependencies = () => Promise.resolve(ok([]));
        deps.media.extractFrames = async (input) => {
          const ensured = await fs.ensureDirectory(input.outputDirectory);
          if (!ensured.ok) return ensured;
          const framePath = path.join(input.outputDirectory, 'frame-001.jpg');
          await writeFile(framePath, Buffer.alloc(32, 4));
          return ok({ framePaths: [framePath] });
        };
        deps.analyzer.dependency = () => Promise.resolve(ok({
          name: 'claude',
          available: true,
          version: null,
          source: null,
          path: null,
          installHint: '',
        }));
        capturedGlobalCatalog = deps.globalCatalog;
        return deps;
      },
    );
    if (capturedGlobalCatalog === null) throw new Error('Expected a captured global catalog');
    const globalCatalog: GlobalCatalogStore = capturedGlobalCatalog;

    const folderRecord: CatalogFolder = {
      folderId: identity.value.folderId,
      currentPath: folder,
      displayName: path.basename(folder),
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
    };
    const fileRecord: CatalogFile = {
      fingerprint,
      folderId: identity.value.folderId,
      fileName: path.basename(originalPath),
      size: 2048,
      durationS: null,
      gpsLat: null,
      gpsLon: null,
      processedAt: nowIso,
      analyzer: 'claude',
      model: null,
      missingAt: null,
    };
    const upsertedFolder = await globalCatalog.upsertFolder(folderRecord);
    if (!upsertedFolder.ok) throw new Error(upsertedFolder.error.message);
    const upsertedFile = await globalCatalog.upsertFile(fileRecord);
    if (!upsertedFile.ok) throw new Error(upsertedFile.error.message);
    const upsertedAnalysis = await globalCatalog.upsertAnalysis({
      fingerprint,
      finalName: null,
      description: 'Catalogued before variants existed',
      transcript: null,
      language: null,
      tags: [],
    });
    if (!upsertedAnalysis.ok) throw new Error(upsertedAnalysis.error.message);

    try {
      const acceptedResponse = await app.honoApp.request(API_ROUTES.process.path, {
        method: API_ROUTES.process.method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videoPath: originalPath, whisper: 'skip' }),
      });
      const accepted = API_ROUTES.process.output.parse(await responsePayload(acceptedResponse));

      let job = API_ROUTES.jobStatus.output.parse(
        await responsePayload(
          await app.honoApp.request(`${API_ROUTES.jobStatus.path}?jobId=${encodeURIComponent(accepted.jobId)}`),
        ),
      );
      for (let poll = 0; poll < 100 && (job.status === 'queued' || job.status === 'running'); poll += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        job = API_ROUTES.jobStatus.output.parse(
          await responsePayload(
            await app.honoApp.request(`${API_ROUTES.jobStatus.path}?jobId=${encodeURIComponent(accepted.jobId)}`),
          ),
        );
      }

      if (job.status !== 'completed') throw new Error(JSON.stringify(job.error));
      const completed = processCompletedOutputSchema.parse(job.result);
      expect(completed.selectedConfigId).toBe(completed.configId);
      const base = path.basename(completed.path, path.extname(completed.path));
      const summaryTxt = await fs.isFile(path.join(folder, 'summaries', `${base}.txt`));
      const summaryJson = await fs.isFile(path.join(folder, 'summaries', `${base}.json`));
      const frame = await fs.isFile(path.join(folder, 'frames', base, 'frame-001.jpg'));
      expect(summaryTxt.ok && summaryTxt.value).toBe(true);
      expect(summaryJson.ok && summaryJson.value).toBe(true);
      expect(frame.ok && frame.value).toBe(true);
    } finally {
      await app.dispose();
      await Promise.all([
        rm(home, { recursive: true, force: true }),
        rm(folder, { recursive: true, force: true }),
      ]);
    }
  }, scaledTimeout(30_000));
});
