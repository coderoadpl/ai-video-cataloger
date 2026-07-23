import { appError, ok, type AppError, type Result, type VideoStatus } from '@core/domain/index.js';

import type { CatalogRepository, CatalogRepositoryFactory, CatalogVideo, FileSystemPort, MediaPort } from '../ports.js';
import {
  artifactPaths,
  formatDuration,
  formatSize,
  isInProgressStatus,
  isSupportedVideoExtension,
  parseSummary,
  type SummaryData,
} from './shared.js';

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface ScanArtifacts {
  framePaths: string[] | null;
  transcriptContent: string | null;
  transcriptPath: string | null;
  transcriptSegments?: TranscriptSegment[] | null;
  summary: SummaryData | null;
  summaryPath: string | null;
  thumbnailPath: string | null;
  thumbnailMtime: number | null;
  newFilename: string | null;
}

export interface ScanVideo {
  path: string;
  filename: string;
  size: number;
  sizeFormatted: string;
  duration: number | null;
  durationFormatted: string | null;
  status: VideoStatus | 'not_tracked';
  errorMessage?: string | null;
  contentHash: string | null;
  source?: {
    width: number | null;
    height: number | null;
    rotation: number | null;
  };
  artifacts: ScanArtifacts;
}

export interface ScanOutput {
  folder: string;
  databasePath: string | null;
  videos: ScanVideo[];
  summary: {
    total: number;
    tracked: number;
    pending: number;
    inProgress: number;
    completed: number;
    error: number;
    notTracked: number;
  };
}

export interface ScanDeps {
  catalogs: CatalogRepositoryFactory;
  fs: FileSystemPort;
  media: MediaPort;
}

export const scanFolder = async (deps: ScanDeps, input: { folder: string }): Promise<Result<ScanOutput, AppError>> => {
  const folder = deps.fs.resolve(input.folder);
  const exists = await deps.fs.exists(folder);
  if (!exists.ok) return exists;
  if (!exists.value) return { ok: false, error: appError('folder_not_found', `Folder not found: ${folder}`) };

  const directory = await deps.fs.isDirectory(folder);
  if (!directory.ok) return directory;
  if (!directory.value) return { ok: false, error: appError('not_a_directory', `Not a directory: ${folder}`) };

  const entries = await deps.fs.listDirectory(folder);
  if (!entries.ok) return { ok: false, error: appError('read_error', `Error reading directory: ${folder}`, entries.error) };

  const repository = await deps.catalogs.open(folder);
  if (!repository.ok) return repository;

  const videoEntries = entries.value
    .filter((entry) => entry.kind === 'file' && isSupportedVideoExtension(deps.fs.extname(entry.name)))
    .sort((left, right) => left.path.localeCompare(right.path));

  const videos: ScanVideo[] = [];
  for (const entry of videoEntries) {
    const scanned = await scanVideo(deps, repository.value, folder, entry.path);
    if (!scanned.ok) return scanned;
    videos.push(scanned.value);
  }

  return ok({
    folder,
    databasePath: repository.value.databasePath(),
    videos,
    summary: summarize(videos),
  });
};

const scanVideo = async (
  deps: ScanDeps,
  repository: CatalogRepository,
  folder: string,
  videoPath: string,
): Promise<Result<ScanVideo, AppError>> => {
  const stat = await deps.fs.stat(videoPath);
  if (!stat.ok) return stat;

  const probe = await deps.media.probe({ videoPath });
  const duration = probe.ok ? probe.value.duration : null;

  const hash = await deps.fs.partialContentHash(videoPath);
  const initialHash = hash.ok ? hash.value : null;
  const pathMatch = await repository.findVideoByPath(videoPath);
  if (!pathMatch.ok) return pathMatch;

  let matched: CatalogVideo | null = pathMatch.value;
  if (matched === null && initialHash !== null) {
    const hashMatch = await repository.findVideoByHash(initialHash);
    if (!hashMatch.ok) return hashMatch;
    matched = hashMatch.value;
  }

  const status = matched?.status ?? 'not_tracked';
  const newName = matched?.newName ?? null;
  const artifacts = await loadArtifacts(deps.fs, folder, videoPath, status, newName);
  if (!artifacts.ok) return artifacts;

  return ok({
    path: videoPath,
    filename: deps.fs.basename(videoPath),
    size: stat.value.size,
    sizeFormatted: formatSize(stat.value.size),
    duration,
    durationFormatted: duration === null ? null : formatDuration(duration),
    status,
    errorMessage: matched?.errorMessage ?? null,
    contentHash: matched?.fileHash ?? initialHash,
    source: probe.ok
      ? {
          width: probe.value.width,
          height: probe.value.height,
          rotation: probe.value.rotation,
        }
      : { width: null, height: null, rotation: null },
    artifacts: artifacts.value,
  });
};

const loadArtifacts = async (
  fs: FileSystemPort,
  folder: string,
  videoPath: string,
  status: VideoStatus | 'not_tracked',
  newName: string | null,
): Promise<Result<ScanArtifacts, AppError>> => {
  const paths = artifactPaths(fs, folder, videoPath, newName);
  const artifacts: ScanArtifacts = {
    framePaths: null,
    transcriptContent: null,
    transcriptPath: null,
    transcriptSegments: null,
    summary: null,
    summaryPath: null,
    thumbnailPath: null,
    thumbnailMtime: null,
    newFilename: newName,
  };

  const thumbnailExists = await fs.exists(paths.thumbnailPath);
  if (!thumbnailExists.ok) return thumbnailExists;
  if (thumbnailExists.value) {
    const thumbnailStat = await fs.stat(paths.thumbnailPath);
    if (!thumbnailStat.ok) return thumbnailStat;
    artifacts.thumbnailPath = paths.thumbnailPath;
    artifacts.thumbnailMtime = thumbnailStat.value.mtimeMs;
  }

  if (status === 'not_tracked' || status === 'pending') return ok(artifacts);

  if (hasFrames(status)) {
    const frames = await fs.listDirectory(paths.framesDir);
    if (frames.ok) {
      const framePaths = frames.value
        .filter((entry) => entry.kind === 'file' && fs.extname(entry.name).toLowerCase() === '.jpg')
        .map((entry) => entry.path)
        .sort();
      artifacts.framePaths = framePaths.length > 0 ? framePaths : null;
    }
  }

  if (hasTranscript(status)) {
    const transcript = await fs.readTextFile(paths.transcriptPath);
    if (transcript.ok && transcript.value !== null) {
      artifacts.transcriptContent = transcript.value;
      artifacts.transcriptPath = paths.transcriptPath;
      artifacts.transcriptSegments = await loadTranscriptSegments(fs, paths.transcriptJsonPath);
    }
  }

  if (hasSummary(status)) {
    const summaryText = await fs.readTextFile(paths.summaryPath);
    if (summaryText.ok && summaryText.value !== null) {
      artifacts.summaryPath = paths.summaryPath;
    }
    const summaryJson = await fs.readTextFile(paths.summaryJsonPath);
    if (summaryJson.ok && summaryJson.value !== null) artifacts.summary = parseSummary(summaryJson.value);
  }

  return ok(artifacts);
};

const hasFrames = (status: VideoStatus): boolean =>
  status === 'completed' || status === 'error' || isInProgressStatus(status);

const hasTranscript = (status: VideoStatus): boolean =>
  status === 'transcribed' || status === 'analyzed' || status === 'completed' || status === 'error';

const hasSummary = (status: VideoStatus): boolean =>
  status === 'analyzed' || status === 'completed' || status === 'error';

const loadTranscriptSegments = async (fs: FileSystemPort, transcriptJsonPath: string): Promise<TranscriptSegment[] | null> => {
  const content = await fs.readTextFile(transcriptJsonPath);
  if (!content.ok || content.value === null) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(content.value);
  } catch {
    return null;
  }
  const rawSegments = Array.isArray(decoded)
    ? decoded
    : isRecord(decoded) && Array.isArray(decoded.segments)
      ? decoded.segments
      : null;
  if (rawSegments === null) return null;
  const segments: TranscriptSegment[] = [];
  for (const raw of rawSegments) {
    if (!isRecord(raw)) continue;
    const start = Number(raw.start);
    const end = Number(raw.end);
    const text = typeof raw.text === 'string' ? raw.text.trim() : '';
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || text.length === 0) continue;
    segments.push({ start, end, text });
  }
  return segments.length === 0 ? null : segments;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const summarize = (videos: ScanVideo[]): ScanOutput['summary'] => {
  const summary: ScanOutput['summary'] = {
    total: 0,
    tracked: 0,
    pending: 0,
    inProgress: 0,
    completed: 0,
    error: 0,
    notTracked: 0,
  };
  for (const video of videos) {
    summary.total += 1;
    if (video.status === 'not_tracked') {
      summary.notTracked += 1;
    } else {
      summary.tracked += 1;
      if (video.status === 'pending') summary.pending += 1;
      else if (video.status === 'completed') summary.completed += 1;
      else if (video.status === 'error') summary.error += 1;
      else if (isInProgressStatus(video.status)) summary.inProgress += 1;
    }
  }
  return summary;
};
