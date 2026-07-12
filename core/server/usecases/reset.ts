import { appError, ok, type AppError, type Result, type VideoStatus } from '@core/domain/index.js';

import type { CatalogRepositoryFactory, FileSystemPort } from '../ports.js';

export interface ResetDeps {
  catalogs: CatalogRepositoryFactory;
  fs: FileSystemPort;
}

export type ResetAllOutput =
  | {
      cleared: number;
      byStatus: Record<VideoStatus, number>;
      configPreserved: true;
    }
  | {
      cleared: 0;
      message: 'No video records in database';
    };

export type ResetSingleOutput =
  | {
      filename: string;
      previousStatus: VideoStatus;
      newStatus: 'pending';
      previousError: string | null;
    }
  | {
      filename: string;
      previousStatus: 'pending';
      newStatus: 'pending';
      message: 'Video is already in pending status';
    };

export const resetAll = async (
  deps: ResetDeps,
  input: { folder?: string; force: boolean },
): Promise<Result<ResetAllOutput, AppError>> => {
  const repository = await openRepository(deps, input.folder);
  if (!repository.ok) return repository;

  const videos = await repository.value.listVideos();
  if (!videos.ok) return videos;
  if (videos.value.length === 0) return ok({ cleared: 0, message: 'No video records in database' });
  if (!input.force) return { ok: false, error: appError('force_required', 'Reset requires --force flag in JSON mode') };

  const byStatus = emptyByStatus();
  for (const video of videos.value) {
    byStatus[video.status] += 1;
  }

  const cleared = await repository.value.clearVideos();
  if (!cleared.ok) return { ok: false, error: appError('reset_failed', 'Failed to reset videos', cleared.error) };
  return ok({ cleared: cleared.value.cleared, byStatus, configPreserved: true });
};

export const resetSingle = async (
  deps: ResetDeps,
  input: { folder?: string; filename: string; force: boolean },
): Promise<Result<ResetSingleOutput, AppError>> => {
  const repository = await openRepository(deps, input.folder);
  if (!repository.ok) return repository;

  const videos = await repository.value.listVideos();
  if (!videos.ok) return videos;
  const video = videos.value.find((candidate) => candidate.originalName === input.filename) ?? null;
  if (video === null) return { ok: false, error: appError('video_not_found', `Video not found: ${input.filename}`) };

  if (video.status === 'pending') {
    return ok({
      filename: input.filename,
      previousStatus: 'pending',
      newStatus: 'pending',
      message: 'Video is already in pending status',
    });
  }

  if (!input.force) return { ok: false, error: appError('force_required', 'Reset requires --force flag in JSON mode') };

  const reset = await repository.value.resetVideoByOriginalName(input.filename);
  if (!reset.ok) return { ok: false, error: appError('reset_failed', 'Failed to reset video', reset.error) };
  if (reset.value === null) return { ok: false, error: appError('reset_failed', 'Failed to reset video') };

  return ok({
    filename: input.filename,
    previousStatus: reset.value.before.status,
    newStatus: 'pending',
    previousError: reset.value.before.errorMessage,
  });
};

const openRepository = async (deps: ResetDeps, folder?: string) =>
  deps.catalogs.open(deps.fs.resolve(folder ?? deps.fs.cwd()));

const emptyByStatus = (): Record<VideoStatus, number> => ({
  pending: 0,
  frames_extracted: 0,
  audio_extracted: 0,
  transcribed: 0,
  analyzed: 0,
  completed: 0,
  error: 0,
});
