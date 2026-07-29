import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat, truncate, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ok, type AppError, type Result } from '@core/domain/index.js';
import {
  generateThumbnail,
  processVideoPipeline,
  type AnalysisOutput,
  type AnalyzerPort,
  type DependencyStatus,
  type ProcessDeps,
  type TranscriberPort,
} from '@core/server/index.js';
import { folderArtifactRoot } from '@core/server/usecases/artifact-root.js';
import { thumbnailArtifactPath } from '@core/server/usecases/shared.js';
import { SqlJsCatalogRepositoryFactory, JsonConfigStore } from '@adapters/db/sql-js.js';
import { SqlJsGlobalCatalogStore } from '@adapters/db/global-catalog.js';
import { FfmpegMediaAdapter, resolveFfmpegBinaries } from '@adapters/ffmpeg/index.js';
import { NodeFileSystemPort } from '@adapters/fs/index.js';
import { scaledTimeout } from '../../../test/helpers/gate-timeout.js';

const analyzerResponse = [
  'DESCRIPTION: A rabbit wakes up in a meadow.',
  'FILENAME: rabbit-meadow',
  'TAGS: animation, outdoors',
].join('\n');

class StubAnalyzer implements AnalyzerPort {
  promptVersion(): number {
    return 1;
  }

  analyze(): Promise<Result<AnalysisOutput, AppError>> {
    return Promise.resolve(ok({ rawResponse: analyzerResponse }));
  }

  dependency(): Promise<Result<DependencyStatus, AppError>> {
    return Promise.resolve(ok(available('stub-analyzer')));
  }
}

class UnusedTranscriber implements TranscriberPort {
  transcribe(): ReturnType<TranscriberPort['transcribe']> {
    return Promise.resolve({ ok: false, error: { code: 'internal', message: 'transcription is skipped' } });
  }

  dependency(): Promise<Result<DependencyStatus, AppError>> {
    return Promise.resolve(ok(available('stub-whisper')));
  }
}

const available = (name: string): DependencyStatus => ({
  name,
  available: true,
  version: null,
  source: 'bundled',
  path: null,
  installHint: '',
});

const realBinaries = await resolveFfmpegBinaries();
const canRunRealBinaries = realBinaries.ffmpeg.available && realBinaries.ffprobe.available;
const sample = path.resolve('test/BigBuckBunny480p30s.mp4');

const probeDimensions = (imagePath: string): { width: number; height: number } => {
  const csv = execFileSync(realBinaries.ffprobe.path, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0',
    imagePath,
  ]).toString().trim();
  const [width, height] = csv.split(',').map((value) => Number.parseInt(value, 10));
  return { width: width ?? 0, height: height ?? 0 };
};

describe.skipIf(!canRunRealBinaries)('thumbnail generation from the stored analysis frame with the real adapter stack', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots.length = 0;
  });

  const scaffold = async (): Promise<{ home: string; folder: string; finalPath: string; deps: ProcessDeps }> => {
    const base = await mkdtemp(path.join(tmpdir(), 'avc-thumb-frame-'));
    roots.push(base);
    const home = path.join(base, 'home');
    const folder = path.join(base, 'clips');
    await mkdir(home, { recursive: true });
    await mkdir(folder, { recursive: true });
    const videoPath = path.join(folder, 'clip.mp4');
    execFileSync(realBinaries.ffmpeg.path, ['-y', '-v', 'error', '-i', sample, '-c', 'copy', videoPath]);
    const deps: ProcessDeps = {
      catalogs: new SqlJsCatalogRepositoryFactory(),
      config: new JsonConfigStore({ homeDirectory: home }),
      fs: new NodeFileSystemPort({ workingDirectory: folder, homeDirectory: home }),
      media: new FfmpegMediaAdapter(),
      transcriber: new UnusedTranscriber(),
      analyzer: new StubAnalyzer(),
      globalCatalog: new SqlJsGlobalCatalogStore({ homeDirectory: home }),
    };
    const result = await processVideoPipeline(deps, {
      videoPath,
      frames: 3,
      framesExplicit: true,
      skipRename: true,
      skipRenameExplicit: true,
      verbose: false,
      timeout: 120,
      whisper: 'skip',
      whisperExplicit: true,
      whisperModel: 'base',
    });
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return { home, folder, finalPath: result.value.path, deps };
  };

  it('writes a real cover during the run from the stored analysis frame', async () => {
    const { folder, finalPath } = await scaffold();
    const fs = new NodeFileSystemPort({ workingDirectory: folder });
    const root = folderArtifactRoot(fs, folder);
    const thumbnailPath = thumbnailArtifactPath(fs, root, finalPath);

    const stats = await stat(thumbnailPath);
    expect(stats.size).toBeGreaterThan(0);
    const dims = probeDimensions(thumbnailPath);
    expect(dims.width).toBeLessThanOrEqual(128);
    expect(dims.height).toBeLessThanOrEqual(72);
    expect(dims.width % 2).toBe(0);
    expect(dims.height % 2).toBe(0);
  }, scaledTimeout(60000));

  it('regenerates the cover from the stored frame even when the source video is truncated to 0 bytes', async () => {
    const { folder, finalPath, deps } = await scaffold();
    const fs = new NodeFileSystemPort({ workingDirectory: folder });
    const root = folderArtifactRoot(fs, folder);
    const thumbnailPath = thumbnailArtifactPath(fs, root, finalPath);

    await unlink(thumbnailPath);
    await truncate(finalPath, 0);

    const regenerated = await generateThumbnail(deps, { videoPath: finalPath, force: true });

    if (!regenerated.ok) throw new Error(`${regenerated.error.code}: ${regenerated.error.message}`);
    expect(regenerated.value.thumbnailPath).toBe(thumbnailPath);
    expect(regenerated.value.generated).toBe(true);
    const stats = await stat(thumbnailPath);
    expect(stats.size).toBeGreaterThan(0);
    const dims = probeDimensions(thumbnailPath);
    expect(dims.width).toBeLessThanOrEqual(128);
    expect(dims.height).toBeLessThanOrEqual(72);
  }, scaledTimeout(60000));

  it('reports skipped without touching the file when force is false and a cover already exists', async () => {
    const { folder, finalPath, deps } = await scaffold();
    const fs = new NodeFileSystemPort({ workingDirectory: folder });
    const root = folderArtifactRoot(fs, folder);
    const thumbnailPath = thumbnailArtifactPath(fs, root, finalPath);
    const before = await stat(thumbnailPath);

    const result = await generateThumbnail(deps, { videoPath: finalPath, force: false });

    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    expect(result.value).toMatchObject({ generated: false, skipped: true });
    const after = await stat(thumbnailPath);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  }, scaledTimeout(60000));
});
