/**
 * useVideoLoader - load videos for a folder: one wholesale catalog refresh,
 * then background thumbnail generation for videos missing one. Extracted
 * from App.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { VideoItem } from '@/components/video-list';
import type { RunCli } from '@/hooks/use-cli-command';
import type { RefreshOptions } from '@/hooks/use-catalog';
import type { LogLine } from '@/hooks/use-terminal-log';

export interface UseVideoLoaderOptions {
  runCli: RunCli;
  addLogLine: (content: string, type?: LogLine['type']) => void;
  refresh: (opts?: RefreshOptions) => Promise<VideoItem[] | null>;
  currentFolder: string | null;
  videosCount: number;
  isLoadingVideos: boolean;
}

export interface UseVideoLoaderResult {
  isGeneratingThumbnails: boolean;
  loadVideosForFolder: (folderPath: string, preserveSelectionByHash?: string | null) => Promise<void>;
}

export function useVideoLoader({
  runCli,
  addLogLine,
  refresh,
  currentFolder,
  videosCount,
  isLoadingVideos,
}: UseVideoLoaderOptions): UseVideoLoaderResult {
  const [isGeneratingThumbnails, setIsGeneratingThumbnails] = useState(false);
  const thumbnailGenerationRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  // Generate thumbnails for videos that don't have one yet, then refresh once
  // so the new thumbnail artifacts (paths + mtimes) appear in the catalog.
  const generateMissingThumbnails = useCallback(
    async (items: VideoItem[], generation: { cancelled: boolean }): Promise<void> => {
      const missing = items.filter((video) => video.artifacts.thumbnailPath == null);
      if (missing.length === 0) {
        return;
      }

      setIsGeneratingThumbnails(true);
      addLogLine(`\x1b[36mGenerating thumbnails...\x1b[0m`, 'info');

      let generatedCount = 0;
      for (const video of missing) {
        if (generation.cancelled) {
          addLogLine(`\x1b[33mThumbnail generation cancelled\x1b[0m`, 'info');
          break;
        }

        try {
          const { code, events } = await runCli(['thumbnail', video.path], {
            onJson: (event) => {
              if (event.type === 'error') {
                addLogLine(`\x1b[31mThumbnail error:\x1b[0m ${event.error || event.message}`, 'error');
              }
            },
            onLine: (line, source) => addLogLine(line, source),
          });
          if (code === 0 && events.some((event) => event.type === 'completed')) {
            generatedCount++;
          }
        } catch {
          // Spawn failed - skip this video and continue with the rest
        }
      }

      if (!generation.cancelled) {
        setIsGeneratingThumbnails(false);
        if (generatedCount > 0) {
          addLogLine(`\x1b[32m✓\x1b[0m Generated ${generatedCount} thumbnail(s)`, 'success');
          // Single refresh at the end of the loop picks up all new thumbnails
          await refresh();
        } else {
          addLogLine(`\x1b[32m✓\x1b[0m Thumbnails loaded`, 'success');
        }
      }
    },
    [runCli, addLogLine, refresh]
  );

  // Load videos for a folder: one wholesale refresh, then background thumbnails
  const loadVideosForFolder = useCallback(
    async (folderPath: string, preserveSelectionByHash?: string | null) => {
      // Cancel any ongoing thumbnail generation
      thumbnailGenerationRef.current.cancelled = true;
      thumbnailGenerationRef.current = { cancelled: false };
      const currentGeneration = thumbnailGenerationRef.current;

      const items = await refresh({
        folder: folderPath,
        selectKey: preserveSelectionByHash ?? null,
      });
      if (!items || items.length === 0) {
        return;
      }

      await generateMissingThumbnails(items, currentGeneration);
    },
    [refresh, generateMissingThumbnails]
  );

  // Load videos for current folder on initial load
  const initialLoadRef = useRef(true);
  useEffect(() => {
    if (initialLoadRef.current && currentFolder && videosCount === 0 && !isLoadingVideos) {
      initialLoadRef.current = false;
      loadVideosForFolder(currentFolder);
    }
  }, [currentFolder, videosCount, isLoadingVideos, loadVideosForFolder]);

  return { isGeneratingThumbnails, loadVideosForFolder };
}
