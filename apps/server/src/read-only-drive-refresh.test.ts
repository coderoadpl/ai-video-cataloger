import { appendFile, chmod, cp, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ok, type AppError, type Result } from '@core/domain/index.js';
import {
  processDrive,
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

const driveInput = (root: string): ProcessDriveInput => ({
  root,
  frames: 1,
  framesExplicit: true,
  skipRename: true,
  skipRenameExplicit: true,
  verbose: false,
  timeout: 120,
  whisper: 'skip',
  whisperExplicit: true,
  whisperModel: 'base',
});

const freezeTree = async (folder: string, frozen: string[]): Promise<void> => {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.isDirectory()) await freezeTree(path.join(folder, entry.name), frozen);
  }
  await chmod(folder, 0o555);
  frozen.push(folder);
};

describe('drive run whose end-of-run snapshot refresh lands on a now read-only tree', () => {
  const frozen: string[] = [];
  const bases: string[] = [];

  afterEach(async () => {
    for (const directory of [...frozen].reverse()) await chmod(directory, 0o755);
    await Promise.all(bases.map((base) => rm(base, { recursive: true, force: true })));
    frozen.length = 0;
    bases.length = 0;
  });

  const scaffold = async (): Promise<{
    root: string;
    source: string;
    target: string;
    freshDeps: () => ProcessDeps;
  }> => {
    const base = await mkdtemp(path.join(tmpdir(), 'avc-ro-refresh-'));
    bases.push(base);
    const home = path.join(base, 'home');
    const root = path.join(base, 'drive');
    const source = path.join(root, 'incoming');
    const target = path.join(root, 'archive');
    await mkdir(home, { recursive: true });
    await mkdir(source, { recursive: true });
    await mkdir(target, { recursive: true });
    await cp(path.resolve('test/BigBuckBunny480p30s.mp4'), path.join(source, 'clip.mp4'));
    await cp(path.resolve('test/BigBuckBunny480p30s.mp4'), path.join(target, 'keeper.mp4'));
    // Both copies otherwise share a fingerprint and the second would be deduplicated away.
    await appendFile(path.join(target, 'keeper.mp4'), Buffer.alloc(64, 7));
    return {
      root,
      source,
      target,
      freshDeps: (): ProcessDeps => ({
        catalogs: new SqlJsCatalogRepositoryFactory(),
        config: new JsonConfigStore({ homeDirectory: home }),
        fs: new NodeFileSystemPort({ workingDirectory: root, homeDirectory: home }),
        media: new FfmpegMediaAdapter(),
        transcriber: new UnusedTranscriber(),
        analyzer: new StubAnalyzer(),
        globalCatalog: new SqlJsGlobalCatalogStore({ homeDirectory: home }),
      }),
    };
  };

  it('completes with a snapshot-skipped warning instead of failing on EACCES', async () => {
    const { root, source, target, freshDeps } = await scaffold();

    const first = await processDrive(freshDeps(), driveInput(root));
    if (!first.ok) throw new Error(`${first.error.code}: ${first.error.message}`);
    expect(first.value.filesDone).toBe(2);

    await rename(path.join(source, 'clip.mp4'), path.join(target, 'clip.mp4'));
    await freezeTree(root, frozen);

    const events: JobProgress[] = [];
    const progress = {
      signal: new AbortController().signal,
      reportProgress: (event: JobProgress): Promise<Result<void, AppError>> => {
        events.push(event);
        return Promise.resolve(ok(undefined));
      },
    };
    const second = await processDrive(freshDeps(), driveInput(root), progress);
    if (!second.ok) throw new Error(`${second.error.code}: ${second.error.message}`);

    expect(second.value.filesFailed).toBe(0);
    expect(second.value.snapshotSkipped).toBeGreaterThan(0);
    const skipped = events.filter((event) => event.step === 'catalog_snapshot_skipped');
    expect(skipped.some((event) => event.data?.['folder'] === target)).toBe(true);
  }, scaledTimeout(120000));
});
