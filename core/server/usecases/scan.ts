import { appError, derivedFolderId, ok, type AppError, type Result, type VideoStatus } from '@core/domain/index.js';

import type {
  CatalogFileRecord,
  CatalogRepository,
  CatalogRepositoryFactory,
  CatalogVideo,
  FileSystemPort,
  GlobalCatalogStore,
  MediaPort,
} from '../ports.js';
import {
  artifactPaths,
  formatDuration,
  formatSize,
  isInProgressStatus,
  isSupportedVideoExtension,
  parseSummary,
  type SummaryData,
} from './shared.js';
import { artifactRootFor, type ArtifactRoot } from './artifact-root.js';
import { healRestoredRecords } from './catalog-index.js';
import { readFolderMarker } from './folder-identity.js';
import { filterTranscript, parseRichSegments } from './transcript-hallucinations.js';

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
  duplicate?: { canonicalPath: string } | null;
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
  globalCatalog?: GlobalCatalogStore | undefined;
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

  const artifactRoot = artifactRootFor(deps.fs, folder, repository.value.writable());
  const indexed = await indexedAnalyses(deps, folder, repository.value.writable());
  if (!indexed.ok) return indexed;
  const videos: ScanVideo[] = [];
  for (const entry of videoEntries) {
    const scanned = await scanVideo(deps, repository.value, artifactRoot, entry.path, indexed.value);
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

// A folder the app cannot write keeps no catalog of its own: its analyses live only in the global
// index, under the path-derived folder id. Without that lookup an analysed read-only folder reads
// as untracked again on the next launch, offering to analyse what is already done.
const indexedAnalyses = async (
  deps: ScanDeps,
  folder: string,
  writable: boolean,
): Promise<Result<Map<string, CatalogFileRecord>, AppError>> => {
  const globalCatalog = deps.globalCatalog;
  if (writable || globalCatalog === undefined) return ok(new Map());
  const marker = await readFolderMarker(deps.fs, folder);
  if (!marker.ok) return marker;
  const folderId = marker.value?.folderId ?? derivedFolderId(deps.fs.resolve(folder));
  const records = await globalCatalog.listFolderRecords(folderId);
  if (!records.ok) return records;
  // The folder is read-only, but the index holding its records lives in the home scope and is not:
  // a file that is back on disk gets its missing mark cleared here instead of staying hidden.
  const restored = await healRestoredRecords({ fs: deps.fs, globalCatalog }, folderId, folder, records.value);
  if (!restored.ok) return restored;
  const byFingerprint = new Map<string, CatalogFileRecord>();
  for (const record of records.value) {
    if (record.analysis === null) continue;
    if (record.file.missingAt !== null && !restored.value.has(record.file.fingerprint)) continue;
    byFingerprint.set(record.file.fingerprint, record);
  }
  return ok(byFingerprint);
};

const scanVideo = async (
  deps: ScanDeps,
  repository: CatalogRepository,
  artifactRoot: ArtifactRoot,
  videoPath: string,
  indexed: ReadonlyMap<string, CatalogFileRecord>,
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

  const indexedRecord = matched !== null || initialHash === null ? undefined : indexed.get(initialHash);
  const status = matched?.status ?? (indexedRecord === undefined ? 'not_tracked' : 'completed');
  const newName = matched?.newName ?? indexedRecord?.analysis?.finalName ?? null;
  const artifacts = await loadArtifacts(deps.fs, artifactRoot, videoPath, status, newName);
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
  artifactRoot: ArtifactRoot,
  videoPath: string,
  status: VideoStatus | 'not_tracked',
  newName: string | null,
): Promise<Result<ScanArtifacts, AppError>> => {
  const paths = artifactPaths(fs, artifactRoot, videoPath, newName);
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
      const richSegments = await loadRichSegments(fs, paths.transcriptJsonPath);
      const filtered = filterTranscript(transcript.value, richSegments);
      artifacts.transcriptContent = filtered.text;
      artifacts.transcriptPath = paths.transcriptPath;
      artifacts.transcriptSegments = filtered.segments.length === 0
        ? null
        : filtered.segments.map((segment) => ({ start: segment.start, end: segment.end, text: segment.text }));
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

const loadRichSegments = async (
  fs: FileSystemPort,
  transcriptJsonPath: string,
): Promise<ReturnType<typeof parseRichSegments>> => {
  const content = await fs.readTextFile(transcriptJsonPath);
  if (!content.ok || content.value === null) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(content.value);
  } catch {
    return null;
  }
  return parseRichSegments(decoded);
};

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
