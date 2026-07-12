import { ok, type AppError, type Result, type VideoStatus } from '@core/domain/index.js';

import type { CatalogRepositoryFactory, FileSystemPort } from '../ports.js';
import { isInProgressStatus, statusLabel } from './shared.js';

export interface StatusVideo {
  path: string;
  originalName: string;
  newName: string | null;
  status: VideoStatus;
  statusLabel: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StatusOutput {
  videos: StatusVideo[];
  summary: {
    total: number;
    completed: number;
    inProgress: number;
    pending: number;
    error: number;
  };
}

export interface StatusDeps {
  catalogs: CatalogRepositoryFactory;
  fs: FileSystemPort;
}

export const getStatus = async (deps: StatusDeps, input: { folder?: string } = {}): Promise<Result<StatusOutput, AppError>> => {
  const folder = deps.fs.resolve(input.folder ?? deps.fs.cwd());
  const repository = await deps.catalogs.open(folder);
  if (!repository.ok) return repository;
  const videos = await repository.value.listVideos();
  if (!videos.ok) return videos;

  const outputVideos = videos.value.map((video) => ({
    path: video.originalPath,
    originalName: video.originalName,
    newName: video.newName,
    status: video.status,
    statusLabel: statusLabel(video.status),
    errorMessage: video.errorMessage,
    createdAt: video.createdAt,
    updatedAt: video.updatedAt,
  }));

  return ok({ videos: outputVideos, summary: summarize(outputVideos) });
};

const summarize = (videos: StatusVideo[]): StatusOutput['summary'] => {
  const summary: StatusOutput['summary'] = {
    total: videos.length,
    completed: 0,
    inProgress: 0,
    pending: 0,
    error: 0,
  };
  for (const video of videos) {
    if (video.status === 'completed') summary.completed += 1;
    else if (video.status === 'pending') summary.pending += 1;
    else if (video.status === 'error') summary.error += 1;
    else if (isInProgressStatus(video.status)) summary.inProgress += 1;
  }
  return summary;
};
