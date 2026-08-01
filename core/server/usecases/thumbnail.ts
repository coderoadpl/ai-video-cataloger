import { appError, ok, type AppError, type Result } from '@core/domain/index.js';

import type { FileSystemPort, MediaPort, ThumbnailGeneration } from '../ports.js';
import { FRAME_FILE_NAME_PATTERN } from './artifact-store.js';
import { isSupportedVideoExtension, artifactPaths, thumbnailArtifactPath, GRID_THUMBNAIL_EDGE } from './shared.js';
import { discoverArtifactRoot } from './artifact-root.js';

export interface ThumbnailDeps {
  fs: FileSystemPort;
  media: MediaPort;
}

export interface ThumbnailOutput {
  video: string;
  path: string;
  thumbnailPath: string;
  generated: boolean;
  skipped: boolean;
}

export const storedAnalysisFramePath = async (
  fs: FileSystemPort,
  framesDirectory: string,
): Promise<Result<string | null, AppError>> => {
  const isDirectory = await fs.isDirectory(framesDirectory);
  if (!isDirectory.ok) return isDirectory;
  if (!isDirectory.value) return ok(null);
  const entries = await fs.listDirectory(framesDirectory);
  if (!entries.ok) return entries;
  const framePaths = entries.value
    .filter((entry) => entry.kind === 'file' && FRAME_FILE_NAME_PATTERN.test(entry.name))
    .map((entry) => entry.path)
    .sort();
  return ok(framePaths[0] ?? null);
};

export const generateThumbnail = async (
  deps: ThumbnailDeps,
  input: { videoPath: string; force: boolean; priority?: 'foreground' | 'background' | undefined },
): Promise<Result<ThumbnailOutput, AppError>> => {
  const videoPath = deps.fs.resolve(input.videoPath);

  if (!isSupportedVideoExtension(deps.fs.extname(videoPath))) {
    return { ok: false, error: appError('invalid_file_type', `Unsupported video file type: ${videoPath}`) };
  }

  const root = await discoverArtifactRoot(deps.fs, deps.fs.dirname(videoPath));
  if (!root.ok) return root;
  const thumbnailPath = thumbnailArtifactPath(deps.fs, root.value, videoPath);

  if (!input.force) {
    const existing = await deps.fs.exists(thumbnailPath);
    if (!existing.ok) return existing;
    if (existing.value) {
      return ok({
        video: deps.fs.basename(videoPath),
        path: videoPath,
        thumbnailPath,
        generated: false,
        skipped: true,
      });
    }
  }

  const framesDir = artifactPaths(deps.fs, root.value, videoPath, null).framesDir;
  const framePath = await storedAnalysisFramePath(deps.fs, framesDir);
  if (!framePath.ok) return framePath;

  if (framePath.value !== null) {
    const thumbnail = await deps.media.thumbnailFromFrame({
      framePath: framePath.value,
      thumbnailPath,
      width: 128,
      height: 72,
      force: input.force,
      priority: input.priority ?? 'foreground',
    });
    if (!thumbnail.ok) return { ok: false, error: appError('thumbnail_error', thumbnail.error.message, thumbnail.error) };
    return ok({
      video: deps.fs.basename(videoPath),
      path: videoPath,
      thumbnailPath: thumbnail.value.path,
      generated: thumbnail.value.generated,
      skipped: thumbnail.value.skipped,
    });
  }

  const exists = await deps.fs.exists(videoPath);
  if (!exists.ok) return exists;
  if (!exists.value) return { ok: false, error: appError('file_not_found', `File not found: ${videoPath}`) };

  const file = await deps.fs.isFile(videoPath);
  if (!file.ok) return file;
  if (!file.value) return { ok: false, error: appError('not_a_file', `Not a file: ${videoPath}`) };

  const thumbnail = await deps.media.thumbnail({
    videoPath,
    thumbnailPath,
    seekPercent: 0.25,
    width: 128,
    height: 72,
    force: input.force,
    priority: input.priority ?? 'foreground',
  });
  if (!thumbnail.ok) return { ok: false, error: appError('thumbnail_error', thumbnail.error.message, thumbnail.error) };

  return ok({
    video: deps.fs.basename(videoPath),
    path: videoPath,
    thumbnailPath: thumbnail.value.path,
    generated: thumbnail.value.generated,
    skipped: thumbnail.value.skipped,
  });
};

export const generateGridThumbnail = async (
  deps: { fs: FileSystemPort; media: MediaPort },
  input: {
    framePath: string;
    gridThumbnailPath: string;
    force: boolean;
    priority?: 'foreground' | 'background' | undefined;
  },
): Promise<Result<ThumbnailGeneration, AppError>> => {
  const thumbnail = await deps.media.thumbnailFromFrame({
    framePath: input.framePath,
    thumbnailPath: input.gridThumbnailPath,
    width: GRID_THUMBNAIL_EDGE,
    height: GRID_THUMBNAIL_EDGE,
    force: input.force,
    fit: 'cover',
    priority: input.priority,
  });
  if (!thumbnail.ok) return { ok: false, error: appError('thumbnail_error', thumbnail.error.message, thumbnail.error) };
  return ok(thumbnail.value);
};
