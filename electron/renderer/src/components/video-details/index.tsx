/**
 * VideoDetails component
 * Displays details of a selected video including metadata, summary,
 * transcript, and frames. Split into presentational subcomponents:
 * status-info, metadata-card, status-actions, artifacts-section.
 */

import * as React from 'react';
import { cn } from '@/lib/utils';
import { mediaUrl } from '@/lib/media-url';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Film } from 'lucide-react';
import type { VideoItem } from '@/components/video-list';
import { getStatusInfo } from './status-info';
import { MetadataCard } from './metadata-card';
import { StatusActions } from './status-actions';
import { ArtifactsSection } from './artifacts-section';

interface VideoDetailsProps {
  video: VideoItem;
  currentFolder: string;
  onAnalyze?: (video: VideoItem) => void;
  isAnalyzing?: boolean;
  className?: string;
}

/**
 * VideoDetails component
 */
export function VideoDetails({
  video,
  currentFolder: _currentFolder,
  onAnalyze,
  isAnalyzing = false,
  className,
}: VideoDetailsProps): JSX.Element {
  const [thumbnailError, setThumbnailError] = React.useState(false);

  // Thumbnail comes from CLI scan artifacts, served via the media:// protocol;
  // thumbnailMtime acts as a cache-buster when the file is regenerated.
  const thumbnailPath = video.artifacts?.thumbnailPath ?? null;
  const thumbnailSrc = thumbnailPath
    ? mediaUrl(thumbnailPath, video.artifacts?.thumbnailMtime ?? undefined)
    : null;

  // Reset thumbnail error when the thumbnail source changes
  React.useEffect(() => {
    setThumbnailError(false);
  }, [thumbnailSrc]);

  const statusInfo = getStatusInfo(video.status, isAnalyzing);

  return (
    <ScrollArea className={cn('h-full', className)}>
      <div className="p-6 space-y-6">
        {/* Header with thumbnail and basic info */}
        <div className="flex gap-4">
          {/* Thumbnail */}
          <div className="relative w-32 h-20 rounded-lg overflow-hidden bg-muted flex-shrink-0">
            {thumbnailSrc && !thumbnailError ? (
              <img
                src={thumbnailSrc}
                alt={video.filename}
                className="w-full h-full object-cover"
                onError={() => setThumbnailError(true)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Film className="h-8 w-8 text-muted-foreground" />
              </div>
            )}
          </div>

          {/* Basic info */}
          <div className="flex-1 min-w-0 space-y-1">
            <h2 className="text-lg font-semibold truncate" title={video.filename}>
              {video.filename}
            </h2>
            <p className="text-xs text-muted-foreground truncate" title={video.path}>
              {video.path}
            </p>
            {/* Status badge */}
            <div
              className={cn(
                'inline-flex items-center gap-1.5 px-2 py-1 rounded text-sm font-medium',
                statusInfo.bgColor,
                statusInfo.color
              )}
            >
              {statusInfo.icon}
              <span>{statusInfo.label}</span>
            </div>
          </div>
        </div>

        {/* Metadata */}
        <MetadataCard video={video} />

        {/* Status description */}
        <div className="text-sm text-muted-foreground">
          {statusInfo.description}
        </div>

        {/* Per-status action cards (analyze / continue / retry) */}
        <StatusActions video={video} onAnalyze={onAnalyze} isAnalyzing={isAnalyzing} />

        {/* Artifacts (summary, frames, transcript, full analysis) */}
        <ArtifactsSection video={video} />
      </div>
    </ScrollArea>
  );
}

export type { VideoDetailsProps };
