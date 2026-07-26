import { chmod, cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ok, type AppError, type Result } from '@core/domain/index.js';
import { searchOutputSchema } from '@core/contract/index.js';
import {
  processDrive,
  scanFolder,
  search,
  type AnalysisOutput,
  type AnalyzerPort,
  type DependencyStatus,
  type JobProgress,
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

  analyze(): Promise<Result<AnalysisOutput, AppError>> {
    this.calls += 1;
    return Promise.resolve(ok({ rawResponse: analyzerResponse }));
  }

  dependency(): Promise<Result<DependencyStatus, AppError>> {
    return Promise.resolve(ok(available('stub-analyzer')));
  }
}

class UnusedTranscriber implements TranscriberPort {
  transcribe(): Promise<Result<{ transcriptPath: string; content: string }, AppError>> {
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

describe('drive run over a write-protected folder with the real adapter stack', () => {
  const restricted: string[] = [];
  const roots: string[] = [];

  afterEach(async () => {
    for (const directory of restricted) await chmod(directory, 0o755);
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    restricted.length = 0;
    roots.length = 0;
  });

  const scaffold = async (): Promise<{ home: string; root: string; folder: string; deps: ProcessDeps; analyzer: StubAnalyzer }> => {
    const base = await mkdtemp(path.join(tmpdir(), 'avc-ro-drive-'));
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
    return {
      home,
      root,
      folder,
      analyzer,
      deps: {
        catalogs: new SqlJsCatalogRepositoryFactory(),
        config: new JsonConfigStore({ homeDirectory: home }),
        fs: new NodeFileSystemPort({ workingDirectory: root, homeDirectory: home }),
        media: new FfmpegMediaAdapter(),
        transcriber: new UnusedTranscriber(),
        analyzer,
        globalCatalog: new SqlJsGlobalCatalogStore({ homeDirectory: home }),
      },
    };
  };

  const mirrorDirectory = async (home: string): Promise<string> => {
    const mirrorRoot = path.join(home, '.ai-video-cataloger', 'read-only-folders');
    const entries = await readdir(mirrorRoot);
    expect(entries).toHaveLength(1);
    return path.join(mirrorRoot, entries[0] ?? '');
  };

  it('completes the file index-only, warns per file, and leaves the folder untouched', async () => {
    const { home, root, folder, deps } = await scaffold();
    const events: JobProgress[] = [];
    const progress = {
      signal: new AbortController().signal,
      reportProgress: (event: JobProgress): Promise<Result<void, AppError>> => {
        events.push(event);
        return Promise.resolve(ok(undefined));
      },
    };

    const run = await processDrive(deps, driveInput(root), progress);
    if (!run.ok) throw new Error(`${run.error.code}: ${run.error.message}`);

    expect(run.value.filesDone).toBe(1);
    expect(run.value.filesFailed).toBe(0);
    expect(run.value.snapshotSkipped).toBe(1);
    expect(run.value.failures).toEqual([]);
    expect(events.filter((event) => event.step === 'catalog_snapshot_skipped')).toHaveLength(1);

    expect(await readdir(folder)).toEqual(['clip.mp4']);

    const mirror = await mirrorDirectory(home);
    expect(await readdir(path.join(mirror, 'frames', 'clip'))).toEqual(['frame-001.jpg']);
    expect(await readdir(path.join(mirror, 'summaries'))).toContain('clip.json');

    const counts = await deps.globalCatalog?.counts();
    expect(counts?.ok === true && counts.value).toMatchObject({ folders: 1, files: 1, analyses: 1 });
  }, 60000);

  it('resumes by fingerprint on a second pass without re-analyzing', async () => {
    const { root, deps, analyzer } = await scaffold();

    const first = await processDrive(deps, driveInput(root));
    if (!first.ok) throw new Error(first.error.message);
    const second = await processDrive(deps, driveInput(root));
    if (!second.ok) throw new Error(second.error.message);

    expect(first.value.filesDone).toBe(1);
    expect(second.value.filesDone).toBe(0);
    expect(second.value.filesSkipped).toBe(1);
    expect(second.value.filesFailed).toBe(0);
    expect(analyzer.calls).toBe(1);
  }, 60000);

  it('serves the hit through the search contract and resolves its details', async () => {
    const { root, folder, deps } = await scaffold();

    const run = await processDrive(deps, driveInput(root));
    if (!run.ok) throw new Error(run.error.message);

    const globalCatalog = deps.globalCatalog;
    if (globalCatalog === undefined) throw new Error('missing global catalog');
    const found = await search({ globalCatalog, fs: deps.fs }, { query: 'rabbit', limit: 50, offset: 0 });
    if (!found.ok) throw new Error(found.error.message);

    const parsed = searchOutputSchema.safeParse(found.value);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
    const hit = found.value.results[0];
    expect(hit?.folder.folderId).toMatch(/^path-[0-9a-f]{8}$/);
    expect(hit?.folder.currentPath).toBe(folder);

    const details = await scanFolder({ catalogs: deps.catalogs, fs: deps.fs, media: deps.media }, { folder });
    if (!details.ok) throw new Error(details.error.message);
    const detail = details.value.videos.find((video) => video.filename === 'clip.mp4');
    expect(detail?.artifacts.summary?.description).toContain('rabbit');
    expect(detail?.status).toBe('completed');
  }, 60000);
});
