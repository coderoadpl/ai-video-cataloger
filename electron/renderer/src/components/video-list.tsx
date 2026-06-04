/**
 * VideoList component
 * Displays a list of video files with thumbnails in the sidebar
 */

import * as React from 'react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Film, AlertCircle, CheckCircle2, Clock, Loader2 } from 'lucide-react';

// Video status from the CLI scan command
export type VideoStatus = 'pending' | 'frames_extracted' | 'audio_extracted' | 'transcribed' | 'analyzed' | 'completed' | 'error' | 'not_tracked';

// Structured summary data (from the CLI summaries/NAME.json file)
export interface SummaryData {
  schemaVersion: 1;
  description: string;
  suggestedFilename: string;
  fullAnalysis: string;
  analyzedAt: string;
}

// Artifact data for processed videos (from CLI scan)
export interface VideoArtifacts {
  framePaths: string[] | null;
  transcriptContent: string | null;
  transcriptPath: string | null;
  summary: SummaryData | null;
  summaryPath: string | null;
  thumbnailPath: string | null;
  thumbnailMtime: number | null;
  newFilename: string | null;
}

// Video item data structure (matches CLI scan output)
export interface VideoItem {
  path: string;
  filename: string;
  size: number;
  sizeFormatted: string;
  duration: number | null;
  durationFormatted: string | null;
  status: VideoStatus;
  errorMessage?: string | null;
  thumbnailPath?: string | null;
  thumbnailDataUrl?: string | null;
  contentHash: string | null;  // Unique identifier that survives renames
  artifacts: VideoArtifacts;   // Processing artifacts (frames, transcript, summary)
}

interface VideoListProps {
  videos: VideoItem[];
  selectedVideoPath: string | null;
  onSelectVideo: (video: VideoItem) => void;
  isLoading?: boolean;
  className?: string;
  analyzingVideoPath?: string | null; // Path of video currently being analyzed
}

/**
 * Get status badge configuration
 * @param status - The video status from database
 * @param isCurrentlyAnalyzing - Whether this video is currently being analyzed
 */
function getStatusBadge(status: VideoStatus, isCurrentlyAnalyzing: boolean = false): {
  color: string;
  bgColor: string;
  icon: React.ReactNode;
  label: string;
} {
  // If currently being analyzed, always show processing spinner
  if (isCurrentlyAnalyzing) {
    return {
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-100',
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
      label: 'Processing',
    };
  }

  switch (status) {
    case 'completed':
      return {
        color: 'text-green-600',
        bgColor: 'bg-green-100',
        icon: <CheckCircle2 className="h-3 w-3" />,
        label: 'Done',
      };
    case 'error':
      return {
        color: 'text-red-600',
        bgColor: 'bg-red-100',
        icon: <AlertCircle className="h-3 w-3" />,
        label: 'Error',
      };
    case 'pending':
      return {
        color: 'text-blue-600',
        bgColor: 'bg-blue-100',
        icon: <Clock className="h-3 w-3" />,
        label: 'Pending',
      };
    case 'frames_extracted':
    case 'audio_extracted':
    case 'transcribed':
    case 'analyzed':
      // Intermediate status - was interrupted or incomplete
      return {
        color: 'text-orange-600',
        bgColor: 'bg-orange-100',
        icon: <AlertCircle className="h-3 w-3" />,
        label: 'Incomplete',
      };
    case 'not_tracked':
    default:
      return {
        color: 'text-gray-500',
        bgColor: 'bg-gray-100',
        icon: null,
        label: '',
      };
  }
}

/**
 * Video thumbnail component
 */
function VideoThumbnail({
  video,
  isSelected,
}: {
  video: VideoItem;
  isSelected: boolean;
}): JSX.Element {
  const [imageError, setImageError] = React.useState(false);

  const thumbnailSrc = video.thumbnailDataUrl;
  const showFallback = !thumbnailSrc || imageError;

  return (
    <div
      className={cn(
        'relative w-16 h-9 rounded overflow-hidden flex-shrink-0 bg-gray-200',
        isSelected && 'ring-2 ring-primary ring-offset-1'
      )}
    >
      {showFallback ? (
        <div className="w-full h-full flex items-center justify-center bg-gray-200">
          <Film className="h-4 w-4 text-gray-400" />
        </div>
      ) : (
        <img
          src={thumbnailSrc}
          alt={video.filename}
          className="w-full h-full object-cover"
          onError={() => setImageError(true)}
        />
      )}
    </div>
  );
}

/**
 * Single video item in the list
 */
function VideoListItem({
  video,
  isSelected,
  isCurrentlyAnalyzing,
  onClick,
}: {
  video: VideoItem;
  isSelected: boolean;
  isCurrentlyAnalyzing: boolean;
  onClick: () => void;
}): JSX.Element {
  const statusBadge = getStatusBadge(video.status, isCurrentlyAnalyzing);

  return (
    <button
      className={cn(
        'w-full flex items-start gap-3 p-2 text-left rounded-md transition-colors',
        'hover:bg-muted/50',
        isSelected && 'bg-muted'
      )}
      onClick={onClick}
      title={video.path}
    >
      <VideoThumbnail video={video} isSelected={isSelected} />
      <div className="flex-1 min-w-0 space-y-1">
        <p
          className={cn(
            'text-sm font-medium truncate',
            isSelected && 'text-primary'
          )}
        >
          {video.filename}
        </p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {video.durationFormatted && <span>{video.durationFormatted}</span>}
          {video.durationFormatted && video.sizeFormatted && <span>•</span>}
          <span>{video.sizeFormatted}</span>
        </div>
        {/* Status badge */}
        {video.status !== 'not_tracked' && (
          <div
            className={cn(
              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium',
              statusBadge.bgColor,
              statusBadge.color
            )}
          >
            {statusBadge.icon}
            <span>{statusBadge.label}</span>
          </div>
        )}
        {/* Error message */}
        {video.status === 'error' && video.errorMessage && (
          <p className="text-xs text-red-600 truncate" title={video.errorMessage}>
            {video.errorMessage}
          </p>
        )}
      </div>
    </button>
  );
}

/**
 * VideoList component
 * Displays a scrollable list of videos with thumbnails and status badges
 */
export function VideoList({
  videos,
  selectedVideoPath,
  onSelectVideo,
  isLoading = false,
  className,
  analyzingVideoPath,
}: VideoListProps): JSX.Element {
  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-8', className)}>
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-sm">Scanning folder...</span>
        </div>
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className={cn('flex items-center justify-center py-8', className)}>
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Film className="h-8 w-8" />
          <span className="text-sm">No videos found</span>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className={cn('h-full', className)}>
      <div className="p-2 space-y-1">
        {videos.map((video) => (
          <VideoListItem
            key={video.path}
            video={video}
            isSelected={video.path === selectedVideoPath}
            isCurrentlyAnalyzing={video.path === analyzingVideoPath}
            onClick={() => onSelectVideo(video)}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

export type { VideoListProps };
