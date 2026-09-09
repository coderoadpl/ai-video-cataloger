import { appError, ok, type AppError, type Result } from '@core/domain/index.js';

import {
  JOB_CANCELLED_ERROR_MESSAGE,
  type FileSystemPort,
  type GlobalCatalogStore,
  type JobExecutionContext,
  type JobsPort,
  type MediaPort,
} from '../ports.js';
import { discoverArtifactRootForWrite } from './artifact-root.js';
import { discoverCatalogFolders, type DriveRunFailure } from './process-drive.js';
import { ensureGridThumbnail, hasCurrentGridThumbnail, generateThumbnail, storedAnalysisFramePath } from './thumbnail.js';
import { artifactPaths, gridThumbnailArtifactPath, thumbnailArtifactPath } from './shared.js';

const maxFailures = 200;

export interface ThumbnailsDeps {
  globalCatalog?: GlobalCatalogStore | undefined;
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
  gridGenerated: number;
  gridSkipped: number;
  gridFailed: number;
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
    gridGenerated: 0,
    gridSkipped: 0,
    gridFailed: 0,
    failures: [...discovery.value.failures],
  };

  let current = 0;
  for (const folder of discovery.value.folders) {
    const cancellation = cancelled(progress);
    if (!cancellation.ok) return cancellation;
    output.foldersScanned += 1;
    const root = await discoverArtifactRootForWrite(deps.fs, folder.path);
    if (!root.ok) return root;
    const stored = deps.globalCatalog === undefined ? ok([])
      : await deps.globalCatalog.listVideoThumbnailFingerprints(folder.path);
    if (!stored.ok) return stored;
    const storedFingerprints = new Map<string, string>();
    for (const file of stored.value) {
      storedFingerprints.set(file.fileName, file.fingerprint);
    }
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
      const gridThumbnailPath = gridThumbnailArtifactPath(deps.fs, root.value, videoPath);
      if (!input.force) {
        const cached = await hasCurrentGridThumbnail(deps, gridThumbnailPath);
        if (!cached.ok) return cached;
        const cover = await deps.fs.isFile(thumbnailPath);
        if (!cover.ok) return cover;
        if (cached.value && cover.value) {
          output.skipped += 1;
          output.gridSkipped += 1;
          continue;
        }
      }
      const framePath = await storedAnalysisFramePath(deps.fs, paths.framesDir);
      if (!framePath.ok) return framePath;
      const storedFingerprint = storedFingerprints.get(deps.fs.basename(videoPath));
      const fingerprint = !input.force && storedFingerprint !== undefined
        ? ok(storedFingerprint) : await deps.fs.partialContentHash(videoPath);
      if (!fingerprint.ok) return fingerprint;
      const grid = await ensureGridThumbnail(deps, {
        videoPath,
        projectedFramePath: framePath.value,
        catalogDirectory: root.value.catalogDirectory,
        fingerprint: fingerprint.value,
        gridThumbnailPath,
        force: input.force,
        priority: 'background',
      });
      if (!grid.ok) {
        output.gridFailed += 1;
      } else if (grid.value.skipped) {
        output.gridSkipped += 1;
      } else {
        output.gridGenerated += 1;
      }
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
      gridGenerated: output.gridGenerated,
      gridSkipped: output.gridSkipped,
      gridFailed: output.gridFailed,
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
