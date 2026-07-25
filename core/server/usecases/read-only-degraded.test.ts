import { describe, expect, it } from 'vitest';

import { appError, ok, type AppError, type Result } from '@core/domain/index.js';

import type { JobProgress } from '../ports.js';
import { isReadOnlyWriteError, readFolderMarker, resolveFolderIdentity } from './folder-identity.js';
import { processDrive, type ProcessDriveInput } from './process-drive.js';
import {
  InMemoryAnalyzer,
  InMemoryCatalogs,
  InMemoryConfig,
  InMemoryFileSystem,
  InMemoryGlobalCatalogStore,
  InMemoryMedia,
  InMemoryTranscriber,
} from '../../../test/server/usecases/test-fakes.js';

const eaccesError = (message: string): AppError => {
  const cause = Object.assign(new Error(message), { code: 'EACCES' });
  return appError('internal', message, cause);
};

class ReadOnlyCatalogFileSystem extends InMemoryFileSystem {
  constructor(
    private readonly readOnlyFolder: string,
    workingDirectory = '/drive',
  ) {
    super(workingDirectory);
  }

  private isBlocked(target: string): boolean {
    return this.resolve(target).startsWith(this.resolve(`${this.readOnlyFolder}/.ai-video-cataloger`));
  }

  override writeTextFile(value: string, content: string): Promise<Result<void, AppError>> {
    if (this.isBlocked(value)) return Promise.resolve({ ok: false, error: eaccesError(`EACCES: ${value}`) });
    return super.writeTextFile(value, content);
  }

  override ensureDirectory(value: string): Promise<Result<void, AppError>> {
    if (this.isBlocked(value)) return Promise.resolve({ ok: false, error: eaccesError(`EACCES: ${value}`) });
    return super.ensureDirectory(value);
  }

  override renamePath(from: string, to: string): Promise<Result<void, AppError>> {
    if (this.isBlocked(to)) return Promise.resolve({ ok: false, error: eaccesError(`EACCES: ${to}`) });
    return super.renamePath(from, to);
  }
}

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

const makeDeps = (fs: InMemoryFileSystem) => ({
  catalogs: new InMemoryCatalogs(),
  config: new InMemoryConfig(),
  fs,
  media: new InMemoryMedia(),
  transcriber: new InMemoryTranscriber(fs),
  analyzer: new InMemoryAnalyzer(),
  globalCatalog: new InMemoryGlobalCatalogStore(),
});

const recordingProgress = (events: JobProgress[]) => ({
  signal: new AbortController().signal,
  reportProgress: (progress: JobProgress): Promise<Result<void, AppError>> => {
    events.push(progress);
    return Promise.resolve(ok(undefined));
  },
});

describe('read-only write classification', () => {
  it('recognizes EACCES and EROFS errno causes', () => {
    expect(isReadOnlyWriteError(eaccesError('denied'))).toBe(true);
    const erofs = appError('internal', 'read-only', Object.assign(new Error('ro'), { code: 'EROFS' }));
    expect(isReadOnlyWriteError(erofs)).toBe(true);
  });

  it('does not treat unrelated failures as read-only', () => {
    expect(isReadOnlyWriteError(appError('internal', 'boom'))).toBe(false);
    expect(isReadOnlyWriteError(appError('read_error', 'disk', new Error('ENOSPC')))).toBe(false);
  });
});

describe('resolveFolderIdentity', () => {
  it('falls back to a stable path-derived identity when the marker cannot be written', async () => {
    const fs = new ReadOnlyCatalogFileSystem('/drive/ro');
    const first = await resolveFolderIdentity(fs, '/drive/ro');
    const second = await resolveFolderIdentity(fs, '/drive/ro');

    expect(first.ok && first.value.persistent).toBe(false);
    const firstId = first.ok ? first.value.folderId : null;
    const secondId = second.ok ? second.value.folderId : null;
    expect(firstId).not.toBeNull();
    expect(firstId).toBe(secondId);
    const marker = await readFolderMarker(fs, '/drive/ro');
    expect(marker.ok && marker.value).toBe(null);
  });

  it('persists a marker for a writable folder', async () => {
    const fs = new InMemoryFileSystem('/drive');
    const identity = await resolveFolderIdentity(fs, '/drive/rw');
    expect(identity.ok && identity.value.persistent).toBe(true);
  });
});

describe('drive processing over a read-only folder', () => {
  it('completes the file with a snapshot-skipped warning and records the analysis in the global catalog', async () => {
    const fs = new ReadOnlyCatalogFileSystem('/drive/ro');
    fs.addFile('/drive/ro/clip.mp4', { size: 1024, mtimeMs: 0, hash: 'hash-ro' });
    const deps = makeDeps(fs);
    const events: JobProgress[] = [];

    const run = await processDrive(deps, baseInput, recordingProgress(events), { runId: 'run-ro' });

    expect(run.ok).toBe(true);
    expect(run.ok && run.value.filesDone).toBe(1);
    expect(run.ok && run.value.filesFailed).toBe(0);
    expect(run.ok && run.value.snapshotSkipped).toBe(1);
    expect(events.some((event) => event.step === 'catalog_snapshot_skipped')).toBe(true);

    const analysis = await deps.globalCatalog.getAnalysis('hash-ro');
    expect(analysis.ok && analysis.value !== null).toBe(true);
    const marker = await readFolderMarker(fs, '/drive/ro');
    expect(marker.ok && marker.value).toBe(null);
  });

  it('does not trip the consecutive-failure abort across several read-only files', async () => {
    const fs = new ReadOnlyCatalogFileSystem('/drive/ro');
    for (let index = 0; index < 6; index += 1) {
      fs.addFile(`/drive/ro/clip-${String(index)}.mp4`, { size: 1024, mtimeMs: 0, hash: `hash-${String(index)}` });
    }
    const deps = makeDeps(fs);

    const run = await processDrive(deps, baseInput, undefined, { runId: 'run-many' });

    expect(run.ok).toBe(true);
    expect(run.ok && run.value.filesFailed).toBe(0);
    expect(run.ok && run.value.filesDone).toBe(6);
    expect(run.ok && run.value.snapshotSkipped).toBe(6);
  });

  it('skips by fingerprint on a second run without a local marker', async () => {
    const fs = new ReadOnlyCatalogFileSystem('/drive/ro');
    fs.addFile('/drive/ro/clip.mp4', { size: 1024, mtimeMs: 0, hash: 'hash-ro' });
    const deps = makeDeps(fs);

    const first = await processDrive(deps, baseInput, undefined, { runId: 'run-1' });
    const analyzerCallsAfterFirst = deps.analyzer.inputs.length;
    const second = await processDrive(deps, baseInput, undefined, { runId: 'run-2' });

    expect(first.ok && first.value.filesDone).toBe(1);
    expect(analyzerCallsAfterFirst).toBe(1);
    expect(second.ok && second.value.filesDone).toBe(0);
    expect(second.ok && second.value.filesSkipped).toBe(1);
    expect(deps.analyzer.inputs).toHaveLength(analyzerCallsAfterFirst);
  });
});
