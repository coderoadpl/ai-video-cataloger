/**
 * useCatalog - renderer video list as a derived view of CLI scan output.
 *
 * The list is REPLACED wholesale by every refresh() (no incremental merges,
 * so renames never leave ghost entries), and the selection is stored as a
 * stable key (contentHash when available) so it survives renames.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VideoItem, VideoArtifacts } from '@/components/video-list';
import type { RunCli } from '@/hooks/use-cli-command';

// Scanned video from CLI (matches folder-scan.ts ScannedVideo)
export interface ScannedVideo {
  path: string;
  filename: string;
  size: number;
  sizeFormatted: string;
  duration: number | null;
  durationFormatted: string | null;
  status: string;
  errorMessage?: string | null;
  contentHash: string | null;
  artifacts: VideoArtifacts;
}

// Folder scan result from CLI scan --json
export interface FolderScanResult {
  folder: string;
  databasePath: string | null;
  videos: ScannedVideo[];
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

/** Log sink compatible with the terminal log's addLogLine. */
export type CatalogLog = (
  content: string,
  type: 'stdout' | 'stderr' | 'info' | 'error' | 'success'
) => void;

export interface RefreshOptions {
  /**
   * Scan this folder instead of the hook's current folder.
   * Pass null to clear the catalog (no folder selected).
   */
  folder?: string | null;
  /**
   * Selection to apply after the refresh: a key to select, null to clear,
   * undefined (omitted) to keep the current selection by key.
   */
  selectKey?: string | null;
}

export interface UseCatalogResult {
  videos: VideoItem[];
  selectedVideo: VideoItem | null;
  selectKey: (key: string | null) => void;
  refresh: (opts?: RefreshOptions) => Promise<VideoItem[] | null>;
  isLoading: boolean;
}

/** Stable identity for a video: contentHash survives renames; fall back to path. */
export const keyOf = (video: Pick<VideoItem, 'contentHash' | 'path'>): string =>
  video.contentHash ? video.contentHash : 'path:' + video.path;

const EMPTY_ARTIFACTS: VideoArtifacts = {
  framePaths: null,
  transcriptContent: null,
  transcriptPath: null,
  summary: null,
  summaryPath: null,
  thumbnailPath: null,
  thumbnailMtime: null,
  newFilename: null,
};

const toVideoItem = (video: ScannedVideo): VideoItem => ({
  path: video.path,
  filename: video.filename,
  size: video.size,
  sizeFormatted: video.sizeFormatted,
  duration: video.duration,
  durationFormatted: video.durationFormatted,
  status: video.status as VideoItem['status'],
  errorMessage: video.errorMessage,
  contentHash: video.contentHash,
  artifacts: video.artifacts || EMPTY_ARTIFACTS,
});

export function useCatalog(
  folder: string | null,
  runCli: RunCli,
  onLog?: CatalogLog
): UseCatalogResult {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Track the folder in a ref so refresh() never works on a stale closure
  const folderRef = useRef<string | null>(folder);
  useEffect(() => {
    folderRef.current = folder;
  }, [folder]);

  const selectedVideo = useMemo(
    () => videos.find((video) => keyOf(video) === selectedKey) ?? null,
    [videos, selectedKey]
  );

  const refresh = useCallback(
    async (opts?: RefreshOptions): Promise<VideoItem[] | null> => {
      const targetFolder = opts?.folder !== undefined ? opts.folder : folderRef.current;
      folderRef.current = targetFolder;

      if (!targetFolder) {
        setVideos([]);
        setSelectedKey(null);
        return null;
      }

      setIsLoading(true);
      onLog?.(`\x1b[36mScanning folder for videos...\x1b[0m`, 'info');

      try {
        const { code, events } = await runCli(['scan', targetFolder], {
          onJson: (event) => {
            if (event.type === 'error') {
              onLog?.(`\x1b[31mScan error:\x1b[0m ${event.error || event.message}`, 'error');
            }
          },
          onLine: (line, source) => onLog?.(line, source),
        });

        const completed = events.find((event) => event.type === 'completed' && event.data);
        const scanResult = completed?.data
          ? (completed.data as unknown as FolderScanResult)
          : null;

        if (code !== 0 || !scanResult || !Array.isArray(scanResult.videos)) {
          return null;
        }

        onLog?.(`\x1b[32m✓\x1b[0m Found ${scanResult.videos.length} video(s)`, 'success');

        const items = scanResult.videos.map(toVideoItem);
        // Replace the list wholesale - the scan output is the single source of truth
        setVideos(items);
        // Preserve selection by key; clear it if the key vanished from the new list
        setSelectedKey((previous) => {
          const wanted = opts?.selectKey !== undefined ? opts.selectKey : previous;
          if (wanted === null) {
            return null;
          }
          return items.some((video) => keyOf(video) === wanted) ? wanted : null;
        });
        return items;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onLog?.(`\x1b[31mError:\x1b[0m Failed to scan folder: ${message}`, 'error');
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [runCli, onLog]
  );

  const selectKey = useCallback((key: string | null): void => {
    setSelectedKey(key);
  }, []);

  return { videos, selectedVideo, selectKey, refresh, isLoading };
}
