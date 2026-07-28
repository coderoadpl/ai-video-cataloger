import { appError, ok, type AppError, type Result } from '@core/domain/index.js';

import type { FileSystemPort, MediaPort } from '../ports.js';
import { isSupportedVideoExtension, thumbnailArtifactPath } from './shared.js';
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

export const generateThumbnail = async (
  deps: ThumbnailDeps,
  input: { videoPath: string; force: boolean; priority?: 'foreground' | 'background' | undefined },
): Promise<Result<ThumbnailOutput, AppError>> => {
  const videoPath = deps.fs.resolve(input.videoPath);
  const exists = await deps.fs.exists(videoPath);
  if (!exists.ok) return exists;
  if (!exists.value) return { ok: false, error: appError('file_not_found', `File not found: ${videoPath}`) };

  if (!isSupportedVideoExtension(deps.fs.extname(videoPath))) {
    return { ok: false, error: appError('invalid_file_type', `Unsupported video file type: ${videoPath}`) };
  }

  const file = await deps.fs.isFile(videoPath);
  if (!file.ok) return file;
  if (!file.value) return { ok: false, error: appError('not_a_file', `Not a file: ${videoPath}`) };

  const root = await discoverArtifactRoot(deps.fs, deps.fs.dirname(videoPath));
  if (!root.ok) return root;
  const thumbnailPath = thumbnailArtifactPath(deps.fs, root.value, videoPath);
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
