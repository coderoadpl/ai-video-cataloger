/**
 * SidebarPanel - sidebar content: folder header, batch toolbar and the video
 * list (or the "no folder selected" empty state), extracted from App.
 */

import { Folder } from 'lucide-react';
import { VideoList, VideoItem } from '@/components/video-list';
import { BatchToolbar } from '@/components/batch-toolbar';
import { getFolderName } from '@/components/folder-bar';
import type { BatchProgress } from '@/hooks/use-batch-processor';

interface SidebarPanelProps {
  currentFolder: string | null;
  isGeneratingThumbnails: boolean;
  pendingVideosCount: number;
  isBatchProcessing: boolean;
  isAnalyzing: boolean;
  batchProgress: BatchProgress | null;
  onBatchAnalyze: () => void;
  onBatchCancel: () => void;
  videos: VideoItem[];
  selectedVideoPath: string | null;
  onSelectVideo: (video: VideoItem) => void;
  isLoadingVideos: boolean;
  analyzingVideoPath: string | null;
}

export function SidebarPanel({
  currentFolder,
  isGeneratingThumbnails,
  pendingVideosCount,
  isBatchProcessing,
  isAnalyzing,
  batchProgress,
  onBatchAnalyze,
  onBatchCancel,
  videos,
  selectedVideoPath,
  onSelectVideo,
  isLoadingVideos,
  analyzingVideoPath,
}: SidebarPanelProps): JSX.Element {
  if (!currentFolder) {
    return (
      <div className="p-4 space-y-2">
        <p className="text-sm text-muted-foreground">No folder selected</p>
        <p className="text-xs text-muted-foreground">
          Click "Open Folder" to select a video folder.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Folder header */}
      <div className="px-4 py-3 border-b border-border space-y-2">
        <div className="flex items-center gap-2">
          <Folder className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm truncate" title={currentFolder}>
            {getFolderName(currentFolder)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground truncate" title={currentFolder}>
          {currentFolder}
        </p>
        {isGeneratingThumbnails && (
          <p className="text-xs text-muted-foreground animate-pulse">
            Generating thumbnails...
          </p>
        )}
        <BatchToolbar
          pendingVideosCount={pendingVideosCount}
          isBatchProcessing={isBatchProcessing}
          isAnalyzing={isAnalyzing}
          batchProgress={batchProgress}
          onBatchAnalyze={onBatchAnalyze}
          onBatchCancel={onBatchCancel}
        />
      </div>
      {/* Video list */}
      <div className="flex-1 min-h-0">
        <VideoList
          videos={videos}
          selectedVideoPath={selectedVideoPath}
          onSelectVideo={onSelectVideo}
          isLoading={isLoadingVideos}
          analyzingVideoPath={analyzingVideoPath}
        />
      </div>
    </div>
  );
}
