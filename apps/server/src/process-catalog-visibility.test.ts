import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { NodeFileSystemPort } from '@adapters/fs/index.js';
import { SqlJsGlobalCatalogStore } from '@adapters/db/global-catalog.js';
import { API_ROUTES, looseEnvelopeSchema, processCompletedOutputSchema } from '@core/contract/index.js';
import { ok } from '@core/domain/index.js';

import { type AppDeps } from './composition.js';
import { createApp } from './create-app.js';
import { createInMemoryDeps } from './test-support/in-memory-deps.js';
import { scaledTimeout } from '../../../test/helpers/gate-timeout.js';

const responsePayload = async (response: Response): Promise<unknown> => {
  const envelope = looseEnvelopeSchema.parse(await response.json());
  if (!envelope.ok) throw new Error(envelope.error.message);
  return envelope.data;
};

describe('a single-file GUI analyze is findable in the same session, over the real global catalog', () => {
  it('appears in a library search right after the job settles, with no restart', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'avc-gui-catalog-visibility-home-'));
    const folder = await mkdtemp(path.join(tmpdir(), 'avc-gui-catalog-visibility-folder-'));
    const originalPath = path.join(folder, 'scratch.mp4');
    await writeFile(originalPath, Buffer.alloc(2048, 1));
    const fs = new NodeFileSystemPort({ workingDirectory: folder, homeDirectory: home });
    const app = createApp(
      { dbDriver: 'memory', workingDirectory: folder, homeDirectory: home, processName: 'gui' },
      (config) => {
        const deps: AppDeps = createInMemoryDeps(config);
        deps.fs = fs;
        deps.globalCatalog = new SqlJsGlobalCatalogStore({ homeDirectory: home, processName: 'gui', lockMode: 'lazy' });
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

      const searchResponse = await app.honoApp.request(`${API_ROUTES.searchQuery.path}?sort=captured_desc`);
      const search = API_ROUTES.searchQuery.output.parse(await responsePayload(searchResponse));

      expect(search.results.map((row) => row.finalName ?? row.fileName)).toContain(path.basename(completed.path));
    } finally {
      await app.dispose();
      await Promise.all([
        rm(home, { recursive: true, force: true }),
        rm(folder, { recursive: true, force: true }),
      ]);
    }
  }, scaledTimeout(30_000));
});
