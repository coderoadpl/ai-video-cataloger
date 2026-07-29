import { appError, ok, type AppError, type Result } from '@core/domain/index.js';

import {
  JOB_CANCELLED_ERROR_MESSAGE,
  type FileSystemPort,
  type JobExecutionContext,
  type JobsPort,
  type MediaPort,
} from '../ports.js';
import { discoverArtifactRoot } from './artifact-root.js';
import { discoverCatalogFolders, type DriveRunFailure } from './process-drive.js';
import { generateThumbnail, storedAnalysisFramePath } from './thumbnail.js';
import { artifactPaths, thumbnailArtifactPath } from './shared.js';

const maxFailures = 200;

export interface ThumbnailsDeps {
  fs: FileSystemPort;
  media: MediaPort;
  jobs: JobsPort;
}

export type ThumbnailsPassDeps = Omit<ThumbnailsDeps, 'jobs'>;

export interface ThumbnailsPassOutput {
  root: string;
  foldersScanned: number;
  filesScanned: number;
  candidates: number;
  generated: number;
  skipped: number;
  fromFrame: number;
  fromSource: number;
  failed: number;
  failures: DriveRunFailure[];
}

export const thumbnailsBackfill = async (
  deps: ThumbnailsDeps,
  input: { root: string; force: boolean },
): Promise<Result<{ jobId: string }, AppError>> => {
  const root = deps.fs.resolve(input.root);
  return deps.jobs.enqueue({
    kind: 'thumbnails',
    payload: input,
    resourceKey: `thumbnails:${root}`,
    run: (context) => runThumbnailsPass(deps, { root, force: input.force }, context),
  });
};

export const runThumbnailsPass = async (
  deps: ThumbnailsPassDeps,
  input: { root: string; force: boolean },
  progress?: JobExecutionContext,
): Promise<Result<ThumbnailsPassOutput, AppError>> => {
  const discovery = await discoverCatalogFolders(deps.fs, { root: input.root });
  if (!discovery.ok) return discovery;

  const started = await report(progress, {
    step: 'thumbnails_scanning',
    percentage: 0,
    total: Math.max(discovery.value.filesTotal, 1),
    data: {
      root: discovery.value.root,
      foldersTotal: discovery.value.folders.length,
      filesTotal: discovery.value.filesTotal,
    },
  });
  if (!started.ok) return started;

  const output: ThumbnailsPassOutput = {
    root: discovery.value.root,
    foldersScanned: 0,
    filesScanned: 0,
    candidates: 0,
    generated: 0,
    skipped: 0,
    fromFrame: 0,
    fromSource: 0,
    failed: 0,
    failures: [...discovery.value.failures],
  };

  let current = 0;
  for (const folder of discovery.value.folders) {
    const cancellation = cancelled(progress);
    if (!cancellation.ok) return cancellation;
    output.foldersScanned += 1;
    const root = await discoverArtifactRoot(deps.fs, folder.path);
    if (!root.ok) return root;
    for (const videoPath of folder.videoPaths) {
      const cancelledFile = cancelled(progress);
      if (!cancelledFile.ok) return cancelledFile;
      output.filesScanned += 1;
      current += 1;
      const paths = artifactPaths(deps.fs, root.value, videoPath, null);
      const isCandidate = await deps.fs.isFile(paths.summaryJsonPath);
      if (!isCandidate.ok) return isCandidate;
      if (!isCandidate.value) continue;
      output.candidates += 1;
      const thumbnailPath = thumbnailArtifactPath(deps.fs, root.value, videoPath);
      const reportFile = (source: 'frame' | 'video' | null): Promise<Result<void, AppError>> =>
        report(progress, {
          step: 'thumbnails_file',
          current,
          total: discovery.value.filesTotal,
          data: {
            video: videoPath,
            thumbnailPath,
            source,
            generated: output.generated,
            skipped: output.skipped,
            failed: output.failed,
          },
        });
      if (!input.force) {
        const exists = await deps.fs.isFile(thumbnailPath);
        if (!exists.ok) return exists;
        if (exists.value) {
          output.skipped += 1;
          const reported = await reportFile(null);
          if (!reported.ok) return reported;
          continue;
        }
      }
      const framePath = await storedAnalysisFramePath(deps.fs, paths.framesDir);
      if (!framePath.ok) return framePath;
      const source: 'frame' | 'video' = framePath.value === null ? 'video' : 'frame';
      const generated = framePath.value === null
        ? await generateThumbnail(deps, { videoPath, force: input.force, priority: 'background' })
        : await deps.media.thumbnailFromFrame({
          framePath: framePath.value,
          thumbnailPath,
          width: 128,
          height: 72,
          force: input.force,
          priority: 'background',
        });
      if (!generated.ok) {
        output.failed += 1;
        if (output.failures.length < maxFailures) {
          output.failures.push({ path: videoPath, scope: 'file', code: generated.error.code, message: generated.error.message });
        }
        const reported = await reportFile(source);
        if (!reported.ok) return reported;
        continue;
      }
      output.generated += 1;
      if (source === 'frame') output.fromFrame += 1;
      else output.fromSource += 1;
      const reported = await reportFile(source);
      if (!reported.ok) return reported;
    }
  }

  const done = await report(progress, {
    step: 'thumbnails_done',
    percentage: 100,
    data: {
      root: output.root,
      candidates: output.candidates,
      generated: output.generated,
      skipped: output.skipped,
      fromFrame: output.fromFrame,
      fromSource: output.fromSource,
      failed: output.failed,
    },
  });
  if (!done.ok) return done;

  return ok(output);
};

const report = (
  progress: JobExecutionContext | undefined,
  progressInput: { step: 'thumbnails_scanning' | 'thumbnails_file' | 'thumbnails_done'; percentage?: number; current?: number; total?: number; data?: Record<string, unknown> },
): Promise<Result<void, AppError>> =>
  progress === undefined ? Promise.resolve(ok(undefined)) : progress.reportProgress(progressInput);

const cancelled = (progress: JobExecutionContext | undefined): Result<void, AppError> => {
  if (progress?.signal.aborted === true) {
    return { ok: false, error: appError('processing_error', JOB_CANCELLED_ERROR_MESSAGE) };
  }
  return ok(undefined);
};
