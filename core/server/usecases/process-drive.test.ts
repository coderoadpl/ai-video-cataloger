import { describe, expect, it } from 'vitest';

import { appError, ok, type AppError, type Result } from '@core/domain/index.js';

import type { AnalysisOutput, AnalyzeInput, DirectoryEntry } from '../ports.js';
import { indexStatus } from './catalog-index.js';
import { discoverCatalogFolders, processDrive, type ProcessDriveInput } from './process-drive.js';
import {
  InMemoryAnalyzer,
  InMemoryCatalogs,
  InMemoryConfig,
  InMemoryFileSystem,
  InMemoryGlobalCatalogStore,
  InMemoryMedia,
  InMemoryTranscriber,
} from '../../../test/server/usecases/test-fakes.js';

const baseInput: ProcessDriveInput = {
  root: '/drive',
  frames: 3,
  skipRename: true,
  skipRenameExplicit: true,
  verbose: false,
  timeout: 120,
  whisper: 'skip',
  whisperExplicit: true,
  whisperModel: 'base',
};

class PathResponseAnalyzer extends InMemoryAnalyzer {
  readonly responses = new Map<string, Array<Result<AnalysisOutput, AppError>>>();

  override analyze(input: AnalyzeInput): Promise<Result<AnalysisOutput, AppError>> {
    this.inputs.push({
      videoPath: input.videoPath,
      framePaths: input.framePaths,
      transcript: input.transcript,
      backend: input.backend,
      localModel: input.localModel,
      timeoutSeconds: input.timeoutSeconds,
      verbose: input.verbose,
    });
    const queue = this.responses.get(input.videoPath);
    const next = queue?.shift();
    if (next !== undefined) return Promise.resolve(next);
    return Promise.resolve(ok({ rawResponse: this.rawResponse }));
  }
}

class ScanFailureFileSystem extends InMemoryFileSystem {
  private badFolderReads = 0;

  override listDirectory(value: string): Promise<Result<DirectoryEntry[], AppError>> {
    if (value === '/drive/bad') {
      this.badFolderReads += 1;
      if (this.badFolderReads > 1) {
        return Promise.resolve({ ok: false, error: appError('read_error', 'Cannot read bad folder') });
      }
    }
    return super.listDirectory(value);
  }
}

const makeDeps = (
  fs = new InMemoryFileSystem('/drive'),
  analyzer = new PathResponseAnalyzer(),
) => ({
  catalogs: new InMemoryCatalogs(),
  config: new InMemoryConfig(),
  fs,
  media: new InMemoryMedia(),
  transcriber: new InMemoryTranscriber(fs),
  analyzer,
  globalCatalog: new InMemoryGlobalCatalogStore(),
});

const addVideo = (fs: InMemoryFileSystem, videoPath: string, hash: string): void => {
  fs.addFile(videoPath, { size: 1024, mtimeMs: new Date('2026-01-01T00:00:00.000Z').getTime(), hash });
};

describe('drive discovery', () => {
  it('finds catalog folders deterministically and skips hidden, system, artifact, and symlink entries', async () => {
    const fs = new InMemoryFileSystem('/drive');
    addVideo(fs, '/drive/root.mp4', 'hash-root');
    addVideo(fs, '/drive/b/clip.mov', 'hash-b');
    addVideo(fs, '/drive/a/clip.mp4', 'hash-a');
    addVideo(fs, '/drive/b/nested/deep.webm', 'hash-deep');
    addVideo(fs, '/drive/.hidden/hidden.mp4', 'hash-hidden');
    addVideo(fs, '/drive/.ai-video-cataloger/artifact.mp4', 'hash-artifact');
    addVideo(fs, '/drive/System Volume Information/system.mp4', 'hash-system');
    fs.addSymlink('/drive/link-to-folder');
    fs.addSymlink('/drive/link-to-video.mp4');

    const result = await discoverCatalogFolders(fs, { root: '/drive' });

    expect(result.ok && result.value.folders.map((folder) => folder.path)).toEqual([
      '/drive',
      '/drive/a',
      '/drive/b',
      '/drive/b/nested',
    ]);
    expect(result.ok && result.value.filesTotal).toBe(4);
  });
});

describe('drive processing', () => {
  it('resumes by fingerprint and performs zero analyzer calls on the second run', async () => {
    const deps = makeDeps();
    addVideo(deps.fs, '/drive/one.mp4', 'hash-one');
    addVideo(deps.fs, '/drive/nested/two.mp4', 'hash-two');

    const first = await processDrive(deps, baseInput, undefined, { runId: 'run-1' });
    const callsAfterFirst = deps.analyzer.inputs.length;
    const second = await processDrive(deps, baseInput, undefined, { runId: 'run-2' });

    expect(first).toMatchObject({ ok: true, value: { filesDone: 2, filesSkipped: 0, filesFailed: 0 } });
    expect(callsAfterFirst).toBe(2);
    expect(second).toMatchObject({ ok: true, value: { filesDone: 0, filesSkipped: 2, filesFailed: 0 } });
    expect(deps.analyzer.inputs).toHaveLength(callsAfterFirst);
  });

  it('does not mark a file missing after it moves to another cataloged folder', async () => {
    const deps = makeDeps();
    addVideo(deps.fs, '/drive/a/clip.mp4', 'hash-clip');
    addVideo(deps.fs, '/drive/a/keep.mp4', 'hash-keep');
    addVideo(deps.fs, '/drive/b/clip.mp4', 'hash-clip');

    await processDrive(deps, baseInput, undefined, { runId: 'run-seed' });
    await deps.fs.deleteFile('/drive/a/clip.mp4');
    const second = await processDrive(deps, baseInput, undefined, { runId: 'run-move' });

    const moved = await deps.globalCatalog.getFile('hash-clip');
    expect(second.ok).toBe(true);
    expect(moved.ok && moved.value?.missingAt).toBe(null);
  });

  it('relocates a resumed file row to the folder it now lives under', async () => {
    const deps = makeDeps();
    addVideo(deps.fs, '/drive/a/clip.mp4', 'hash-clip');
    addVideo(deps.fs, '/drive/a/keep.mp4', 'hash-keep');

    await processDrive(deps, baseInput, undefined, { runId: 'run-seed' });
    await deps.fs.deleteFile('/drive/a/clip.mp4');
    addVideo(deps.fs, '/drive/b/clip.mp4', 'hash-clip');
    const second = await processDrive(deps, baseInput, undefined, { runId: 'run-move' });
    expect(second.ok).toBe(true);

    const folders = await deps.globalCatalog.listFolders();
    const folderB = folders.ok ? folders.value.find((entry) => entry.currentPath === '/drive/b') : undefined;
    const moved = await deps.globalCatalog.getFile('hash-clip');
    expect(folderB).toBeDefined();
    expect(moved.ok && moved.value?.folderId).toBe(folderB?.folderId);
    expect(moved.ok && moved.value?.missingAt).toBe(null);
  });

  it('marks rows missing in a folder that still exists on disk but lost all its videos', async () => {
    const deps = makeDeps();
    addVideo(deps.fs, '/drive/a/clip.mp4', 'hash-clip');
    addVideo(deps.fs, '/drive/keep/other.mp4', 'hash-other');

    await processDrive(deps, baseInput, undefined, { runId: 'run-seed' });
    await deps.fs.deleteFile('/drive/a/clip.mp4');
    const second = await processDrive(deps, baseInput, undefined, { runId: 'run-empty' });
    expect(second.ok).toBe(true);

    const emptied = await deps.globalCatalog.getFile('hash-clip');
    expect(emptied.ok && emptied.value?.missingAt).not.toBe(null);
  });

  it('leaves rows untouched when the folder is gone from disk (offline drive)', async () => {
    const deps = makeDeps();
    addVideo(deps.fs, '/drive/a/clip.mp4', 'hash-clip');
    addVideo(deps.fs, '/drive/keep/other.mp4', 'hash-other');

    await processDrive(deps, baseInput, undefined, { runId: 'run-seed' });
    await deps.fs.renamePath('/drive/a', '/gone/a');
    const second = await processDrive(deps, baseInput, undefined, { runId: 'run-offline' });
    expect(second.ok).toBe(true);

    const offline = await deps.globalCatalog.getFile('hash-clip');
    expect(offline.ok && offline.value?.missingAt).toBe(null);
  });

  it('continues after file and folder failures and persists run counters', async () => {
    const fs = new ScanFailureFileSystem('/drive');
    const analyzer = new PathResponseAnalyzer();
    const deps = makeDeps(fs, analyzer);
    addVideo(fs, '/drive/bad/unreadable.mp4', 'hash-bad-folder');
    addVideo(fs, '/drive/good/bad-analysis.mp4', 'hash-bad-analysis');
    addVideo(fs, '/drive/good/ok.mp4', 'hash-ok');
    analyzer.responses.set('/drive/good/bad-analysis.mp4', [
      ok({ rawResponse: 'DESCRIPTION: missing filename' }),
    ]);

    const result = await processDrive(deps, baseInput, undefined, { runId: 'run-failures' });
    const latest = await deps.globalCatalog.latestDriveRun();
    const status = await indexStatus(deps);

    expect(result).toMatchObject({
      ok: true,
      value: {
        foldersTotal: 2,
        foldersDone: 2,
        filesDone: 1,
        filesFailed: 1,
      },
    });
    expect(result.ok && result.value.failures).toHaveLength(2);
    expect(latest.ok && latest.value).toMatchObject({ runId: 'run-failures', foldersDone: 2, filesDone: 1, filesFailed: 1 });
    expect(status.ok && status.value.latestRun).toMatchObject({ runId: 'run-failures', filesFailed: 1 });
  });

  it('retries transient analyzer failures with fake backoff and aborts after five consecutive failed files', async () => {
    const analyzer = new PathResponseAnalyzer();
    const deps = makeDeps(new InMemoryFileSystem('/drive'), analyzer);
    for (const name of ['one', 'two', 'three', 'four', 'five']) {
      const videoPath = `/drive/${name}.mp4`;
      addVideo(deps.fs, videoPath, `hash-${name}`);
      analyzer.responses.set(videoPath, [
        { ok: false, error: appError('provider_error', 'Analyzer unavailable') },
        { ok: false, error: appError('provider_error', 'Analyzer unavailable') },
        { ok: false, error: appError('provider_error', 'Analyzer unavailable') },
      ]);
    }
    const delays: number[] = [];

    const result = await processDrive(deps, baseInput, undefined, {
      runId: 'run-abort',
      jitter: () => 0,
      sleep: (milliseconds) => {
        delays.push(milliseconds);
        return Promise.resolve();
      },
    });
    const latest = await deps.globalCatalog.latestDriveRun();

    expect(result).toMatchObject({ ok: false, error: { code: 'drive_run_aborted' } });
    expect(delays.slice(0, 2)).toEqual([5000, 10000]);
    expect(delays).toHaveLength(10);
    expect(latest.ok && latest.value).toMatchObject({
      runId: 'run-abort',
      finishedAt: null,
      filesFailed: 5,
    });
  });
});
