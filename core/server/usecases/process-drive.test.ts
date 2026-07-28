import { describe, expect, it } from 'vitest';

import {
  appError,
  defaultGeminiNativeProvider,
  geminiUsageAccounting,
  ok,
  type AppError,
  type Result,
} from '@core/domain/index.js';

import type { AnalysisOutput, AnalyzeInput, DirectoryEntry } from '../ports.js';
import { folderCatalogRecords, indexStatus } from './catalog-index.js';
import { catalogTreeAbsentFiles, scanTreeFolderDetails } from './catalog-tree.js';
import { discoverCatalogFolders, processDrive, shouldRelocateCanonical, type ProcessDriveInput } from './process-drive.js';
import type { CatalogFolder } from '@core/domain/index.js';
import {
  InMemoryAnalyzer,
  InMemoryCatalogs,
  InMemoryConfig,
  InMemoryFileSystem,
  InMemoryGlobalCatalogStore,
  InMemoryMedia,
  InMemorySpendLedger,
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

class DiscoveryFailureFileSystem extends InMemoryFileSystem {
  failPath: string | null = null;

  override listDirectory(value: string): Promise<Result<DirectoryEntry[], AppError>> {
    if (this.failPath !== null && value === this.failPath) {
      return Promise.resolve({ ok: false, error: appError('read_error', 'Cannot read folder') });
    }
    return super.listDirectory(value);
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
  spendLedger: new InMemorySpendLedger(),
});

const addVideo = (fs: InMemoryFileSystem, videoPath: string, hash: string): void => {
  fs.addFile(videoPath, { size: 1024, mtimeMs: new Date('2026-01-01T00:00:00.000Z').getTime(), hash });
};

const folderAt = (currentPath: string, firstSeenAt: string): CatalogFolder => ({
  folderId: `id-${currentPath}`,
  currentPath,
  displayName: currentPath,
  firstSeenAt,
  lastSeenAt: firstSeenAt,
});

describe('shouldRelocateCanonical', () => {
  it('does not adopt a sorting-earlier sibling clone while the recorded location is present', () => {
    const recorded = folderAt('/drive/originals', '2026-01-01T00:00:00.000Z');
    const siblingClone = folderAt('/drive/aaa-clone', '2026-02-01T00:00:00.000Z');

    expect(shouldRelocateCanonical(siblingClone, recorded, true)).toBe(false);
  });

  it('prefers the earliest-first-seen present copy for a damaged-state repair', () => {
    const earliest = folderAt('/drive/early', '2026-01-01T00:00:00.000Z');
    const laterRecorded = folderAt('/drive/late', '2026-03-01T00:00:00.000Z');

    expect(shouldRelocateCanonical(earliest, laterRecorded, true)).toBe(true);
    expect(shouldRelocateCanonical(laterRecorded, earliest, true)).toBe(false);
  });

  it('relocates onto the present copy when the recorded location is absent', () => {
    const recordedGone = folderAt('/drive/gone', '2026-01-01T00:00:00.000Z');
    const presentNewer = folderAt('/drive/moved', '2026-05-01T00:00:00.000Z');

    expect(shouldRelocateCanonical(presentNewer, recordedGone, false)).toBe(true);
    expect(shouldRelocateCanonical(presentNewer, null, false)).toBe(true);
  });
});

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
    expect(first.ok && first.value.costEstimate).toBeUndefined();
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

  it('keeps the canonical row and leaves a byte-identical clone a duplicate after a tree run', async () => {
    const deps = makeDeps();
    addVideo(deps.fs, '/drive/root.mp4', 'hash-x');
    addVideo(deps.fs, '/drive/sub/clone.mp4', 'hash-x');

    const run = await processDrive(deps, baseInput, undefined, { runId: 'run-tree' });
    expect(run.ok).toBe(true);

    const folders = await deps.globalCatalog.listFolders();
    const rootFolder = folders.ok ? folders.value.find((entry) => entry.currentPath === '/drive') : undefined;
    const row = await deps.globalCatalog.getFile('hash-x');
    expect(rootFolder).toBeDefined();
    expect(row.ok && row.value?.folderId).toBe(rootFolder?.folderId);
    expect(row.ok && row.value?.fileName).toBe('root.mp4');

    const cloneDetails = await scanTreeFolderDetails(deps, { folder: '/drive/sub' });
    const clone = cloneDetails.ok ? cloneDetails.value.videos.find((video) => video.filename === 'clone.mp4') : undefined;
    expect(clone?.duplicate?.canonicalPath).toBe('/drive/root.mp4');
  });

  it('does not churn the canonical to a byte-identical clone whose folder is still present', async () => {
    const deps = makeDeps();
    addVideo(deps.fs, '/drive/root.mp4', 'hash-x');
    addVideo(deps.fs, '/drive/sub/clone.mp4', 'hash-x');

    await processDrive(deps, baseInput, undefined, { runId: 'run-seed' });
    const folders = await deps.globalCatalog.listFolders();
    const subFolder = folders.ok ? folders.value.find((entry) => entry.currentPath === '/drive/sub') : undefined;
    expect(subFolder).toBeDefined();
    await deps.globalCatalog.relocateFile('hash-x', subFolder?.folderId ?? '', 'clone.mp4');

    const repair = await processDrive(deps, baseInput, undefined, { runId: 'run-repair' });
    expect(repair.ok).toBe(true);

    const row = await deps.globalCatalog.getFile('hash-x');
    expect(row.ok && row.value?.folderId).toBe(subFolder?.folderId);
    expect(row.ok && row.value?.fileName).toBe('clone.mp4');
  });

  it('marks a deleted processed file missing so the absent-files section can list it', async () => {
    const deps = makeDeps();
    addVideo(deps.fs, '/drive/a/keep.mp4', 'hash-keep');
    addVideo(deps.fs, '/drive/a/gone.mp4', 'hash-gone');

    await processDrive(deps, baseInput, undefined, { runId: 'run-seed' });
    await deps.fs.deleteFile('/drive/a/gone.mp4');
    const second = await processDrive(deps, baseInput, undefined, { runId: 'run-missing' });
    expect(second.ok).toBe(true);

    const records = await folderCatalogRecords(deps, { folder: '/drive/a' });
    const gone = records.ok ? records.value.records.find((record) => record.fileName === 'gone.mp4') : undefined;
    const keep = records.ok ? records.value.records.find((record) => record.fileName === 'keep.mp4') : undefined;
    expect(gone?.missing).toBe(true);
    expect(keep?.missing).toBe(false);
  });

  it('clears the absent flag after a deleted file is restored to disk, without another drive run', async () => {
    const deps = makeDeps();
    addVideo(deps.fs, '/drive/a/keep.mp4', 'hash-keep');
    addVideo(deps.fs, '/drive/a/gone.mp4', 'hash-gone');

    await processDrive(deps, baseInput, undefined, { runId: 'run-seed' });
    await deps.fs.deleteFile('/drive/a/gone.mp4');
    await processDrive(deps, baseInput, undefined, { runId: 'run-missing' });
    const marked = await deps.globalCatalog.getFile('hash-gone');
    expect(marked.ok && marked.value?.missingAt).not.toBe(null);

    addVideo(deps.fs, '/drive/a/gone.mp4', 'hash-gone');
    const absent = await catalogTreeAbsentFiles(deps, { folder: '/drive' });

    const restored = await deps.globalCatalog.getFile('hash-gone');
    expect(restored.ok && restored.value?.missingAt).toBe(null);
    expect(absent.ok && absent.value.groups).toEqual([]);
  });

  it('clears the absent flag through the flat folder records view, without a tree fetch', async () => {
    const deps = makeDeps();
    addVideo(deps.fs, '/drive/a/keep.mp4', 'hash-keep');
    addVideo(deps.fs, '/drive/a/gone.mp4', 'hash-gone');

    await processDrive(deps, baseInput, undefined, { runId: 'run-seed' });
    await deps.fs.deleteFile('/drive/a/gone.mp4');
    await processDrive(deps, baseInput, undefined, { runId: 'run-missing' });

    addVideo(deps.fs, '/drive/a/gone.mp4', 'hash-gone');
    const records = await folderCatalogRecords(deps, { folder: '/drive/a' });

    const restored = await deps.globalCatalog.getFile('hash-gone');
    expect(restored.ok && restored.value?.missingAt).toBe(null);
    const gone = records.ok ? records.value.records.find((record) => record.fileName === 'gone.mp4') : undefined;
    expect(gone?.missing).toBe(false);
    expect(gone?.missingAt).toBe(null);
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

  it('does not mark files missing in a folder that failed discovery but still exists on disk', async () => {
    const fs = new DiscoveryFailureFileSystem('/drive');
    const deps = makeDeps(fs);
    addVideo(fs, '/drive/a/clip.mp4', 'hash-clip');
    addVideo(fs, '/drive/keep/other.mp4', 'hash-other');

    await processDrive(deps, baseInput, undefined, { runId: 'run-seed' });
    fs.failPath = '/drive/a';
    const second = await processDrive(deps, baseInput, undefined, { runId: 'run-unreadable' });
    expect(second.ok).toBe(true);

    const preserved = await deps.globalCatalog.getFile('hash-clip');
    expect(preserved.ok && preserved.value?.missingAt).toBe(null);
  });

  it('refreshes snapshots of both the source and destination folder after a relocation', async () => {
    const deps = makeDeps();
    addVideo(deps.fs, '/drive/a/clip.mp4', 'hash-clip');
    addVideo(deps.fs, '/drive/a/keep.mp4', 'hash-keep');

    await processDrive(deps, baseInput, undefined, { runId: 'run-seed' });
    await deps.fs.deleteFile('/drive/a/clip.mp4');
    addVideo(deps.fs, '/drive/b/clip.mp4', 'hash-clip');
    const second = await processDrive(deps, baseInput, undefined, { runId: 'run-move' });
    expect(second.ok).toBe(true);

    const sourceSnapshot = await deps.fs.readTextFile('/drive/a/.ai-video-cataloger/catalog.ndjson');
    const destSnapshot = await deps.fs.readTextFile('/drive/b/.ai-video-cataloger/catalog.ndjson');
    expect(sourceSnapshot.ok && (sourceSnapshot.value ?? '').includes('hash-clip')).toBe(false);
    expect(destSnapshot.ok && (destSnapshot.value ?? '').includes('hash-clip')).toBe(true);
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

  it('pauses at the local Gemini budget and resumes after the cap is raised', async () => {
    const analyzer = new PathResponseAnalyzer();
    const deps = makeDeps(new InMemoryFileSystem('/drive'), analyzer);
    addVideo(deps.fs, '/drive/one.mp4', 'hash-one');
    addVideo(deps.fs, '/drive/two.mp4', 'hash-two');
    await deps.config.set(
      { kind: 'home' },
      'analyzer_provider',
      JSON.stringify(defaultGeminiNativeProvider('gemini-3.6-flash')),
    );
    await deps.config.set({ kind: 'home' }, 'gemini_monthly_budget_usd', '0.001');
    analyzer.responses.set('/drive/one.mp4', [ok({
      rawResponse: 'DESCRIPTION: one\nFILENAME: one',
      usage: geminiUsageAccounting(
        { promptTokens: 1000, candidatesTokens: 0, thoughtsTokens: 0 },
        'gemini-3.6-flash',
      ),
    })]);
    const events: string[] = [];

    const paused = await processDrive(deps, baseInput, {
      signal: new AbortController().signal,
      reportProgress: (event) => {
        events.push(event.step);
        return Promise.resolve(ok(undefined));
      },
    }, { runId: 'run-budget' });

    expect(paused).toMatchObject({
      ok: false,
      error: {
        code: 'drive_run_aborted',
        details: { runId: 'run-budget', budgetUsd: 0.001, estimatedSpendUsd: 0.0015 },
      },
    });
    expect(events).toContain('budget_cap_reached');
    expect(deps.spendLedger.entries).toHaveLength(1);

    await deps.config.set({ kind: 'home' }, 'gemini_monthly_budget_usd', '1');
    analyzer.responses.set('/drive/two.mp4', [ok({
      rawResponse: 'DESCRIPTION: two\nFILENAME: two',
      usage: geminiUsageAccounting(
        { promptTokens: 1000, candidatesTokens: 0, thoughtsTokens: 0 },
        'gemini-3.6-flash',
      ),
    })]);
    const resumed = await processDrive(deps, baseInput, undefined, { runId: 'run-budget-resumed' });

    expect(resumed).toMatchObject({ ok: true, value: { filesDone: 1, filesSkipped: 1 } });
  });
});
