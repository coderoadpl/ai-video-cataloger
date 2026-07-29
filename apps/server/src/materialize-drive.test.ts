import { chmod, cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ok, type AppError, type Result } from '@core/domain/index.js';
import {
  materializeCatalog,
  processDrive,
  scanFolder,
  type AnalysisOutput,
  type AnalyzerPort,
  type DependencyStatus,
  type JobProgress,
  type MaterializeDeps,
  type ProcessDeps,
  type ProcessDriveInput,
  type TranscriberPort,
} from '@core/server/index.js';
import { SqlJsCatalogRepositoryFactory, JsonConfigStore } from '@adapters/db/sql-js.js';
import { SqlJsGlobalCatalogStore } from '@adapters/db/global-catalog.js';
import { FfmpegMediaAdapter } from '@adapters/ffmpeg/index.js';
import { NodeFileSystemPort } from '@adapters/fs/index.js';

const analyzerResponse = [
  'DESCRIPTION: A rabbit wakes up in a meadow.',
  'FILENAME: rabbit-meadow',
  'TAGS: animation, outdoors',
].join('\n');

class StubAnalyzer implements AnalyzerPort {
  calls = 0;

  promptVersion(): number {
    return 1;
  }

  analyze(): Promise<Result<AnalysisOutput, AppError>> {
    this.calls += 1;
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

const driveInput = (root: string): ProcessDriveInput => ({
  root,
  frames: 1,
  framesExplicit: true,
  skipRename: false,
  verbose: false,
  timeout: 120,
  whisper: 'skip',
  whisperExplicit: true,
  whisperModel: 'base',
});

describe('materialize over a folder analysed read-only, with the real adapter stack', () => {
  const restricted: string[] = [];
  const roots: string[] = [];

  afterEach(async () => {
    for (const directory of restricted) await chmod(directory, 0o755);
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    restricted.length = 0;
    roots.length = 0;
  });

  const scaffold = async (): Promise<{ home: string; root: string; folder: string; deps: ProcessDeps; materializeDeps: MaterializeDeps; analyzer: StubAnalyzer }> => {
    const base = await mkdtemp(path.join(tmpdir(), 'avc-materialize-drive-'));
    roots.push(base);
    const home = path.join(base, 'home');
    const root = path.join(base, 'drive');
    const folder = path.join(root, 'clips');
    await mkdir(home, { recursive: true });
    await mkdir(folder, { recursive: true });
    await cp(path.resolve('test/BigBuckBunny480p30s.mp4'), path.join(folder, 'clip.mp4'));
    await chmod(folder, 0o555);
    restricted.push(folder);
    const analyzer = new StubAnalyzer();
    const fs = new NodeFileSystemPort({ workingDirectory: root, homeDirectory: home });
    const globalCatalog = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    return {
      home,
      root,
      folder,
      analyzer,
      deps: {
        catalogs: new SqlJsCatalogRepositoryFactory(),
        config: new JsonConfigStore({ homeDirectory: home }),
        fs,
        media: new FfmpegMediaAdapter(),
        transcriber: new UnusedTranscriber(),
        analyzer,
        globalCatalog,
      },
      materializeDeps: { fs, globalCatalog },
    };
  };

  it('refuses to apply while the target is still mounted read-only', async () => {
    const { root, folder, deps, materializeDeps } = await scaffold();

    const indexed = await processDrive(deps, driveInput(root));
    if (!indexed.ok) throw new Error(indexed.error.message);

    const attempted = await materializeCatalog(materializeDeps, { root, dryRun: false });

    expect(attempted).toMatchObject({ ok: false, error: { code: 'target_read_only' } });
    expect(await readdir(folder)).toEqual(['clip.mp4']);
  }, 60000);

  it('applies the catalog once the mount becomes writable, never re-analyzing, and survives the reachability sweep', async () => {
    const { root, folder, deps, materializeDeps, analyzer } = await scaffold();

    const indexed = await processDrive(deps, driveInput(root));
    if (!indexed.ok) throw new Error(indexed.error.message);
    expect(analyzer.calls).toBe(1);

    await chmod(folder, 0o755);
    const restrictedIndex = restricted.indexOf(folder);
    if (restrictedIndex !== -1) restricted.splice(restrictedIndex, 1);

    const events: JobProgress[] = [];
    const progress = {
      signal: new AbortController().signal,
      reportProgress: (event: JobProgress): Promise<Result<void, AppError>> => {
        events.push(event);
        return Promise.resolve(ok(undefined));
      },
    };
    const materialized = await materializeCatalog(materializeDeps, { root, dryRun: false }, progress);
    if (!materialized.ok) throw new Error(`${materialized.error.code}: ${materialized.error.message}`);

    expect(materialized.value).toMatchObject({ filesMaterialized: 1, filesFailed: 0 });
    expect(events.some((event) => event.step === 'materialize_file')).toBe(true);

    const entries = await readdir(folder);
    const renamed = entries.find((entry) => /^\d{4}-\d{2}-\d{2}_rabbit-meadow\.mp4$/.test(entry));
    expect(renamed).toBeDefined();
    expect(await readdir(path.join(folder, '.ai-video-cataloger'))).toEqual(expect.arrayContaining(['folder-id', 'catalog.ndjson']));
    expect(await readdir(path.join(folder, '.ai-video-cataloger'))).not.toContain('catalog.db');

    const globalCatalog = deps.globalCatalog;
    if (globalCatalog === undefined) throw new Error('missing global catalog');
    const counts = await globalCatalog.counts();
    expect(counts.ok === true && counts.value).toMatchObject({ files: 1, analyses: 1 });

    const secondDrive = await processDrive(deps, driveInput(root));
    if (!secondDrive.ok) throw new Error(secondDrive.error.message);
    expect(secondDrive.value).toMatchObject({ filesDone: 0, filesSkipped: 1, filesFailed: 0 });
    expect(analyzer.calls).toBe(1);

    const scanned = await scanFolder({ catalogs: deps.catalogs, fs: deps.fs, media: deps.media, globalCatalog }, { folder });
    if (!scanned.ok) throw new Error(scanned.error.message);
    const detail = scanned.value.videos.find((video) => video.filename === renamed);
    expect(detail?.status).toBe('completed');
    expect(detail?.duplicate).toBeUndefined();

    const secondMaterialize = await materializeCatalog(materializeDeps, { root, dryRun: false });
    if (!secondMaterialize.ok) throw new Error(`${secondMaterialize.error.code}: ${secondMaterialize.error.message}`);
    expect(secondMaterialize.value).toMatchObject({ filesMaterialized: 0, filesUnchanged: 1, filesFailed: 0 });
    expect((await readdir(folder)).sort()).toEqual(entries.sort());

    const countsAfterSweep = await globalCatalog.counts();
    expect(countsAfterSweep.ok === true && countsAfterSweep.value).toMatchObject({ files: 1, analyses: 1 });
  }, 120000);
});
